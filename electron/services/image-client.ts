import fs from "node:fs";
import path from "node:path";
import type { GeneratedImage, ImageGenerationInput, ImageGenerationMode, ImageGenerationResult, ProviderInput } from "../../shared/types";
import { getImageConfigurationError, getImageInputError, resolveImageInput } from "../../shared/image-configuration";
import { imageDimensions, readReference, writeGeneratedImage } from "./image-assets";
import { resolveImageSizing } from "../../shared/image-sizing";
import { sanitizeForLog } from "./privacy-filter";
import { getStoragePath } from "./storage-path";

type ProbeResult =
  | { ok: true; value: ImageGenerationResult }
  | { ok: false; tryNextEndpoint?: boolean; retryWithoutBase64?: boolean; retryWithoutNegativePrompt?: boolean; message: string };

export class OpenAICompatibleImageClient {
  constructor(private readonly provider: ProviderInput, private readonly signal?: AbortSignal) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    input = resolveImageInput(input, this.provider.model);
    const mode = input.mode!;
    const model = this.provider.model.trim();
    const prompt = input.prompt.trim();

    if (!this.provider.baseUrl.trim() && !input.endpointOverride?.trim()) {
      throw new Error("请先配置 Provider Base URL，或填写生图 endpoint。");
    }
    if (!model) {
      throw new Error("请先配置生图模型名。");
    }
    if (!prompt) {
      throw new Error("请输入生图提示词。");
    }

    const configurationError = getImageConfigurationError(this.provider.baseUrl, mode, input.endpointOverride);
    if (configurationError) throw new Error(configurationError);
    const inputError = getImageInputError(input);
    if (inputError) throw new Error(inputError);
    const references = await Promise.all((input.referencePaths ?? []).map(readReference));
    const sizing = resolveImageSizing({ ...input, model }, references[0]);
    if ((mode === "gemini_generate_content" || (mode === "chat_completions_image" && /gemini|banana/i.test(model))) && sizing.size !== "auto" && !sizing.aspectRatio) {
      throw new Error("尺寸检查：该 Gemini 接口按常用比例输出，不支持此自定义比例；请选择 1:1、3:4、4:3、9:16、16:9、2:3 或 3:2。");
    }
    const effectiveInput = { ...input, model, resolution: input.aspectRatio === "custom" ? "auto" as const : input.resolution, size: sizing.size, aspectRatio: sizing.aspectRatio ?? (sizing.size === "auto" ? "auto" as const : "custom" as const) };

    const requestedCount = Math.max(1, Math.min(4, Math.trunc(input.count || 1)));
    const images: GeneratedImage[] = [];
    const errors: string[] = [];
    let resultMeta: ImageGenerationResult | null = null;

    for (let index = 0; index < requestedCount && images.length < requestedCount; index += 1) {
      try {
        this.signal?.throwIfAborted();
        const single = await this.generateSingle({ ...effectiveInput, count: 1 }, mode, model);
        resultMeta ??= single;
        images.push(...single.images.slice(0, requestedCount - images.length));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        // A failed generation may already have consumed quota. Do not repeat it for the remaining count.
        break;
      }
    }

    if (!resultMeta || !images.length) {
      throw new Error(errors[0] ?? modeHint(mode));
    }

