import type { Provider, VideoGenerationInput, VideoProtocol, VideoTaskStatus } from "../../shared/types";
import { isLegacyMuseVideo, supportsVideoReferenceContent } from "../../shared/video-configuration";
import { net } from "electron";
import { videoPixelSize, type VideoEndpoints } from "../../shared/video-configuration";
import { readReference } from "./image-assets";
import { sanitizeForLog } from "./privacy-filter";

export interface RemoteVideoResult {
  id?: string;
  status: VideoTaskStatus;
  url?: string;
  error?: string;
}

export class VideoRequestError extends Error {
  constructor(message: string, public readonly definite: boolean, public readonly httpStatus?: number) { super(message); }
}

export function videoFetch(url: string | URL, init: RequestInit = {}) {
  return net.fetch(String(url), { ...init, credentials: "omit" });
}

export async function discoverMuseVideoProtocol(provider: Pick<Provider, "baseUrl">): Promise<VideoProtocol> {
  try {
    const base = new URL(provider.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return "openai_video";
    // A read-only schema probe distinguishes Muse2API from the older Muse bridge.
    // No key or cookies are sent, and redirects cannot move the probe elsewhere.
    const response = await videoFetch(new URL("/openapi.json", base), { redirect: "error", signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const document = await response.json();
      const path = base.pathname.replace(/\/(?:videos(?:\/generations)?)\/?$/, "").replace(/\/$/, "") || "/v1";
      let schema = document.paths?.[`${path}/videos`]?.post?.requestBody?.content?.["application/json"]?.schema;
      if (schema?.$ref?.startsWith("#/components/schemas/")) schema = document.components?.schemas?.[schema.$ref.slice("#/components/schemas/".length)];
      if (schema?.properties?.images && schema?.properties?.duration) return "muse_video";
    }
  } catch { /* Manual protocol selection remains available when discovery is unavailable. */ }
  return "openai_video";
}

function networkFailure(error: unknown, key: string) {
  const cause = error instanceof Error ? (error as Error & { cause?: { code?: string; message?: string } }).cause : undefined;
  return safeVideoText([error instanceof Error ? error.message : String(error), cause?.code, cause?.message].filter(Boolean).join(" · "), key);
}

export function safeVideoText(value: unknown, key = "") {
  let text = value instanceof Error ? value.message : String(value ?? "");
  if (key) text = text.split(key).join("[REDACTED]");
  text = text.replace(/https?:\/\/[^\s"<>]+/gi, (raw) => {
    try { const url = new URL(raw); url.username = ""; url.password = ""; if (url.search) url.search = "?[REDACTED]"; url.hash = ""; return url.toString(); } catch { return "[URL_REDACTED]"; }
  });
  return String(sanitizeForLog(text)).slice(0, 2400);
}

export function remoteTaskId(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,240}$/.test(value)) throw new Error("视频任务检查：服务端任务 ID 格式无效。");
  return value;
}

export function taskUrl(template: string, id: string) { return template.replace("{id}", encodeURIComponent(remoteTaskId(id))); }

export function normalizeVideoResponse(value: unknown, responseUrl?: string): RemoteVideoResult {
  if (!value || typeof value !== "object") throw new VideoRequestError("视频响应解析失败：响应不是任务对象。", false);
  const root = value as Record<string, any>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
  const id = data.task_id || root.task_id || data.request_id || root.request_id || data.id || root.id;
  const state = String(data.status || data.state || root.status || "").toLowerCase();
  const rawUrl = data.result_url || data.content?.video_url || data.video?.url || data.video_url || data.url || data.result?.video_url || data.result?.url || data.outputs?.[0]?.url;
  const url = typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl) ? rawUrl : typeof rawUrl === "string" && /^\/(?!\/)/.test(rawUrl) && responseUrl ? new URL(rawUrl, responseUrl).href : undefined;
  const error = data.fail_reason || data.error?.message || data.error?.code || (typeof data.error === "string" ? data.error : undefined) || root.error?.message;
  let status: VideoTaskStatus;
  if (["failed", "error", "failure", "rejected"].includes(state) || error) status = "failed";
  else if (["cancelled", "canceled"].includes(state)) status = "cancelled";
  else if (["expired", "timeout"].includes(state)) status = "expired";
  else if (["completed", "succeeded", "success", "done"].includes(state) || url) status = "downloading";
  else if (["running", "processing", "in_progress", "generating"].includes(state)) status = "running";
  else if (["queued", "pending", "submitted", "created", "waiting", "not_start", ""].includes(state) && id) status = "queued";
  else throw new VideoRequestError(`视频响应解析失败：未识别的任务状态 ${state || "(空)"}；不会自动重新提交。`, false);
  return { ...(id ? { id: remoteTaskId(String(id)) } : {}), status, url, ...(error ? { error: String(error) } : {}) };
}

