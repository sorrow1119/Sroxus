import type { VideoGenerationInput, VideoMode, VideoProtocol } from "./types";

export const VIDEO_PROTOCOLS: Array<{ value: VideoProtocol; label: string }> = [
  { value: "newapi_video", label: "New API 兼容 · /v1/video/generations" },
  { value: "ark", label: "火山方舟 · 视频任务 API" },
  { value: "openai_video", label: "OpenAI 兼容 · /v1/videos" },
  { value: "muse_video", label: "Muse2API · JSON 图片数组" },
  { value: "grok_video", label: "xAI 兼容 · /v1/videos/generations" },
];
export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const VIDEO_RESOLUTIONS = ["default", "480p", "720p", "1080p", "1440p", "4k", "1024p"];
export const videoResolutionLabel = (value: string) => value === "default" ? "默认清晰度" : value === "1440p" ? "2K (1440P)" : value === "4k" ? "4K (2160P)" : value.toUpperCase();
export const isVideoModel = (model: string) => /seedance|sora|veo|grok.*video|kling|wan(?:[._-]?\d|x)|video|hailuo|vidu|luma|ray[-_]|pixverse/i.test(model);

export function defaultVideoProtocol(baseUrl: string, model: string): VideoProtocol {
  if (model === "muse-video") return "muse_video";
  try {
    if (/^(?:api\.|cf\.)?a6api\.(?:com|ai|vip|net)$/i.test(new URL(baseUrl).hostname)) return "newapi_video";
  } catch { /* Invalid URLs are reported by endpoint validation. */ }
  if (/ark\.[^/]*volces\.com|\/api\/v3(?:\/|$)/i.test(baseUrl)) return "ark";
  if (/grok.*video/i.test(model) || /api\.x\.ai/i.test(baseUrl)) return "grok_video";
  return "openai_video";
}

export function isLegacyMuseVideo(model: string, protocol: VideoProtocol) {
  return model === "muse-video" && protocol === "openai_video";
}

export function supportsVideoReferenceContent(model: string, protocol: VideoProtocol, baseUrl = "") {
  if (!/seedance[-_.]?2(?:[-_.]|$)/i.test(model)) return false;
  if (protocol === "ark") return true;
  try { return protocol === "openai_video" && /^(?:api\.)?tu-zi\.com$/i.test(new URL(baseUrl).hostname); }
  catch { return false; }
}