    const missingCount = requestedCount - images.length;
    return {
      ...resultMeta,
      prompt: input.prompt,
      images,
      sizeNote: `请求：${sizing.label}；实际：${images.map((image) => image.width && image.height ? `${image.width}×${image.height}` : "未知").join("、")}${sizing.aspectRatio && images.some((image) => image.width && image.height && Math.abs(image.width / image.height / ratioValue(sizing.aspectRatio!) - 1) > 0.04) ? "（服务端返回比例与请求不一致）" : ""}${input.aspectRatio === "custom" && /gemini|banana/i.test(model) ? "；Gemini 按比例生成，不保证精确像素" : ""}`,
      ...(missingCount > 0
        ? { warning: `请求生成 ${requestedCount} 张，成功 ${images.length} 张，失败 ${missingCount} 张。${errors[0] ? `\n${errors[0]}` : ""}` }
        : {}),
    };
  }

  private async generateSingle(input: ImageGenerationInput, mode: ImageGenerationMode, model: string): Promise<ImageGenerationResult> {
    let lastError = modeHint(mode);
    const useNativeNegativePrompt = mode === "openai_images" && Boolean(input.negativePrompt?.trim());

    for (const endpoint of endpointCandidates(this.provider.baseUrl, mode, model, input.endpointOverride)) {
      const queue: Array<{ requestBase64: boolean; nativeNegativePrompt: boolean }> = [
        { requestBase64: true, nativeNegativePrompt: useNativeNegativePrompt },
      ];
      const tried = new Set<string>();
      let tryNextEndpoint = false;

      while (queue.length) {
        const attempt = queue.shift()!;
        const key = `${attempt.requestBase64}:${attempt.nativeNegativePrompt}`;
        if (tried.has(key)) continue;
        tried.add(key);

        const result = await this.tryGenerate(endpoint, input, mode, attempt.requestBase64, attempt.nativeNegativePrompt);
        if (result.ok) return result.value;
        lastError = result.message;
        tryNextEndpoint = result.tryNextEndpoint === true;

        if (mode === "openai_images" && attempt.requestBase64 && result.retryWithoutBase64) {
          queue.push({ ...attempt, requestBase64: false });
        }
        if (attempt.nativeNegativePrompt && result.retryWithoutNegativePrompt) {
          queue.push({ ...attempt, nativeNegativePrompt: false });
        }
      }
      // A valid endpoint's task/auth/network failure must not trigger another generation.
      if (!tryNextEndpoint) throw new Error(lastError);
    }

    throw new Error(lastError);
  }

  private async tryGenerate(
    endpoint: string,
    input: ImageGenerationInput,
    mode: ImageGenerationMode,
    requestBase64: boolean,
    useNativeNegativePrompt: boolean,
  ): Promise<ProbeResult> {
    let response: Response;
    try {
      const headers: Record<string, string> = this.headers();
      let body: BodyInit;
      if (mode === "openai_image_edits") {
        const form = new FormData();
        form.set("model", this.provider.model);
        form.set("prompt", promptWithNegative(input));
        form.set("n", "1");
        form.set("size", input.size);
        for (const filePath of input.referencePaths ?? []) {
          const ref = await readReference(filePath);
          form.append(input.referencePaths!.length === 1 ? "image" : "image[]", new Blob([new Uint8Array(ref.buffer)], { type: ref.mime }), ref.uploadName);
        }
        delete headers["Content-Type"];
        body = form;
      } else {
        body = JSON.stringify(await buildPayload(this.provider.model, input, mode, requestBase64, useNativeNegativePrompt));
      }
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
      });
    } catch (error) {
      const message = explainImageFetchError(error);
      return { ok: false, message: `${message}\n日志: ${saveImageRawResponse("network-error", endpoint, message, { mode, model: this.provider.model })}` };
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (error) {
      const message = explainImageFetchError(error);
      return { ok: false, message: `读取生图响应失败：${message}\n日志: ${saveImageRawResponse("read-error", endpoint, message, { mode, model: this.provider.model, status: response.status })}` };
    }
    if (!response.ok) {
      return {
        ok: false,
        tryNextEndpoint: isMissingImageRoute(response.status, rawText),
        retryWithoutBase64: mode === "openai_images" && requestBase64 && shouldRetryWithoutBase64(response.status, rawText),
        retryWithoutNegativePrompt: useNativeNegativePrompt && (response.status === 400 || response.status === 422) && /negative_prompt/i.test(rawText),
        message: `${explainImageHttpError(response.status, rawText)}\n日志: ${saveImageRawResponse("http-error", endpoint, rawText, { status: response.status, mode, model: this.provider.model })}`,
      };
    }

    let parsed: GeneratedImage[];
    try { parsed = parseAnyImageResponse(rawText).slice(0, 1); }
    catch {
      return { ok: false, message: `响应解析失败：返回内容不是有效 JSON。\n日志: ${saveImageRawResponse("parse-failed", endpoint, rawText, { status: response.status, mode, model: this.provider.model })}` };
    }
    const images = await saveGeneratedImages(parsed, input.referencePaths?.[0]);
    if (images.length) {
      return {
        ok: true,
        value: {
          providerName: this.provider.name,
          model: this.provider.model,
          endpoint,
          prompt: input.prompt,
          images,
        },
      };
    }

    return {
      ok: false,
      message: `图片接口返回格式无法识别。\n日志: ${saveImageRawResponse("parse-failed", endpoint, rawText, { status: response.status, mode, model: this.provider.model })}`,
    };
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
    };
  }
}

