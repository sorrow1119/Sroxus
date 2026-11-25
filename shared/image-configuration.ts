import type { ImageGenerationInput, ImageGenerationMode } from "./types";

export function imageCreationMode(input: Partial<ImageGenerationInput>): NonNullable<ImageGenerationInput["creationMode"]> {
  if (input.creationMode === "text" || input.creationMode === "edit" || input.creationMode === "reference") return input.creationMode;
  return input.referencePaths?.length ? input.referenceMode === "reference" ? "reference" : "edit" : "text";
}

export function resolveImageInput(input: ImageGenerationInput, model = input.model || ""): ImageGenerationInput {
  const creationMode = imageCreationMode(input);
  const referencePaths = creationMode === "text" ? [] : Array.isArray(input.referencePaths) ? [...input.referencePaths] : [];
  return {
    ...input, creationMode, referencePaths, referenceMode: creationMode === "reference" ? "reference" : "edit",
    mode: input.protocolAutomatic || !input.mode ? defaultImageMode(model, creationMode !== "text") : input.mode,
  };
}

export function getImageInputError(input: ImageGenerationInput): string | null {
  if ((input.referencePaths?.length ?? 0) > 4) return "参考图检查：每次最多 4 张参考图。";
  if (imageCreationMode(input) !== "text" && !input.referencePaths?.length) return "参考图检查：修改原图或参考创作至少需要一张图片；仅使用文字时请选择文生图。";
  if (input.mode === "openai_image_edits" && !input.referencePaths?.length) return "接口检查：文生图不能使用 /v1/images/edits，请在全部设置中选择自动匹配或 /v1/images/generations。";
  if (input.mode === "openai_images" && input.referencePaths?.length) return "接口检查：修改原图或参考创作不能使用 /v1/images/generations，请选择自动匹配或 /v1/images/edits。";
  return null;
}

/** Shared by renderer and main process; never forward a provider key to a different origin. */
export function getImageConfigurationError(baseUrl: string, mode: ImageGenerationMode, override = ""): string | null {
  const base = baseUrl.trim();
  const endpoint = override.trim();
  try {
    const baseUrlObject = base ? new URL(base) : null;
    const destination = endpoint ? new URL(endpoint, baseUrlObject ?? undefined) : baseUrlObject;
    if (!destination || !["http:", "https:"].includes(destination.protocol)) {
      return "生图配置错误：请填写有效的 HTTP/HTTPS 服务商地址。";
    }
    if (destination.username || destination.password || (baseUrlObject && (baseUrlObject.username || baseUrlObject.password))) {
      return "生图配置错误：接口地址不能包含用户名或密码，请使用服务商的 API Key 设置。";
    }
    if (baseUrlObject && destination.origin !== baseUrlObject.origin) {
      return "生图配置错误：手动接口与所选服务商不同源，已阻止把该服务商的 API Key 发往其他服务。请清空手动接口，或为目标地址单独添加服务商并配置对应密钥。";
    }
    if (destination.search || destination.hash || baseUrlObject?.search || baseUrlObject?.hash) {
      return "生图配置错误：接口地址不能包含查询参数或片段，请在服务商设置中填写 API Key，避免凭据进入任务记录。";
    }
    const pathname = destination.pathname.replace(/\/+$/, "");
    const expected: ImageGenerationMode | undefined = /\/images\/generations$/.test(pathname) ? "openai_images"
      : /\/images\/edits$/.test(pathname) ? "openai_image_edits"
      : /\/chat\/completions$/.test(pathname) ? "chat_completions_image"
      : /:generateContent$/.test(pathname) ? "gemini_generate_content" : undefined;
    if (expected && expected !== mode) {
      return `生图配置错误：接口路径与请求模式不一致；此路径应使用 ${expected}，当前选择为 ${mode}。`;
    }
    return null;
  } catch {
    return "生图配置错误：服务商地址或手动接口不是有效 URL；相对路径需要有效的服务商地址。";
  }
}

export function defaultImageMode(model: string, hasReferences: boolean): ImageGenerationMode {
  if (/gemini|nano.?banana/i.test(model)) return "chat_completions_image";
  return hasReferences ? "openai_image_edits" : "openai_images";
}

export function imageModePath(mode: ImageGenerationMode): string {
  return mode === "openai_image_edits" ? "/v1/images/edits"
    : mode === "chat_completions_image" ? "/v1/chat/completions"
    : mode === "gemini_generate_content" ? "/v1beta/{model}:generateContent"
    : "/v1/images/generations";
}
