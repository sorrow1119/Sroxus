import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { safeStorage } from "electron";
import type { VideoGenerationInput, VideoTask } from "../../shared/types";
import { resolveVideoEndpoints, validateVideoInput, type VideoEndpoints } from "../../shared/video-configuration";
import { getDb } from "../database";
import { getProvider } from "../database/providers";
import { getStoragePath } from "./storage-path";
import { readReference } from "./image-assets";
import { isMediaTaskDeleted, markMediaTaskDeleted } from "./media-task-deletions";
import { discoverMuseVideoProtocol, remoteTaskId, safeVideoText, taskUrl, videoFetch, VideoClient, VideoRequestError, type RemoteVideoResult } from "./video-client";

interface StoredVideo extends Omit<VideoTask, "diagnostic" | "playbackUrl"> {
  endpoints: VideoEndpoints;
  downloadToken?: string;
  allocatedPath?: string;
  nextPollAt: number;
  queryFailures: number;
}

const active = new Map<string, AbortController>();
const pending = new Set(["submitting", "queued", "running", "downloading"]);
let timer: ReturnType<typeof setInterval> | undefined;
const now = () => new Date().toISOString();
const directory = () => path.join(getStoragePath(), "generated-videos");

function database() {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS video_tasks (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, body TEXT NOT NULL)");
  return db;
}
function all(): StoredVideo[] { return (database().prepare("SELECT body FROM video_tasks ORDER BY createdAt DESC, id DESC").all() as Array<{ body: string }>).map((row) => JSON.parse(row.body)); }
function get(id: string): StoredVideo {
  const row = database().prepare("SELECT body FROM video_tasks WHERE id = ?").get(id) as { body: string } | undefined;
  if (!row) throw new Error("视频任务不存在。");
  return JSON.parse(row.body);
}
function put(task: StoredVideo) {
  if (isMediaTaskDeleted("video", task.id)) return task;
  task.updatedAt = now();
  database().prepare("INSERT INTO video_tasks(id,createdAt,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(task.id, task.createdAt, JSON.stringify(task));
  return task;
}
function log(task: StoredVideo, event: string) {
  const folder = path.join(directory(), "diagnostics");
  fs.mkdirSync(folder, { recursive: true });
  fs.appendFileSync(path.join(folder, `${task.id}.jsonl`), JSON.stringify({ time: now(), id: task.id, event, stage: task.stage, status: task.status, protocol: task.protocol, model: task.input.model, remoteId: task.remoteId, error: task.error }) + "\n", "utf8");
}
function publicTask(task: StoredVideo): VideoTask {
  const { endpoints: _endpoints, downloadToken: _token, allocatedPath: _allocated, nextPollAt: _poll, queryFailures: _failures, ...visible } = task;
  return { ...visible, ...(task.status === "completed" && task.savedPath ? { playbackUrl: pathToFileURL(task.savedPath).toString() } : {}), diagnostic: JSON.stringify({ id: task.id, provider: task.providerName, model: task.input.model, protocol: task.protocol, endpoint: task.endpoint, remoteId: task.remoteId, status: task.status, stage: task.stage, pollingPaused: task.pollingPaused, createdAt: task.createdAt, updatedAt: task.updatedAt, duration: task.input.duration, aspectRatio: task.input.aspectRatio, resolution: task.input.resolution, mode: task.input.mode, referenceCount: task.input.mode === "reference_images" ? task.input.referenceImages?.length || 0 : task.input.mode === "first_last_frame" ? 2 : task.input.mode === "first_frame" ? 1 : 0, referencePurposes: task.input.referenceImages?.map((ref) => ref.purpose), error: task.error }, null, 2) };
}
function protect(url: string) { return safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(url).toString("base64") : "url:" + url; }
function unprotect(value: string) { return value.startsWith("enc:") ? safeStorage.decryptString(Buffer.from(value.slice(4), "base64")) : value.slice(4); }
function client(task: StoredVideo, signal?: AbortSignal) {
  const provider = getProvider(task.input.providerId);
  if (resolveVideoEndpoints(provider.baseUrl, task.input).baseUrl !== task.endpoints.baseUrl) throw new Error("任务恢复检查：供应商地址已变化。为避免向错误地址发送密钥，已保留原任务，请恢复原供应商地址后继续查询。");
  return new VideoClient(provider, task.endpoints, signal);
}
function fail(task: StoredVideo, error: unknown) {
  let key = "";
  try { key = getProvider(task.input.providerId).apiKey; } catch { /* A deleted provider remains recoverable by restoring its configuration. */ }
  task.error = safeVideoText(error, key);
  put(task); log(task, "error");
}

async function prepare(raw: VideoGenerationInput): Promise<StoredVideo> {
  const provider = getProvider(raw.providerId);
  const input: VideoGenerationInput = { providerId: provider.id, model: String(raw.model || "").trim(), prompt: String(raw.prompt || "").trim(), protocol: raw.protocol || "auto", mode: raw.mode, duration: raw.duration, aspectRatio: raw.aspectRatio, resolution: raw.resolution || "default", audio: raw.audio || "default", seed: raw.seed, firstFramePath: raw.firstFramePath, lastFramePath: raw.lastFramePath, referenceImages: raw.referenceImages, endpointOverride: raw.endpointOverride?.trim(), queryEndpointOverride: raw.queryEndpointOverride?.trim(), downloadEndpointOverride: raw.downloadEndpointOverride?.trim() };
  if (input.protocol === "auto" && input.model === "muse-video") input.protocol = await discoverMuseVideoProtocol(provider);
  const endpoints = resolveVideoEndpoints(provider.baseUrl, input);
  validateVideoInput(input, endpoints.protocol, provider.baseUrl);
  if (input.mode !== "reference_images") delete input.referenceImages;
  if (["text", "reference_images"].includes(input.mode)) { delete input.firstFramePath; delete input.lastFramePath; }
  else if (input.mode === "first_frame") delete input.lastFramePath;
  return { id: randomUUID(), createdAt: now(), updatedAt: now(), providerName: provider.name, input, protocol: endpoints.protocol, endpoint: endpoints.submitUrl, endpoints, status: "submitting", stage: "submit", pollingPaused: false, nextPollAt: 0, queryFailures: 0 };
}

async function snapshotReferences(task: StoredVideo) {
  if (task.input.mode === "reference_images") {
    const refs = [];
    for (const [index, source] of (task.input.referenceImages || []).entries()) {
      const ref = await readReference(source.path);
      const folder = path.join(directory(), "references", task.id);
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, `reference-${index + 1}.png`);
      fs.writeFileSync(file, ref.buffer, { flag: "wx" });
      refs.push({ path: file, purpose: source.purpose });
      if (!index) task.sourceName = ref.asset.name;
    }
    task.input.referenceImages = refs;
  }
  for (const key of ["firstFramePath", "lastFramePath"] as const) {
    const source = task.input[key];
    if (!source) continue;
    const ref = await readReference(source);
    const folder = path.join(directory(), "references", task.id);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, key === "firstFramePath" ? "first.png" : "last.png");
    fs.writeFileSync(file, ref.buffer, { flag: "wx" });
    task.input[key] = file;
    if (key === "firstFramePath") task.sourceName = ref.asset.name;
  }
}