export class VideoClient {
  constructor(private readonly provider: Provider, readonly endpoints: VideoEndpoints, private readonly signal?: AbortSignal) {}

  async submit(input: VideoGenerationInput) {
    this.signal?.throwIfAborted();
    let body: BodyInit;
    let contentType: string | undefined;
    const contentTransport = supportsVideoReferenceContent(input.model, this.endpoints.protocol, this.provider.baseUrl);
    const legacyMuse = isLegacyMuseVideo(input.model, this.endpoints.protocol);
    if (input.mode === "reference_images" && !contentTransport && !legacyMuse && this.endpoints.protocol !== "muse_video") throw new VideoRequestError("当前接口未确认多图参考能力，未提交任务。", true);
    if (this.endpoints.protocol === "muse_video") {
      const images: string[] = [];
      let instruction = "";
      if (input.mode === "first_frame" || input.mode === "first_last_frame") {
        images.push((await readReference(input.firstFramePath!)).dataUrl);
        instruction = "[图1] 用作首帧参考，保持主体与外观。";
        if (input.mode === "first_last_frame") {
          images.push((await readReference(input.lastFramePath!)).dataUrl);
          instruction = "[图1] 用作首帧参考，[图2] 用作尾帧参考；按此顺序过渡，不要颠倒。";
        }
      } else if (input.mode === "reference_images") {
        const purpose = { subject: "人物 / 主体", scene: "场景", clothing: "服装", style: "风格", other: "其他参考" };
        for (const ref of input.referenceImages || []) images.push((await readReference(ref.path)).dataUrl);
        instruction = "以下图片均为参考素材，不限定为首帧或尾帧，各图用途：" + (input.referenceImages || []).map((ref, index) => `[图${index + 1}]：${purpose[ref.purpose]}`).join("；");
      }
      body = JSON.stringify({ model: input.model, prompt: instruction ? `${input.prompt}\n${instruction}` : input.prompt, duration: input.duration, aspect_ratio: input.aspectRatio, size: videoPixelSize(input), ...(input.resolution !== "default" ? { resolution: input.resolution } : {}), ...(images.length ? { images } : {}) });
      contentType = "application/json";
    } else if (legacyMuse && ["reference_images", "first_last_frame"].includes(input.mode)) {
      const references: Array<{ data_url: string; role: string; purpose: string }> = [];
      if (input.mode === "first_last_frame") {
        references.push({ data_url: (await readReference(input.firstFramePath!)).dataUrl, role: "first_frame", purpose: "reference" });
        references.push({ data_url: (await readReference(input.lastFramePath!)).dataUrl, role: "last_frame", purpose: "reference" });
      } else {
        const purpose = { subject: "人物 / 主体", scene: "场景", clothing: "服装", style: "风格", other: "参考" };
        for (const ref of input.referenceImages || []) references.push({ data_url: (await readReference(ref.path)).dataUrl, role: "reference", purpose: purpose[ref.purpose] });
      }
      body = JSON.stringify({ model: input.model, prompt: input.prompt, seconds: input.duration, size: videoPixelSize(input), mode: input.mode, references });
      contentType = "application/json";
    } else if (this.endpoints.protocol === "ark" || (contentTransport && ["reference_images", "first_last_frame"].includes(input.mode))) {
      const content: unknown[] = [{ type: "text", text: input.prompt }];
      if (["first_frame", "first_last_frame"].includes(input.mode)) content.push({ type: "image_url", image_url: { url: (await readReference(input.firstFramePath!)).dataUrl }, role: "first_frame" });
      if (input.mode === "first_last_frame") content.push({ type: "image_url", image_url: { url: (await readReference(input.lastFramePath!)).dataUrl }, role: "last_frame" });
      if (input.mode === "reference_images") {
        const purpose = { subject: "人物 / 主体", scene: "场景", clothing: "服装", style: "风格", other: "参考" };
        for (const ref of input.referenceImages || []) content.push({ type: "image_url", image_url: { url: (await readReference(ref.path)).dataUrl }, role: "reference_image" });
        const labels = (input.referenceImages || []).map((ref, index) => `图${index + 1}：${purpose[ref.purpose]}`).join("；");
        content[0] = { type: "text", text: `${input.prompt}\n参考图用途（按附图顺序，不限定首帧）：${labels}` };
      }
      body = JSON.stringify(this.endpoints.protocol === "ark"
        ? { model: input.model, content, duration: input.duration, ratio: input.aspectRatio, ...(input.resolution !== "default" ? { resolution: input.resolution } : {}), ...(input.audio !== "default" ? { generate_audio: input.audio === "on" } : {}), ...(input.seed !== undefined ? { seed: input.seed } : {}) }
        : { model: input.model, prompt: (content[0] as { text: string }).text, seconds: input.duration, size: videoPixelSize(input), content });
      contentType = "application/json";
    } else if (this.endpoints.protocol === "newapi_video") {
      const [w, h] = videoPixelSize(input).split("x").map(Number);
      body = JSON.stringify({ model: input.model, prompt: input.prompt, duration: input.duration,
        width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2,
        ...(input.resolution !== "default" ? { metadata: { resolution: input.resolution, aspect_ratio: input.aspectRatio } } : {}),
        ...(input.mode !== "text" ? { image: (await readReference(input.firstFramePath!)).dataUrl } : {}) });
      contentType = "application/json";
    } else if (this.endpoints.protocol === "grok_video") {
      body = JSON.stringify({ model: input.model, prompt: input.prompt, duration: input.duration, aspect_ratio: input.aspectRatio,
        ...(input.resolution !== "default" ? { resolution: input.resolution } : {}),
        ...(input.mode !== "text" ? { image: { url: (await readReference(input.firstFramePath!)).dataUrl } } : {}) });
      contentType = "application/json";
    } else {
      const form = new FormData();
      for (const [key, value] of Object.entries({ model: input.model, prompt: input.prompt, seconds: String(input.duration), size: videoPixelSize(input) })) form.append(key, value);
      if (input.mode !== "text") {
        const ref = await readReference(input.firstFramePath!);
        if (/sora/i.test(input.model) && `${ref.width}x${ref.height}` !== videoPixelSize(input)) throw new VideoRequestError(`视频参考图检查：当前 Sora 兼容接口要求图片尺寸与输出一致（${videoPixelSize(input)}），实际为 ${ref.width}x${ref.height}。`, true);
        form.append("input_reference", new Blob([new Uint8Array(ref.buffer)], { type: "image/png" }), ref.uploadName);
      }
      body = form;
    }
    this.signal?.throwIfAborted();
    return this.request(this.endpoints.submitUrl, "POST", body, contentType, "提交");
  }