async function buildPayload(
  model: string,
  input: ImageGenerationInput,
  mode: ImageGenerationMode,
  requestBase64: boolean,
  useNativeNegativePrompt: boolean,
) {
  const prompt = useNativeNegativePrompt ? input.prompt.trim() : promptWithNegative(input);
  const references = await Promise.all((input.referencePaths ?? []).map(readReference));
  const sizing = resolveImageSizing(input, references[0]);

  if (mode === "chat_completions_image") {
    return {
      model,
      messages: [{ role: "user", content: references.length ? [
        { type: "text", text: prompt },
        ...references.map((reference) => ({ type: "image_url", image_url: { url: reference.dataUrl } })),
      ] : prompt }],
      stream: false,
      ...(sizing.aspectRatio || (input.resolution && input.resolution !== "auto") ? { image_config: { ...(sizing.aspectRatio ? { aspect_ratio: sizing.aspectRatio } : {}), ...(input.resolution && input.resolution !== "auto" ? { image_size: input.resolution } : {}) } } : {}),
    };
  }

  if (mode === "gemini_generate_content") {
    return {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, ...references.map((reference) => ({ inlineData: { mimeType: reference.mime, data: reference.buffer.toString("base64") } }))],
        },
      ],
      generationConfig: {
        candidateCount: Math.max(1, Math.min(4, input.count)),
        ...(sizing.aspectRatio || (input.resolution && input.resolution !== "auto") ? { imageConfig: { ...(sizing.aspectRatio ? { aspectRatio: sizing.aspectRatio } : {}), ...(input.resolution && input.resolution !== "auto" ? { imageSize: input.resolution } : {}) } } : {}),
      },
    };
  }

  return {
    model,
    prompt,
    size: input.size,
    n: 1,
    ...(useNativeNegativePrompt && input.negativePrompt?.trim() ? { negative_prompt: input.negativePrompt.trim() } : {}),
    ...(requestBase64 ? { response_format: "b64_json" } : {}),
  };
}

function ratioValue(value: string) { const [width, height] = value.split(":").map(Number); return width / height; }

function promptWithNegative(input: ImageGenerationInput) {
  const intent = input.referencePaths?.length ? (input.referenceMode === "reference"
    ? "以所附图片作为视觉参考，按照以下要求创作新图。"
    : "直接编辑所附原图，只修改明确要求的内容，尽量保留其余主体、构图和细节。") : "";
  const prompt = intent ? `${intent}\n${input.prompt.trim()}` : input.prompt.trim();
  const negativePrompt = input.negativePrompt?.trim();
  return negativePrompt ? `${prompt}\n\n请避免图片中出现以下内容：${negativePrompt}` : prompt;
}

function endpointCandidates(baseUrl: string, mode: ImageGenerationMode, model: string, override?: string) {
  const overrideValue = override?.trim();
  if (overrideValue) {
    return [absoluteOrJoinedEndpoint(baseUrl, overrideValue)];
  }

  const base = normalizeBase(baseUrl);
  const root = rootBase(base);

  if (mode === "openai_image_edits") {
    return unique([
      base.endsWith("/images/edits") ? base : "",
      base.endsWith("/v1") ? `${base}/images/edits` : "",
      `${root}/v1/images/edits`,
      `${root}/images/edits`,
    ]);
  }

  if (mode === "chat_completions_image") {
    return unique([
      base.endsWith("/chat/completions") ? base : "",
      base.endsWith("/v1") ? `${base}/chat/completions` : "",
      `${root}/v1/chat/completions`,
      `${root}/chat/completions`,
    ]);
  }

  if (mode === "gemini_generate_content") {
    return unique([
      base.includes(":generateContent") ? base : "",
      base.endsWith("/v1beta") ? `${base}/${model}:generateContent` : "",
      `${root}/v1beta/${model}:generateContent`,
    ]);
  }

  return unique([
    base.endsWith("/images/generations") ? base : "",
    base.endsWith("/v1") ? `${base}/images/generations` : "",
    `${root}/v1/images/generations`,
    `${root}/images/generations`,
  ]);
}