export function videoCapabilities(model: string, protocol: VideoProtocol, baseUrl = "") {
  const modes: VideoMode[] = ["text", "first_frame"];
  let durations = [4, 5, 6, 8, 10, 12];
  let resolutions = ["default", "480p", "720p", "1080p", "1440p", "4k"];
  let ratios = [...VIDEO_RATIOS];
  let audio = false;
  let note = "中转模型能力以服务商为准；自动适配不会失败后切换接口重提任务。";
  const legacyMuse = isLegacyMuseVideo(model, protocol);
  const muse = legacyMuse || protocol === "muse_video";
  if (protocol === "ark") {
    if (/lite.*t2v/i.test(model)) modes.splice(1, 1);
    if (/lite.*i2v/i.test(model)) modes.splice(0, 1);
    durations = [4, 5, 6, 8, 10, 12];
    resolutions = ["default", "480p", "720p", "1080p"];
    if (/seedance.*(?:1[._-]?5|2)|lite.*i2v/i.test(model)) modes.push("first_last_frame");
    if (/seedance.*2/i.test(model)) { resolutions = /seedance.*2[._-]5/i.test(model) ? ["default", "480p", "720p", "1080p"] : ["default", "480p", "720p"]; durations = [4, 5, 6, 8, 10, 12, 15]; }
    if (/seedance.*1[._-]?0.*pro.*fast/i.test(model)) resolutions = ["default", "480p", "720p"];
    audio = /seedance.*(?:1[._-]?5|2)/i.test(model);
    note = "使用火山方舟任务协议；账户权限及模型的实际能力由服务端确认。";
  } else if (protocol === "grok_video" || (protocol === "newapi_video" && /grok.*video/i.test(model))) {
    durations = [4, 5, 6, 8, 10, 12, 15];
    resolutions = ["default", "480p", "720p", "1080p"];
    ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
    note = "xAI 兼容协议；支持单图输入，不发送首尾帧或音频开关。";
  } else if (protocol === "newapi_video" && /veo/i.test(model)) {
    durations = [4, 6, 8];
    ratios = ["16:9", "9:16"];
    resolutions = /veo[-_.]?3[._-]?1/i.test(model) ? ["default", "720p", "1080p", "4k"] : ["default", "720p", "1080p"];
  } else if (/sora/i.test(model)) {
    durations = [4, 8, 12];
    resolutions = /pro/i.test(model) ? ["default", "720p", "1024p"] : ["default", "720p"];
    ratios = ["16:9", "9:16"];
    note = "Sora 兼容协议；中转服务的可用性需单独确认。";
  }
  if (protocol === "newapi_video") note = "New API 统一视频任务协议；模型能力和渠道可用性以供应商为准。";
  if (legacyMuse) {
    durations = [4, 5, 6, 8, 10];
    ratios = ["16:9", "9:16", "1:1"];
    resolutions = ["default", "720p"];
  }
  if (protocol === "muse_video") note = "Muse2API JSON 接口；参考图按顺序发送。首尾帧通过提示词表达，不是原生帧锁定；时长与清晰度为生成要求。";
  const referenceLimit = muse || supportsVideoReferenceContent(model, protocol, baseUrl) ? 9 : 0;
  if (referenceLimit) {
    modes.push("reference_images");
    if (!modes.includes("first_last_frame")) modes.push("first_last_frame");
  }
  const referenceNote = referenceLimit ? "最多 9 张参考图；人物素材仍须符合供应商审核要求。" : "当前模型 / 接口未确认多图参考能力，请选择支持的模型与接口。";
  return { modes, durations, resolutions, ratios, audio, note, referenceLimit, referenceNote };
}

export interface VideoEndpoints {
  protocol: VideoProtocol;
  baseUrl: string;
  submitUrl: string;
  queryTemplate: string;
  contentTemplate?: string;
}