export async function createVideoTask(input: VideoGenerationInput) {
  if (all().filter((task) => pending.has(task.status) || task.status === "submission_unknown").length >= 4) throw new Error("已有 4 个未完成或待核对的视频任务，请先处理现有任务。");
  const task = await prepare(input);
  await snapshotReferences(task);
  put(task); log(task, "created_before_submit");
  void submit(task.id);
  return publicTask(task);
}

async function submit(id: string) {
  const controller = new AbortController(); active.set(id, controller);
  try {
    const task = get(id);
    const result = await client(task, controller.signal).submit(task.input);
    if (isMediaTaskDeleted("video", id)) return;
    if (!result.id && result.status !== "downloading") throw new VideoRequestError("提交响应未返回任务 ID，无法确认服务端是否接受任务。", false);
    await accept(get(id), result);
  } catch (error) {
    if (isMediaTaskDeleted("video", id)) return;
    const task = get(id);
    task.status = error instanceof VideoRequestError && error.definite ? "failed" : "submission_unknown";
    task.stage = "submit";
    const text = error instanceof Error ? error.message : String(error);
    fail(task, task.status === "submission_unknown" ? `${text} · 提交结果未确认，原输入已保留。请先核对服务端任务，或关联已有任务 ID，不要直接重复生成。` : text);
  } finally { active.delete(id); }
}

async function accept(task: StoredVideo, result: RemoteVideoResult) {
  if (isMediaTaskDeleted("video", task.id)) return;
  if (result.id) task.remoteId = result.id;
  if (result.url) task.downloadToken = protect(result.url);
  task.status = result.status;
  task.error = result.error;
  task.queryFailures = 0;
  task.nextPollAt = Date.now() + 5000;
  if (result.status === "downloading") task.stage = "download";
  else if (["queued", "running"].includes(result.status)) task.stage = "query";
  put(task); log(task, "remote_state");
  if (result.status === "downloading") await download(task.id);
}

