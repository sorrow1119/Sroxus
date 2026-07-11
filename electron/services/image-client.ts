import fs from "node:fs";
import path from "node:path";
import type { GeneratedImage, ImageGenerationInput, ImageGenerationMode, ImageGenerationResult, ProviderInput } from "../../shared/types";
import { sanitizeForLog } from "./privacy-filter";
import { getStoragePath } from "./storage-path";

type ProbeResult =
  | { ok: true; value: ImageGenerationResult }
  | { ok: false; retryWithoutBase64?: boolean; message: string };

export class OpenAICompatibleImageClient {
  constructor(private readonly provider: ProviderInput) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const mode = input.mode ?? "openai_images";
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

    let lastError = modeHint(mode);
    for (const endpoint of endpointCandidates(this.provider.baseUrl, mode, model, input.endpointOverride)) {
      const first = await this.tryGenerate(endpoint, input, mode, true);
      if (first.ok) return first.value;
      lastError = first.message;

      if (mode === "openai_images" && first.retryWithoutBase64) {
        const retry = await this.tryGenerate(endpoint, input, mode, false);
        if (retry.ok) return retry.value;
        lastError = retry.message;
      }
    }
    throw new Error(lastError);
  }

  private async tryGenerate(endpoint: string, input: ImageGenerationInput, mode: ImageGenerationMode, requestBase64: boolean): Promise<ProbeResult> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(buildPayload(this.provider.model, input, mode, requestBase64)),
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      return { ok: false, message: explainImageFetchError(error) };
    }

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        retryWithoutBase64: mode === "openai_images" && requestBase64 && shouldRetryWithoutBase64(response.status, rawText),
        message: `${explainImageHttpError(response.status, rawText)}\n日志: ${saveImageRawResponse("http-error", endpoint, rawText)}`,
      };
    }

    const images = await saveGeneratedImages(parseAnyImageResponse(rawText));
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
      retryWithoutBase64: mode === "openai_images" && requestBase64,
      message: `图片接口返回格式无法识别。\n日志: ${saveImageRawResponse("parse-failed", endpoint, rawText)}`,
    };
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
    };
  }
}

function buildPayload(model: string, input: ImageGenerationInput, mode: ImageGenerationMode, requestBase64: boolean) {
  if (mode === "chat_completions_image") {
    return {
      model,
      messages: [{ role: "user", content: input.prompt }],
      stream: false,
    };
  }

  if (mode === "gemini_generate_content") {
    return {
      contents: [
        {
          role: "user",
          parts: [{ text: input.prompt }],
        },
      ],
      generationConfig: {
        candidateCount: Math.max(1, Math.min(4, input.count)),
      },
    };
  }

  return {
    model,
    prompt: input.prompt,
    size: input.size,
    n: input.count,
    ...(requestBase64 ? { response_format: "b64_json" } : {}),
  };
}

function endpointCandidates(baseUrl: string, mode: ImageGenerationMode, model: string, override?: string) {
  const overrideValue = override?.trim();
  if (overrideValue) {
    return [absoluteOrJoinedEndpoint(baseUrl, overrideValue)];
  }

  const base = normalizeBase(baseUrl);
  const root = rootBase(base);

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

async function saveGeneratedImages(images: GeneratedImage[]) {
  const saved: GeneratedImage[] = [];
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(getStoragePath(), "generated-images", day);
  fs.mkdirSync(dir, { recursive: true });

  for (const [index, image] of images.entries()) {
    const file = await imageToFile(image, dir, now, index + 1).catch(() => null);
    saved.push(file ? { ...image, savedPath: file.path, savedFileName: file.name } : image);
  }

  return saved;
}

async function imageToFile(image: GeneratedImage, dir: string, date: Date, index: number) {
  const data = image.dataUrl ? dataUrlToBuffer(image.dataUrl) : image.url ? await urlToBuffer(image.url) : null;
  if (!data) return null;

  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const fileName = `sroxus-image-${stamp}-${String(index).padStart(2, "0")}.${data.ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, data.buffer);
  return { path: filePath, name: fileName };
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
  if (mode === "chat_completions_image") return "Chat Completions 生图接口不可用，请确认该模型支持通过 /v1/chat/completions 返回图片。";
  if (mode === "gemini_generate_content") return "Gemini GenerateContent 生图接口不可用，请确认 endpoint 类似 /v1beta/{model}:generateContent。";
  return "OpenAI Images 生图接口不可用，请确认该模型和服务商支持 /v1/images/generations。";
}

function shouldRetryWithoutBase64(status: number, text: string) {
  const lower = text.toLowerCase();
  return status === 400 || status === 422 || lower.includes("response_format") || lower.includes("b64_json");
}

function explainImageHttpError(status: number, text: string) {
  const body = sanitizeForLog(text.slice(0, 800));
  if (status === 401) return `认证失败，请检查 API Key。${body}`;
  if (status === 403) return `当前账号无权限，或该模型不支持生图。${body}`;
  if (status === 404) return `图片接口、Base URL 或模型名不存在。${body}`;
  if (status === 429) return `触发限流，请稍后重试。${body}`;
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

function saveImageRawResponse(kind: string, endpoint: string, content: string) {
  const dir = path.join(getStoragePath(), "logs", "images");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ kind, endpoint, createdAt: new Date().toISOString(), content: sanitizeForLog(content.slice(0, 200000)) }, null, 2),
    "utf-8",
  );
  return filePath;
}