  async query(id: string) {
    const result = await this.request(taskUrl(this.endpoints.queryTemplate, id), "GET", undefined, undefined, "查询");
    if (this.endpoints.protocol === "newapi_video" && result.url && this.endpoints.contentTemplate) {
      const content = taskUrl(this.endpoints.contentTemplate, id), remote = new URL(result.url);
      // A relay may advertise its public hostname for an authenticated content route.
      // Use the configured origin for that exact route, never forward a key to an alias.
      if (!remote.search && remote.pathname === new URL(content).pathname) result.url = content;
    }
    // Relays can return an internal row ID; keep polling the public submission ID.
    return { ...result, id: remoteTaskId(id) };
  }

  async cancel(id: string) {
    if (this.endpoints.protocol !== "ark") throw new Error("当前视频协议未声明取消能力，只能暂停本地查询。");
    await this.request(taskUrl(this.endpoints.queryTemplate, id), "DELETE", undefined, undefined, "取消", true);
  }

  private async request(url: string, method: string, body: BodyInit | undefined, contentType: string | undefined, stage: string, empty = false): Promise<RemoteVideoResult> {
    const timeout = AbortSignal.timeout(method === "POST" ? 90000 : 30000);
    const signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
    let response: Response;
    try {
      response = await videoFetch(url, { method, body, headers: { Authorization: `Bearer ${this.provider.apiKey}`, ...(contentType ? { "Content-Type": contentType } : {}) }, signal, redirect: "error" });
    } catch (error) { throw new VideoRequestError(`视频${stage}阶段网络失败：${networkFailure(error, this.provider.apiKey)}`, false); }
    if (!response.ok) {
      const text = (await response.text()).slice(0, 16000);
      let detail = "";
      try { const data = JSON.parse(text); detail = data.error?.message || data.message || data.error?.code || ""; } catch { detail = text.replace(/<[^>]*>/g, " ").slice(0, 500); }
      const reason = response.status === 402 ? "余额 / 订阅 / 额度不足" : response.status === 401 ? "密钥无效或权限不足" : response.status === 404 ? "接口或任务不存在" : response.status === 429 ? "限流或配额不足" : "服务端拒绝请求";
      throw new VideoRequestError(`视频${stage}阶段失败：${reason} [HTTP ${response.status}]${detail ? ` · ${safeVideoText(detail, this.provider.apiKey)}` : ""}`, response.status >= 400 && response.status < 500, response.status);
    }
    if (empty) return { status: "cancelled" };
    let value: unknown;
    try { value = await response.json(); } catch { throw new VideoRequestError(`视频${stage}响应解析失败：未返回 JSON 任务；不要直接重复提交。`, false); }
    const result = normalizeVideoResponse(value, this.endpoints.protocol === "muse_video" ? url : undefined);
    if (result.error) result.error = safeVideoText(result.error, this.provider.apiKey);
    return result;
  }
}