function allocate(task: StoredVideo) {
  if (task.allocatedPath) return task.allocatedPath;
  const folder = path.join(directory(), "outputs"); fs.mkdirSync(folder, { recursive: true });
  const stem = (task.sourceName ? path.parse(task.sourceName).name : "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100).replace(/[. ]+$/, "") || "video";
  for (let i = 1; i <= 9999; i++) {
    const name = `${stem}-video-${String(i).padStart(2, "0")}.mp4`;
    const file = path.join(folder, name);
    try { fs.closeSync(fs.openSync(file, "wx")); task.allocatedPath = file; put(task); return file; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  throw new Error("视频保存阶段失败：来源文件名序号已用完。");
}

async function download(id: string) {
  let task = get(id);
  let temporary = "";
  const controller = active.get(id) || new AbortController();
  try {
    const file = allocate(task); temporary = `${file}.part`;
    if (fs.existsSync(file) && fs.statSync(file).size >= 32) {
      const descriptor = fs.openSync(file, "r"), header = Buffer.alloc(8);
      try { fs.readSync(descriptor, header, 0, 8, 0); } finally { fs.closeSync(descriptor); }
      if (header.toString("ascii", 4, 8) === "ftyp") {
        task = get(id); task.savedPath = file; task.savedFileName = path.basename(file); task.status = "completed"; task.stage = "download"; task.error = undefined; task.downloadToken = undefined;
        put(task); log(task, "recovered_local_download"); return;
      }
    }
    const provider = getProvider(task.input.providerId);
    client(task);
    let target = task.downloadToken ? unprotect(task.downloadToken) : task.remoteId && task.endpoints.contentTemplate ? taskUrl(task.endpoints.contentTemplate, task.remoteId) : "";
    if (!target) throw new Error("视频下载阶段：服务端已完成但未提供下载地址。可继续查询原任务，不会重新生成。");
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const url = new URL(target);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("视频下载地址不是有效的 HTTP(S) 地址。");
      const useKey = url.origin === new URL(task.endpoint).origin;
      response = await videoFetch(url, { headers: useKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}, redirect: "manual", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || redirects === 5) throw new Error("视频下载重定向异常。");
      target = new URL(location, url).toString();
    }
    if (!response?.ok || !response.body) throw new Error(`视频下载阶段失败 [HTTP ${response?.status || "无响应"}]，可重试下载，不必重新生成。`);
    if (Number(response.headers.get("content-length")) > 512 * 1024 * 1024) throw new Error("视频下载超过本地 512 MB 安全上限。");
    const handle = await fs.promises.open(temporary, "w");
    const reader = response.body.getReader();
    let bytes = 0, head = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024 * 1024) throw new Error("视频下载超过本地 512 MB 安全上限。");
        if (head.length < 32) head = Buffer.concat([head, Buffer.from(value)]).subarray(0, 32);
        let offset = 0;
        while (offset < value.byteLength) offset += (await handle.write(value, offset, value.byteLength - offset)).bytesWritten;
      }
      if (bytes < 32 || head.toString("ascii", 4, 8) !== "ftyp") throw new Error("视频下载内容不是有效的 MP4，未将错误页面当作视频保存。");
      await handle.sync();
    } finally { await reader.cancel().catch(() => undefined); await handle.close(); }
    if (isMediaTaskDeleted("video", id)) { await fs.promises.unlink(temporary).catch(() => undefined); return; }
    await fs.promises.rename(temporary, file);
    if (isMediaTaskDeleted("video", id)) return;
    task = get(id); task.savedPath = file; task.savedFileName = path.basename(file); task.status = "completed"; task.stage = "download"; task.error = undefined; task.downloadToken = undefined;
    put(task); log(task, "download_complete");
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (isMediaTaskDeleted("video", id)) return;
    task = get(id); task.status = "download_failed"; task.stage = "download";
    fail(task, error);
  }
}

async function sync(id: string, force = false) {
  if (active.has(id) || isMediaTaskDeleted("video", id)) return;
  let task = get(id);
  if (!pending.has(task.status) && task.status !== "download_failed") return;
  if (task.status === "submitting" || (!force && (task.pollingPaused || task.nextPollAt > Date.now()))) return;
  const controller = new AbortController(); active.set(id, controller);
  try {
    if (task.status === "downloading" || (task.status === "download_failed" && task.downloadToken)) await download(id);
    else if (task.remoteId) {
      const result = await client(task, controller.signal).query(task.remoteId);
      if (isMediaTaskDeleted("video", id)) return;
      await accept(get(id), result);
    }
  } catch (error) {
    if (isMediaTaskDeleted("video", id)) return;
    task = get(id); task.stage = "query"; task.queryFailures++;
    task.nextPollAt = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(task.queryFailures, 4));
    if (error instanceof VideoRequestError && [401, 403, 404].includes(error.httpStatus || 0)) task.pollingPaused = true;
    fail(task, error);
  } finally { active.delete(id); }
}

