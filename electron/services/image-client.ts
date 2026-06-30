import fs from "node:fs";
import path from "node:path";
import type { ImageGenerationInput, ImageGenerationResult, ProviderInput } from "../../shared/types";
import { sanitizeForLog } from "./privacy-filter";
import { getStoragePath } from "./storage-path";

type ImagePayloadItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

export class OpenAICompatibleImageClient {
  constructor(private readonly provider: ProviderInput) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (!this.provider.baseUrl.trim()) {
      throw new Error("请先配置 Provider Base URL。");
    }
    if (!this.provider.model.trim()) {
      throw new Error("请先配置生图模型名。");
    }
    if (!input.prompt.trim()) {
      throw new Error("请输入生图提示词。");
    }

    let lastError = "图片生成接口不可用，请确认该模型和服务商支持 /v1/images/generations。";
    for (const endpoint of imageEndpointCandidates(this.provider.baseUrl)) {
      const result = await this.tryGenerate(endpoint, input, true);
      if (result.ok) {
        return result.value;
      }
      lastError = result.message;
      if (!result.retryWithUrlFormat) {
        const retry = await this.tryGenerate(endpoint, input, false);
        if (retry.ok) {
          return retry.value;
        }
        lastError = retry.message;
      }
    }
    throw new Error(lastError);
  }

  private async tryGenerate(endpoint: string, input: ImageGenerationInput, requestBase64: boolean) {
    let response: Response;
    const body: Record<string, unknown> = {
      model: this.provider.model,
      prompt: input.prompt,
      size: input.size,
      n: input.count,
    };
    if (requestBase64) {
      body.response_format = "b64_json";
    }

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      return {
        ok: false as const,
        retryWithUrlFormat: false,
        message: explainImageFetchError(error),
      };
    }

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false as const,
        retryWithUrlFormat: requestBase64 && shouldRetryWithoutBase64(response.status, rawText),
        message: `${explainImageHttpError(response.status, rawText)}\n日志: ${saveImageRawResponse("http-error", endpoint, rawText)}`,
      };
    }

    const parsed = parseImageResponse(rawText);
    if (parsed.images.length) {
      return {
        ok: true as const,
        value: {
          providerName: this.provider.name,
          model: this.provider.model,
          endpoint,
          prompt: input.prompt,
          images: parsed.images,
        },
      };
    }

    return {
      ok: false as const,
      retryWithUrlFormat: requestBase64,
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

function parseImageResponse(text: string) {
  const data = JSON.parse(text) as {
    data?: ImagePayloadItem[];
    images?: ImagePayloadItem[];
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  };
  const items: ImagePayloadItem[] = data.data ?? data.images ?? (data.url || data.b64_json ? [data] : []);
  return {
    images: items
      .map((item) => {
        const dataUrl = item.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined;
        return {
          url: item.url,
          dataUrl,
          revisedPrompt: item.revised_prompt,
        };
      })
      .filter((item) => item.url || item.dataUrl),
  };
}

function imageEndpointCandidates(value: string) {
  const base = normalizeBase(value);
  const root = rootBase(base);
  return unique([
    base.endsWith("/images/generations") ? base : "",
    base.endsWith("/v1") ? `${base}/images/generations` : "",
    `${root}/v1/images/generations`,
    `${root}/images/generations`,
  ]);
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
    .replace(/\/v1$/, "");
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
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
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "图片生成超时，请稍后重试，或换一个服务商/模型。";
    }
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