function customPath(value: string | undefined, fallback: string, task = false) {
  const raw = value?.trim() || fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[?#\r\n\\]/.test(raw) || /\.\./.test(decodeURIComponent(raw))) throw new Error("视频接口检查：自定义接口必须是同一服务商下的绝对路径，不能带密钥、查询参数或跳转地址。");
  if (task && (!raw.includes("{id}") || raw.split("{id}").length !== 2)) throw new Error("视频接口检查：查询和下载路径必须包含一次 {id}。");
  return raw;
}

export function resolveVideoEndpoints(baseUrl: string, input: Pick<VideoGenerationInput, "model" | "protocol" | "endpointOverride" | "queryEndpointOverride" | "downloadEndpointOverride">): VideoEndpoints {
  const url = new URL(baseUrl.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("视频接口检查：服务商地址须为不含密钥参数的 HTTP(S) 地址。");
  const protocol = input.protocol === "auto" ? defaultVideoProtocol(baseUrl, input.model) : input.protocol;
  if (!["ark", "openai_video", "grok_video", "newapi_video", "muse_video"].includes(protocol)) throw new Error("视频接口检查：不支持该协议。");
  const prefix = url.pathname.replace(/\/(?:chat\/completions|responses|videos(?:\/generations)?|video\/generations|contents\/generations\/tasks)\/?$/, "").replace(/\/$/, "");
  const base = prefix || (protocol === "ark" ? "/api/v3" : "/v1");
  const submit = protocol === "ark" ? `${base}/contents/generations/tasks` : protocol === "newapi_video" ? `${base}/video/generations` : protocol === "grok_video" ? `${base}/videos/generations` : `${base}/videos`;
  const query = protocol === "ark" ? `${base}/contents/generations/tasks/{id}` : protocol === "newapi_video" ? `${base}/video/generations/{id}` : `${base}/videos/{id}`;
  const build = (pathname: string) => url.origin + pathname;
  return { protocol, baseUrl: url.origin + prefix, submitUrl: build(customPath(input.endpointOverride, submit)), queryTemplate: build(customPath(input.queryEndpointOverride, query, true)), ...(["openai_video", "newapi_video"].includes(protocol) ? { contentTemplate: build(customPath(input.downloadEndpointOverride, `${base}/videos/{id}/content`, true)) } : {}) };
}

export function validateVideoInput(input: VideoGenerationInput, protocol: VideoProtocol, baseUrl = "") {
  if (!input.providerId || !input.model?.trim() || !input.prompt?.trim()) throw new Error("视频输入检查：请选择供应商、模型并填写提示词。");
  if (input.prompt.length > 16000 || input.model.length > 240) throw new Error("视频输入检查：提示词或模型名过长。");
  const caps = videoCapabilities(input.model, protocol, baseUrl);
  if (!caps.modes.includes(input.mode)) throw new Error("视频输入检查：当前模型 / 协议不支持此生成模式。");
  if (!caps.durations.includes(input.duration) || !caps.ratios.includes(input.aspectRatio) || !caps.resolutions.includes(input.resolution)) throw new Error("视频参数检查：时长、比例或清晰度不在当前模型支持的选项中。");
  if (/veo/i.test(input.model) && ["1080p", "4k"].includes(input.resolution) && input.duration !== 8) throw new Error("视频参数检查：Veo 的 1080P / 4K 需要选择 8 秒。");
  if (["first_frame", "first_last_frame"].includes(input.mode) && !input.firstFramePath) throw new Error("视频输入检查：请添加首帧图片。");
  if (input.mode === "reference_images") {
    const refs = input.referenceImages;
    if (!Array.isArray(refs) || !refs.length || refs.length > caps.referenceLimit) throw new Error(`视频参考图检查：请添加 1 至 ${caps.referenceLimit} 张参考图。`);
    if (refs.some((ref) => !ref || typeof ref.path !== "string" || !ref.path || !["subject", "scene", "clothing", "style", "other"].includes(ref.purpose))) throw new Error("视频参考图检查：参考图路径或用途无效。");
    if (new Set(refs.map((ref) => ref.path.toLowerCase())).size !== refs.length) throw new Error("视频参考图检查：请勿重复添加同一图片。");
  }
  if (input.mode === "first_last_frame" && !input.lastFramePath) throw new Error("视频输入检查：请添加尾帧图片。");
  if (input.audio !== "default" && (!caps.audio || !["on", "off"].includes(input.audio))) throw new Error("视频参数检查：当前模型不支持音频开关，请选择模型默认。");
  if (input.seed !== undefined && (protocol !== "ark" || !Number.isInteger(input.seed) || input.seed < -1 || input.seed > 4294967295)) throw new Error("视频参数检查：随机种子仅适用于方舟协议，范围为 -1 至 4294967295。");
}

export function videoPixelSize(input: Pick<VideoGenerationInput, "aspectRatio" | "resolution">) {
  if (input.resolution === "1024p") return input.aspectRatio === "9:16" ? "1024x1792" : "1792x1024";
  const edge = input.resolution === "4k" ? 2160 : input.resolution === "1440p" ? 1440 : input.resolution === "1080p" ? 1080 : input.resolution === "480p" ? 480 : 720;
  const [w, h] = input.aspectRatio.split(":").map(Number);
  return w >= h ? `${Math.round(edge * w / h)}x${edge}` : `${edge}x${Math.round(edge * h / w)}`;
}