export function listVideoTasks() { return all().slice(0, 200).map(publicTask); }
export function getVideoTask(id: string) { return publicTask(get(id)); }
export function deleteVideoTask(id: string) {
  const db = database();
  db.transaction(() => {
    markMediaTaskDeleted("video", id);
    db.prepare("DELETE FROM video_tasks WHERE id=?").run(id);
  })();
  active.get(id)?.abort();
}
export async function refreshVideoTask(id: string) {
  const task = get(id);
  if (task.status === "download_failed" && task.remoteId && !active.has(id)) { task.status = "running"; task.downloadToken = undefined; put(task); }
  await sync(id, true); return getVideoTask(id);
}
export function pauseVideoTask(id: string) {
  const task = get(id);
  if (!["queued", "running"].includes(task.status)) throw new Error("只有排队或生成中的任务可以暂停本地查询。");
  task.pollingPaused = true; put(task); log(task, "local_poll_paused"); return publicTask(task);
}
export async function resumeVideoTask(id: string) {
  const task = get(id);
  if (!["queued", "running", "download_failed", "downloading"].includes(task.status)) throw new Error("此任务不能直接恢复查询。提交未确认的任务请先关联服务端任务 ID；失败任务可恢复输入后手动重试。");
  task.pollingPaused = false; task.nextPollAt = 0; put(task);
  await sync(id, true); return getVideoTask(id);
}
export async function cancelVideoTask(id: string) {
  if (active.has(id)) throw new Error("任务正在同步，请稍后再取消。");
  let task = get(id);
  if (task.protocol !== "ark" || task.status !== "queued" || !task.remoteId) throw new Error("仅火山协议下排队中的任务支持请求取消；生成中的任务不能保证停止或免于计费。");
  const controller = new AbortController(); active.set(id, controller);
  try {
    await client(task, controller.signal).cancel(task.remoteId);
    if (isMediaTaskDeleted("video", id)) return;
    task = get(id); task.status = "cancelled"; task.stage = "cancel"; task.error = undefined; put(task); log(task, "cancel_confirmed");
  } catch (error) { if (isMediaTaskDeleted("video", id)) return; task = get(id); task.stage = "cancel"; fail(task, error); throw new Error(task.error); }
  finally { active.delete(id); }
  return getVideoTask(id);
}

export async function attachVideoTask(input: VideoGenerationInput, id: string, localId?: string) {
  remoteTaskId(id);
  const task = localId ? get(localId) : await prepare({ ...input, prompt: input.prompt.trim() || "关联已有视频任务", mode: "text", firstFramePath: undefined, lastFramePath: undefined });
  if (localId && task.status !== "submission_unknown") throw new Error("只能给提交未确认的本地任务关联服务端任务 ID。");
  if (all().some((other) => other.id !== task.id && other.input.providerId === task.input.providerId && other.remoteId === id)) throw new Error("该服务端任务已存在于生成记录中。");
  task.remoteId = id; task.status = "queued"; task.stage = "recovery"; task.pollingPaused = false; task.nextPollAt = 0; task.error = undefined;
  put(task); log(task, "attached_without_submit"); await sync(task.id, true); return getVideoTask(task.id);
}

export function startVideoRecovery() {
  if (timer) return;
  for (const task of all()) {
    if (task.status === "submitting") { task.status = "submission_unknown"; task.stage = "recovery"; task.error = "上次关闭时提交结果未确认。输入已保留，请核对服务端任务或关联任务 ID，不会自动重复提交。"; put(task); }
    else if (pending.has(task.status) && !task.pollingPaused) { task.nextPollAt = 0; put(task); }
  }
  const tick = () => { for (const task of all()) { if (active.size >= 2) break; if (pending.has(task.status) && task.status !== "submitting" && !task.pollingPaused && task.nextPollAt <= Date.now()) void sync(task.id); } };
  timer = setInterval(tick, 5000); timer.unref(); tick();
}

export function stopVideoRecovery() { if (timer) clearInterval(timer); timer = undefined; for (const controller of active.values()) controller.abort(); }