function absoluteOrJoinedEndpoint(baseUrl: string, endpoint: string) {
  if (/^https?:\/\//i.test(endpoint)) return normalizeBase(endpoint);
  const root = rootBase(normalizeBase(baseUrl));
  return `${root}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function parseAnyImageResponse(text: string): GeneratedImage[] {
  const data = JSON.parse(text) as unknown;
  const images: GeneratedImage[] = [];
  collectImages(data, images);
  collectImagesFromText(JSON.stringify(data), images);
  return dedupeImages(images);
}

function collectImages(value: unknown, images: GeneratedImage[]) {
  if (!value) return;

  if (typeof value === "string") {
    collectImagesFromText(value, images);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, images);
    return;
  }

  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;

  const b64 = pickString(record.b64_json) ?? pickString(record.b64Json) ?? pickString(record.data);
  const mime = pickString(record.mime_type) ?? pickString(record.mimeType) ?? pickString(record.media_type) ?? "image/png";
  if (b64 && looksLikeBase64Image(b64)) {
    images.push({ dataUrl: b64.startsWith("data:image/") ? b64 : `data:${mime};base64,${b64}` });
  }

  const url = pickString(record.url) ?? pickString(record.image_url) ?? pickString(record.imageUrl);
  if (url && /^https?:\/\//i.test(url)) {
    images.push({ url });
  }

  const inlineData = record.inlineData ?? record.inline_data;
  if (inlineData && typeof inlineData === "object") {
    const inlineRecord = inlineData as Record<string, unknown>;
    const inlineB64 = pickString(inlineRecord.data);
    const inlineMime = pickString(inlineRecord.mimeType) ?? pickString(inlineRecord.mime_type) ?? "image/png";
    if (inlineB64 && looksLikeBase64Image(inlineB64)) {
      images.push({ dataUrl: `data:${inlineMime};base64,${inlineB64}` });
    }
  }

  const fileData = record.fileData ?? record.file_data;
  if (fileData && typeof fileData === "object") {
    const uri = pickString((fileData as Record<string, unknown>).fileUri) ?? pickString((fileData as Record<string, unknown>).file_uri);
    if (uri && /^https?:\/\//i.test(uri)) {
      images.push({ url: uri });
    }
  }

  for (const item of Object.values(record)) collectImages(item, images);
}

function collectImagesFromText(text: string, images: GeneratedImage[]) {
  const urlMatches = text.match(/https?:\/\/[^\s"'<>\\)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>\\)]*)?/gi) ?? [];
  for (const url of urlMatches) images.push({ url });

  const dataUrlMatches = text.match(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi) ?? [];
  for (const dataUrl of dataUrlMatches) images.push({ dataUrl });
}

function dedupeImages(images: GeneratedImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = image.url ?? image.dataUrl ?? "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function saveGeneratedImages(images: GeneratedImage[], source?: string) {
  const saved: GeneratedImage[] = [];
  for (const image of images) {
    const data = image.dataUrl ? dataUrlToBuffer(image.dataUrl) : image.url ? await urlToBuffer(image.url) : null;
    if (!data) throw new Error("图片下载阶段失败：接口已返回图片地址，但未能下载；请检查服务商记录，避免重复扣费。");
    try {
      const file = writeGeneratedImage(data.buffer, data.ext, source);
      const dimensions = await imageDimensions(data.buffer);
      saved.push({ ...image, savedPath: file.path, savedFileName: file.name, ...dimensions });
    } catch (error) {
      throw new Error(`图片保存阶段失败：${error instanceof Error ? error.message : String(error)}。接口可能已扣费，请检查存储目录。`);
    }
  }

  return saved;
}

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:(image\/[^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), ext: mimeToExt(match[1]) };
}

async function urlToBuffer(url: string) {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) return null;
  const mime = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, ext: mimeToExt(mime) };
}

function mimeToExt(mime: string) {
  const value = mime.toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  return "png";
}

function pickString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function looksLikeBase64Image(value: string) {
  return value.startsWith("data:image/") || /^[A-Za-z0-9+/=\r\n]{80,}$/.test(value);
}

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function rootBase(value: string) {
  return normalizeBase(value)
    .replace(/\/chat\/completions$/, "")
    .replace(/\/responses$/, "")
    .replace(/\/models$/, "")
    .replace(/\/images\/generations$/, "")
    .replace(/\/images\/edits$/, "")
    .replace(/\/v1beta\/[^/]+:generateContent$/, "")
    .replace(/\/v1beta$/, "")
    .replace(/\/v1$/, "");
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function modeHint(mode: ImageGenerationMode) {
  if (mode === "openai_image_edits") return "图生图接口不可用，请确认该模型和服务商支持 /v1/images/edits。";
  if (mode === "chat_completions_image") return "Chat Completions 生图接口不可用，请确认该模型支持通过 /v1/chat/completions 返回图片。";
  if (mode === "gemini_generate_content") return "Gemini GenerateContent 生图接口不可用，请确认 endpoint 类似 /v1beta/{model}:generateContent。";
  return "OpenAI Images 生图接口不可用，请确认该模型和服务商支持 /v1/images/generations。";
}

function shouldRetryWithoutBase64(status: number, text: string) {
  const lower = text.toLowerCase();
  return (status === 400 || status === 422) && (lower.includes("response_format") || lower.includes("b64_json"));
}

function isMissingImageRoute(status: number, text: string) {
  if (status !== 404 && status !== 405) return false;
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    const detail = body.detail ?? body.message ?? body.error;
    return typeof detail === "string" && /^(not found|method not allowed)\.?$/i.test(detail.trim());
  } catch {
    return !text.trim() || /^(not found|method not allowed)\.?$/i.test(text.trim()) ||
      (/<html[\s>]/i.test(text) && /404|405|not found|method not allowed/i.test(text));
  }
}

function explainImageHttpError(status: number, text: string) {
  const body = sanitizeForLog(text.slice(0, 800));
  if (/浏览器插件未连接|browser.*(?:not connected|disconnected)/i.test(text)) return `生图服务的浏览器插件未连接，请在对应浏览器连接插件后重试。${body}`;
  if (/use \*_sync image models/i.test(text)) return `当前服务要求使用 *_sync 生图模型，请在该服务的模型列表中选择对应型号。${body}`;
  if (/Invalid API key/i.test(text)) return `认证失败：目标生图服务不接受当前 API Key，请核对服务商、目标地址及对应密钥。${body}`;
  if (status === 401) return `认证失败，请检查 API Key。${body}`;
  if (status === 403) return `当前账号无权限，或该模型不支持生图。${body}`;
  if (status === 404) return `图片接口、Base URL 或模型名不存在。${body}`;
  if (status === 429) return `触发限流，请稍后重试。${body}`;
  if (status === 402) return `生图计费阶段失败：余额、订阅或消费额度受限 (HTTP 402)。${body}`;
  return `图片生成请求失败：HTTP ${status} ${body}`;
}

function explainImageFetchError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "图片生成超时，请稍后重试，或换一个服务商/模型。";
    const message = error.message.toLowerCase();
    if (message.includes("fetch failed") || message.includes("network") || message.includes("enotfound") || message.includes("etimedout")) {
      return "网络连接失败，请检查网络或代理设置。";
    }
    return error.message;
  }
  return String(error);
}

function saveImageRawResponse(kind: string, endpoint: string, content: string, metadata: { status?: number; mode?: ImageGenerationMode; model?: string } = {}) {
  // Do not persist credentials in URL query strings, even with custom endpoints.
  let safeEndpoint = endpoint;
  try { const url = new URL(endpoint); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; safeEndpoint = url.toString(); } catch { safeEndpoint = "[invalid endpoint]"; }
  try {
    const dir = path.join(getStoragePath(), "logs", "images");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ kind, endpoint: safeEndpoint, ...metadata, createdAt: new Date().toISOString(), content: sanitizeForLog(content.slice(0, 200000)) }, null, 2),
      "utf-8",
    );
    return filePath;
  } catch { return "日志写入失败（请检查存储目录权限）；原始错误见上文"; }
}
