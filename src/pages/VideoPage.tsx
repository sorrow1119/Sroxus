import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Download, Film, Flag, FolderOpen, ImagePlus, Link2, LoaderCircle, Pause, Play, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Square, Trash2, X } from "lucide-react";
import type { ImageAsset, Provider, VideoGenerationInput, VideoProtocol, VideoTask, VideoTaskStatus } from "../../shared/types";
import { defaultVideoProtocol, isVideoModel, resolveVideoEndpoints, validateVideoInput, videoCapabilities, VIDEO_PROTOCOLS, VIDEO_RESOLUTIONS, videoResolutionLabel } from "../../shared/video-configuration";
import ImageModelPicker from "../components/ImageModelPicker";
import { Thumbnail } from "./ImagePage";
import "./image-workspace.css";
import "./video-workspace.css";

type ProviderPreference = Pick<VideoGenerationInput, "model" | "protocol" | "endpointOverride" | "queryEndpointOverride" | "downloadEndpointOverride"> & Partial<Pick<VideoGenerationInput, "mode" | "duration" | "aspectRatio" | "resolution" | "audio" | "seed">>;
interface Draft extends VideoGenerationInput {
  folder: string;
  providerPrefs: Record<string, ProviderPreference>;
  helperProviderId: string;
  helperModel: string;
  helperModels: Record<string, string>;
  creative: boolean;
  shareReferences: boolean;
  originalPrompt: string;
  showAllModels: boolean;
}
const KEY = "sroxus.videoWorkspace.draft.v1";
const initial: Draft = { providerId: "", model: "", prompt: "", protocol: "auto", mode: "text", duration: 5, aspectRatio: "16:9", resolution: "default", audio: "default", folder: "", providerPrefs: {}, helperProviderId: "", helperModel: "", helperModels: {}, creative: false, shareReferences: false, originalPrompt: "", showAllModels: false };
const states: Record<VideoTaskStatus, string> = { submitting: "提交中", submission_unknown: "提交未确认 · 请核对", queued: "排队中", running: "生成中", downloading: "下载中", download_failed: "下载失败 · 视频任务已保留", completed: "已完成", failed: "生成失败 · 输入已保留", cancelled: "已取消", expired: "任务已过期" };
const stages = { submit: "提交", query: "查询", download: "下载", cancel: "取消", recovery: "恢复" };
const modes = { text: "文生视频", first_frame: "首帧生视频", first_last_frame: "首尾帧", reference_images: "多图参考" };
const purposes = { subject: "人物 / 主体", scene: "场景", clothing: "服装", style: "风格", other: "其他" };
const nameOf = (value: string) => value.split(/[\\/]/).pop() || value;
const explain = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, "");
const pickModel = (provider?: Provider, models?: string[]) => [...(models || []), ...(provider?.enabledModels || []), provider?.model || ""].find(isVideoModel) || "";
function Tool({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) { return <button className="iw-icon" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>; }

export default function VideoPage({ onBack, initialFrame }: { onBack: () => void; initialFrame?: string }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [ready, setReady] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const [museProtocols, setMuseProtocols] = useState<Record<string, VideoProtocol>>({});
  const [modelBusy, setModelBusy] = useState(false);
  const [gallery, setGallery] = useState<ImageAsset[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [referenceTarget, setReferenceTarget] = useState<"firstFramePath" | "lastFramePath">("firstFramePath");
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyTask, setBusyTask] = useState("");
  const [panel, setPanel] = useState<"settings" | "helper" | "attach" | null>(null);
  const [attachTarget, setAttachTarget] = useState<VideoTask | null>(null);
  const [remoteId, setRemoteId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<VideoTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoTask | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalSource, setProposalSource] = useState("");
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [playErrors, setPlayErrors] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ file: string; src: string } | null>(null);
  const mounted = useRef(true);
  const galleryRequest = useRef(0);
  const submittingRef = useRef(false);
  const provider = providers.find((item) => item.id === draft.providerId);
  const helper = providers.find((item) => item.id === draft.helperProviderId);
  const protocol = draft.protocol === "auto" ? (draft.model === "muse-video" ? museProtocols[draft.providerId] : undefined) || defaultVideoProtocol(provider?.baseUrl || "", draft.model) : draft.protocol;
  const caps = videoCapabilities(draft.model, protocol, provider?.baseUrl);
  const references = draft.referenceImages || [];
  const update = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));
  const run = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { if (mounted.current) setNotice(explain(error)); } };
  const refresh = async () => { const list = await window.electronAPI.videos.history(); if (mounted.current) setTasks(list); };
  const models = [...new Set([...(catalog[draft.providerId] || []), ...(provider?.enabledModels || [])])].filter((model) => draft.showAllModels || isVideoModel(model));
  const helperList = [...new Set([...(catalog[draft.helperProviderId] || []), ...(helper?.enabledModels || [])])];
  let endpoint = "";
  let configurationError = "";
  if (provider) { try { endpoint = resolveVideoEndpoints(provider.baseUrl, { ...draft, protocol }).submitUrl; } catch (error) { configurationError = explain(error); } }

  async function loadModels(selected: Provider) {
    setModelBusy(true);
    try {
      const result = await window.electronAPI.videos.listModels(selected.id);
      if (!mounted.current) return;
      if (result.museProtocol) setMuseProtocols((current) => ({ ...current, [selected.id]: result.museProtocol! }));
      if (!result.ok) throw new Error(result.message);
      setCatalog((current) => ({ ...current, [selected.id]: result.models }));
      setDraft((current) => current.providerId === selected.id && !current.model ? { ...current, model: pickModel(selected, result.models) } : current);
    } catch (error) { if (mounted.current) setNotice(`模型列表读取失败：${explain(error)}。已保留原列表，可手动输入模型。`); }
    finally { if (mounted.current) setModelBusy(false); }
  }

  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      const list = await window.electronAPI.providers.list();
      if (!mounted.current) return;
      setProviders(list);
      let restored: Partial<Draft> = {};
      try { const raw = localStorage.getItem(KEY); if (raw) restored = JSON.parse(raw); }
      catch { setNotice("视频草稿读取失败，原存储未删除。"); }
      const selected = list.find((item) => item.id === restored.providerId) || list.find((item) => item.enabledModels.some(isVideoModel)) || list.find((item) => /ark\.[^/]*volces\.com/.test(item.baseUrl)) || list[0];
      setDraft({ ...initial, ...restored, providerPrefs: restored.providerPrefs || {}, helperModels: restored.helperModels || {}, providerId: selected?.id || "", model: restored.model || pickModel(selected), ...(initialFrame ? { firstFramePath: initialFrame, mode: "first_frame" as const } : {}) });
    }).finally(() => { if (mounted.current) setReady(true); });
    void run(refresh);
    const timer = window.setInterval(() => void run(refresh), 2000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => { if (ready) { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { setNotice("视频草稿保存失败，关闭前请保留提示词。"); } } }, [draft, ready]);
  useEffect(() => { if (ready && provider) void loadModels(provider); }, [ready, draft.providerId]);
  useEffect(() => {
    if (!ready) return;
    setDraft((current) => ({ ...current, duration: caps.durations.includes(current.duration) ? current.duration : caps.durations[0], aspectRatio: caps.ratios.includes(current.aspectRatio) ? current.aspectRatio : caps.ratios[0], resolution: caps.resolutions.includes(current.resolution) ? current.resolution : "default", audio: caps.audio ? current.audio : "default", seed: protocol === "ark" ? current.seed : undefined }));
  }, [ready, draft.model, protocol, provider?.baseUrl]);
  useEffect(() => {
    if (draft.mode !== "first_last_frame") setReferenceTarget("firstFramePath");
  }, [draft.mode]);
  async function loadGallery(folder: string) {
    const request = ++galleryRequest.current; setGalleryBusy(true);
    try { const list = await window.electronAPI.images.gallery(folder); if (mounted.current && request === galleryRequest.current) { setGallery(list); setPage(0); } }
    catch (error) { if (mounted.current && request === galleryRequest.current) { setGallery([]); setNotice(explain(error)); } }
    finally { if (mounted.current && request === galleryRequest.current) setGalleryBusy(false); }
  }
  useEffect(() => { if (ready && draft.folder) void loadGallery(draft.folder); }, [ready, draft.folder]);
  useEffect(() => setPage(0), [search]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setPreview(null); setPanel(null); setProposal(null); setCancelTarget(null); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);

  const filtered = useMemo(() => gallery.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase())), [gallery, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 48));
  const visible = filtered.slice(page * 48, (page + 1) * 48);
  const unfinished = tasks.filter((task) => ["submitting", "queued", "running", "downloading", "submission_unknown"].includes(task.status));
  const shown = filter === "active" ? unfinished : filter === "completed" ? tasks.filter((task) => task.status === "completed") : tasks;
  const chooseFolder = () => run(async () => { const folder = await window.electronAPI.images.chooseFolder(); if (folder) { if (folder === draft.folder) await loadGallery(folder); else update({ folder }); } });
  const showPreview = (file: string) => run(async () => { const src = await window.electronAPI.images.preview(file); if (mounted.current) setPreview({ file, src }); });
  const addReferences = (files: string[]) => run(async () => {
    const assets = await window.electronAPI.images.importReferences(files, 9);
    setDraft((current) => {
      const next = [...(current.referenceImages || [])];
      for (const asset of assets) if (!next.some((item) => item.path.toLowerCase() === asset.path.toLowerCase())) next.push({ path: asset.path, purpose: "other" });
      if (next.length > 9) { setNotice("最多添加 9 张参考图，原选择已保留。"); return current; }
      return { ...current, referenceImages: next };
    });
  });
  const assign = (file: string, target = referenceTarget) => draft.mode === "reference_images" ? addReferences([file]) : run(async () => { const assets = await window.electronAPI.images.importReferences([file]); if (assets[0]) setDraft((current) => ({ ...current, [target]: assets[0].path, mode: target === "lastFramePath" ? "first_last_frame" : current.mode === "text" ? "first_frame" : current.mode })); });
  const chooseFrame = (target: "firstFramePath" | "lastFramePath") => run(async () => { const assets = await window.electronAPI.images.chooseReferences(); if (assets[0]) await assign(assets[0].path, target); });
  const chooseMultiple = () => run(async () => { const assets = await window.electronAPI.images.chooseReferences(9); if (assets.length) await addReferences(assets.map((asset) => asset.path)); });
  const drop = (event: React.DragEvent, target = referenceTarget) => {
    event.preventDefault();
    const internal = event.dataTransfer.getData("application/x-sroxus-image");
    event.stopPropagation();
    const files = internal ? [internal] : Array.from(event.dataTransfer.files).map((item) => (item as File & { path?: string }).path).filter((file): file is string => Boolean(file));
    if (draft.mode === "reference_images") { if (files.length) void addReferences(files); }
    else if (files[0]) void assign(files[0], target);
  };
  const paste = (event: React.ClipboardEvent) => {
    const item = Array.from(event.clipboardData.items).find((value) => value.kind === "file" && value.type.startsWith("image/"));
    const file = item?.getAsFile(); if (!file) return;
    event.preventDefault();
    void run(async () => { const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("粘贴图片失败")); reader.readAsDataURL(file); }); await assign(await window.electronAPI.data.savePastedImage(dataUrl)); });
  };
  function selectProvider(id: string) {
    setDraft((current) => {
      const preference = current.providerPrefs[id] || { model: pickModel(providers.find((item) => item.id === id), catalog[id]), protocol: "auto" as const, endpointOverride: "", queryEndpointOverride: "", downloadEndpointOverride: "" };
      return { ...current, providerPrefs: { ...current.providerPrefs, [current.providerId]: { model: current.model, protocol: current.protocol, mode: current.mode, duration: current.duration, aspectRatio: current.aspectRatio, resolution: current.resolution, audio: current.audio, seed: current.seed, endpointOverride: current.endpointOverride, queryEndpointOverride: current.queryEndpointOverride, downloadEndpointOverride: current.downloadEndpointOverride } }, providerId: id, ...preference };
    });
  }
  async function generate() {
    if (submittingRef.current) return;
    if (!provider) { setNotice("请先选择供应商。"); return; }
    try { if (configurationError) throw new Error(configurationError); validateVideoInput(draft, protocol, provider.baseUrl); } catch (error) { setNotice(explain(error)); return; }
    submittingRef.current = true; setSubmitting(true);
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
      await window.electronAPI.videos.create(draft);
      if (mounted.current) { setNotice("任务已保存，正在提交。输入与素材已保留。"); await refresh(); }
    } catch (error) { if (mounted.current) setNotice(explain(error)); }
    finally { submittingRef.current = false; if (mounted.current) setSubmitting(false); }
  }
  async function taskAction(task: VideoTask, action: () => Promise<unknown>) {
    if (busyTask) return; setBusyTask(task.id);
    try { await action(); if (mounted.current) await refresh(); }
    catch (error) { if (mounted.current) setNotice(explain(error)); }
    finally { if (mounted.current) setBusyTask(""); }
  }
  function restore(task: VideoTask) { update({ ...task.input, firstFramePath: task.input.firstFramePath, lastFramePath: task.input.lastFramePath, referenceImages: task.input.referenceImages || [], protocol: task.protocol }); setNotice("已恢复该次输入、素材与实际接口配置，尚未重新提交。"); }
  async function removeTask() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try { await window.electronAPI.videos.delete(deleteTarget.id); await refresh(); setDeleteTarget(null); setNotice("已删除本地任务记录，已有文件与当前草稿保留；服务端任务未请求取消。"); }
    catch (error) { setNotice(explain(error)); }
    finally { setDeleting(false); }
  }
  const copy = (text: string) => run(async () => { await navigator.clipboard.writeText(text); setNotice("已复制。"); });
  async function improve() {
    if (optimizing) return;
    if (!draft.prompt.trim() || !draft.helperProviderId || !draft.helperModel.trim()) { setNotice("请填写描述并选择提示词辅助模型。"); return; }
    const source = draft.prompt; setOptimizing(true);
    try {
      const text = await window.electronAPI.videos.improvePrompt({ providerId: draft.helperProviderId, model: draft.helperModel, prompt: source, creative: draft.creative, referencePaths: draft.shareReferences ? draft.mode === "reference_images" ? references.map((ref) => ref.path) : draft.mode !== "text" ? [draft.firstFramePath, ...(draft.mode === "first_last_frame" ? [draft.lastFramePath] : [])].filter((file): file is string => Boolean(file)) : [] : [] });
      if (mounted.current) { setProposalSource(source); setProposal(text); setPanel(null); }
    } catch (error) { if (mounted.current) setNotice(explain(error)); }
    finally { if (mounted.current) setOptimizing(false); }
  }
  return <div className="image-workspace video-workspace">
    <header className="iw-header"><Tool label="返回" onClick={onBack}><ArrowLeft size={19} /></Tool><h1>AI 生视频</h1><span className="iw-tag">视频工作区</span><span className="iw-header-status">{unfinished.length ? `${unfinished.length} 个待处理任务` : "草稿自动保存"}</span><Tool label="关联已有视频任务" onClick={() => { setAttachTarget(null); setRemoteId(""); setPanel("attach"); }}><Link2 size={18} /></Tool></header>
    {notice && <div className="iw-notice" role="status"><span>{notice}</span><Tool label="关闭提示" onClick={() => setNotice("")}><X size={16} /></Tool></div>}
    <main className="vw-layout">
      <aside className="iw-gallery" aria-label="视频素材库">
        <div className="iw-section-head"><h2>图片素材</h2><span>{gallery.length}</span><Tool label="打开素材文件夹" onClick={() => void chooseFolder()}><FolderOpen size={18} /></Tool><Tool label="刷新素材库" disabled={!draft.folder || galleryBusy} onClick={() => void loadGallery(draft.folder)}><RefreshCw size={16} className={galleryBusy ? "iw-spin" : ""} /></Tool></div>
        <p className="iw-folder" title={draft.folder}>{draft.folder || "未选择文件夹"}</p>
        <div className="iw-search"><Search size={15} /><input aria-label="搜索视频素材" placeholder="搜索文件名" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {draft.mode === "first_last_frame" && <div className="iw-segment vw-target"><button aria-pressed={referenceTarget === "firstFramePath"} onClick={() => setReferenceTarget("firstFramePath")}>首帧</button><button aria-pressed={referenceTarget === "lastFramePath"} onClick={() => setReferenceTarget("lastFramePath")}>尾帧</button></div>}
        <div className="iw-gallery-scroll">{!visible.length && <div className="iw-empty"><FolderOpen size={30} /><span>{galleryBusy ? "读取中" : "暂无图片"}</span><button className="iw-command" onClick={() => void chooseFolder()}><FolderOpen size={15} />打开文件夹</button></div>}<div className="iw-gallery-grid">{visible.map((asset) => <figure key={asset.path} className="iw-asset" draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-sroxus-image", asset.path); event.dataTransfer.effectAllowed = "copy"; }}><button className="iw-image-button" aria-label={`预览素材 ${asset.name}`} title={`点击放大预览 ${asset.name}`} onClick={() => void showPreview(asset.path)}><Thumbnail file={asset.path} refresh={asset.modifiedAt} /></button><figcaption title={asset.name}>{asset.name}</figcaption><Tool label={`使用素材 ${asset.name}`} onClick={() => void assign(asset.path)}><Plus size={15} /></Tool></figure>)}</div></div>
        <div className="iw-pagination"><Tool label="上一页素材" disabled={!page} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></Tool><span>{page + 1} / {pages}</span><Tool label="下一页素材" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></Tool></div>
      </aside>
      <section className="vw-tasks" aria-label="视频任务">
        <nav className="iw-section-head iw-tabs"><button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>全部任务 <span>{tasks.length}</span></button><button role="tab" aria-selected={filter === "active"} onClick={() => setFilter("active")}>进行中 <span>{unfinished.length}</span></button><button role="tab" aria-selected={filter === "completed"} onClick={() => setFilter("completed")}>已完成</button><Tool label="刷新视频任务" onClick={() => void run(refresh)}><RefreshCw size={16} /></Tool></nav>
        <div className="vw-task-scroll">{!shown.length && <div className="iw-empty vw-empty"><Film size={40} /><span>暂无视频任务</span></div>}
          {shown.map((task) => <article className="iw-history-entry vw-task" key={task.id} data-task-id={task.id}>
            <div className="iw-result-heading"><strong className={`vw-status vw-status-${task.status}`}>{states[task.status]}{task.pollingPaused && " · 查询已暂停"}</strong><time>{new Date(task.createdAt).toLocaleString()}</time><Tool label="恢复视频输入" onClick={() => restore(task)}><RotateCcw size={16} /></Tool><Tool label="删除视频任务" onClick={() => setDeleteTarget(task)}><Trash2 size={16} /></Tool></div>
            <div className="iw-meta"><span>{task.providerName}</span><span>{task.input.model}</span><span>{task.input.duration} 秒 · {task.input.aspectRatio} · {task.input.resolution === "default" ? "默认清晰度" : task.input.resolution}</span><code>{new URL(task.endpoint).pathname}{task.remoteId ? ` · ${task.remoteId}` : ""}</code></div>
            <p className="iw-prompt-snapshot">{task.input.prompt}</p>{task.sourceName && <p className="iw-lineage">来源：{task.sourceName}</p>}
            <p className="iw-lineage">{modes[task.input.mode]}{task.input.referenceImages?.length ? ` · ${task.input.referenceImages.length} 张参考图 · ${task.input.referenceImages.map((ref, index) => `图${index + 1} ${purposes[ref.purpose]}`).join("、")}` : ""}</p>
            {task.error && <p className="iw-error">{stages[task.stage]}阶段 · {task.error}</p>}
            {["submitting", "queued", "running", "downloading"].includes(task.status) && <div className="vw-progress" aria-label="视频任务阶段"><LoaderCircle size={18} className={task.pollingPaused ? "" : "iw-spin"} /><span>{task.status === "submitting" ? "正在提交任务" : task.status === "queued" ? "等待服务端调度" : task.status === "running" ? "服务端生成中" : "正在保存到本地"}</span></div>}
            {task.status === "completed" && task.playbackUrl && <figure className="vw-video"><video controls preload="metadata" playsInline src={task.playbackUrl} aria-label={task.savedFileName || "生成的视频"} onLoadedMetadata={(event) => { const video = event.currentTarget; setMetadata((current) => ({ ...current, [task.id]: `${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(1)} 秒` })); }} onError={() => setPlayErrors((current) => current[task.id] ? current : { ...current, [task.id]: true })} /><figcaption><span>{task.savedFileName}</span><span>{metadata[task.id]}</span></figcaption>{playErrors[task.id] && <p className="iw-error">本地视频无法播放，文件可能已移动或编码不受支持。可打开所在文件夹检查。</p>}</figure>}
            <div className="vw-task-tools"><button className="iw-command" onClick={() => restore(task)}><RotateCcw size={14} />恢复输入</button>
              {["queued", "running"].includes(task.status) && <Tool label={task.pollingPaused ? "继续查询视频任务" : "暂停本地查询（不取消生成）"} disabled={Boolean(busyTask)} onClick={() => void taskAction(task, () => task.pollingPaused ? window.electronAPI.videos.resume(task.id) : window.electronAPI.videos.pause(task.id))}>{task.pollingPaused ? <Play size={16} /> : <Pause size={16} />}</Tool>}
              {["queued", "running", "download_failed"].includes(task.status) && <Tool label="查询服务端任务状态" disabled={Boolean(busyTask)} onClick={() => void taskAction(task, () => window.electronAPI.videos.refresh(task.id))}><RefreshCw size={16} /></Tool>}
              {task.status === "download_failed" && <button className="iw-command" disabled={Boolean(busyTask)} onClick={() => void taskAction(task, () => window.electronAPI.videos.resume(task.id))}><Download size={15} />重试下载</button>}
              {task.protocol === "ark" && task.status === "queued" && <Tool label="请求取消排队任务" disabled={Boolean(busyTask)} onClick={() => setCancelTarget(task)}><Square size={16} /></Tool>}
              {task.status === "submission_unknown" && <button className="iw-command" onClick={() => { setAttachTarget(task); setRemoteId(""); setPanel("attach"); }}><Link2 size={15} />关联任务 ID</button>}
              {task.status === "completed" && <><Tool label="另存视频" onClick={() => void taskAction(task, async () => { const saved = await window.electronAPI.videos.saveAs(task.id); if (saved) setNotice(`已保存：${saved}`); })}><Download size={16} /></Tool><Tool label="打开视频所在文件夹" onClick={() => void run(() => window.electronAPI.videos.reveal(task.id))}><FolderOpen size={16} /></Tool></>}
              <Tool label="复制视频提示词" onClick={() => void copy(task.input.prompt)}><Copy size={16} /></Tool><Tool label="复制视频脱敏诊断" onClick={() => void copy(task.diagnostic)}><SlidersHorizontal size={16} /></Tool>
            </div><details className="vw-task-detail"><summary>任务详情</summary><pre>{task.diagnostic}</pre></details>
          </article>)}
        </div>
      </section>
      <section className="vw-composer" aria-label="视频生成设置" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event)}>
        <div className="vw-frame-row"><div className="iw-segment vw-mode" role="group" aria-label="视频生成模式">{(Object.keys(modes) as Array<Draft["mode"]>).map((mode) => <button key={mode} aria-pressed={draft.mode === mode} title={!caps.modes.includes(mode) ? mode === "reference_images" ? caps.referenceNote : "当前模型 / 接口未确认此模式" : modes[mode]} onClick={() => update({ mode })}>{modes[mode]}</button>)}</div>
          {["first_frame", "first_last_frame"].includes(draft.mode) && (["firstFramePath", ...(draft.mode === "first_last_frame" ? ["lastFramePath"] : [])] as Array<"firstFramePath" | "lastFramePath">).map((target) => <div key={target} className="vw-frame" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); drop(event, target); }}><button type="button" className="vw-frame-image" aria-label={target === "firstFramePath" ? "选择首帧" : "选择尾帧"} title={draft[target] ? nameOf(draft[target]!) : target === "firstFramePath" ? "选择首帧" : "选择尾帧"} onClick={() => void chooseFrame(target)}>{draft[target] ? <Thumbnail file={draft[target]!} /> : <ImagePlus size={20} />}<span>{target === "firstFramePath" ? "首帧" : "尾帧"}</span></button>{draft[target] && <Tool label={target === "firstFramePath" ? "移除首帧" : "移除尾帧"} onClick={() => update({ [target]: undefined })}><X size={12} /></Tool>}</div>)}
          {draft.originalPrompt && <Tool label="撤销视频提示词优化" onClick={() => update({ prompt: draft.originalPrompt, originalPrompt: "" })}><RotateCcw size={17} /></Tool>}
        </div>
        {!caps.modes.includes(draft.mode) && <p className="iw-error">当前模型 / 接口尚未确认支持此模式，暂不能提交；素材已保留，请切换模型或模式。</p>}
        {protocol === "muse_video" && draft.mode === "first_last_frame" && <p className="vw-model-note">首尾帧按图片顺序与提示词表达，不是原生帧锁定。</p>}
        {draft.mode === "reference_images" && <div className="vw-references" aria-label="视频参考图列表">
          {references.map((ref, index) => <div className="vw-reference" key={ref.path}>
            <div className="vw-reference-image"><Thumbnail file={ref.path} /><span title={nameOf(ref.path)}>图{index + 1}</span><Tool label={`移除参考图 ${index + 1}`} onClick={() => update({ referenceImages: references.filter((_, i) => i !== index) })}><X size={12} /></Tool></div>
            <select aria-label={`参考图 ${index + 1} 用途`} value={ref.purpose} onChange={(event) => update({ referenceImages: references.map((item, i) => i === index ? { ...item, purpose: event.target.value as typeof ref.purpose } : item) })}>{Object.entries(purposes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <div className="vw-reference-order"><Tool label={`前移参考图 ${index + 1}`} disabled={!index} onClick={() => { const next = [...references]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ referenceImages: next }); }}><ArrowLeft size={12} /></Tool><Tool label={`后移参考图 ${index + 1}`} disabled={index === references.length - 1} onClick={() => { const next = [...references]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update({ referenceImages: next }); }}><ArrowRight size={12} /></Tool></div>
          </div>)}
          <button className="vw-reference-add" aria-label="添加视频参考图" title={caps.referenceNote} disabled={references.length >= 9} onClick={() => void chooseMultiple()}><ImagePlus size={22} /><span>{references.length} / 9</span></button>
        </div>}
        <textarea aria-label="视频提示词" placeholder="描述画面、动作和镜头…" rows={3} value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} onPaste={paste} />
        <div className="vw-toolbar"><select aria-label="视频供应商" value={draft.providerId} onChange={(event) => selectProvider(event.target.value)}><option value="">选择供应商</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="vw-model"><ImageModelPicker label="视频模型" models={models} value={draft.model} onChange={(model) => update({ model })} /></div><Tool label="刷新视频模型列表" disabled={!provider || modelBusy} onClick={() => provider && void loadModels(provider)}><RefreshCw size={16} className={modelBusy ? "iw-spin" : ""} /></Tool>
          <select aria-label="视频比例" value={draft.aspectRatio} onChange={(event) => update({ aspectRatio: event.target.value })}>{caps.ratios.map((ratio) => <option key={ratio}>{ratio}</option>)}</select><select aria-label="视频时长" value={draft.duration} onChange={(event) => update({ duration: Number(event.target.value) })}>{caps.durations.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}</select><select aria-label="视频清晰度" value={draft.resolution} onChange={(event) => update({ resolution: event.target.value, ...(/veo/i.test(draft.model) && ["1080p", "4k"].includes(event.target.value) ? { duration: 8 } : {}) })}>{VIDEO_RESOLUTIONS.filter((resolution) => resolution !== "1024p" || caps.resolutions.includes(resolution)).map((resolution) => <option key={resolution} value={resolution} disabled={!caps.resolutions.includes(resolution)}>{videoResolutionLabel(resolution)}{!caps.resolutions.includes(resolution) ? " · 不支持" : ""}</option>)}</select>
          <Tool label="视频接口与高级设置" onClick={() => setPanel("settings")}><SlidersHorizontal size={18} /></Tool><Tool label="AI 完善视频提示词" onClick={() => setPanel("helper")}><Sparkles size={18} /></Tool><button className="iw-primary vw-generate" disabled={!ready || submitting} onClick={() => void generate()}>{submitting ? <LoaderCircle size={17} className="iw-spin" /> : <Film size={17} />}{submitting ? "保存任务中" : "生成视频"}</button>
        </div><div className="vw-composer-meta"><output aria-label="视频实际接口" className="iw-route">{configurationError || endpoint || "未选择供应商"}</output><span>{draft.protocol === "auto" ? "自动匹配" : "手动接口"} · {VIDEO_PROTOCOLS.find((item) => item.value === protocol)?.label}</span></div>
      </section>
    </main>
    {panel && <div className="iw-overlay" onClick={() => setPanel(null)}><div className={`iw-settings-panel vw-dialog ${panel === "helper" ? "vw-helper" : ""}`} role="dialog" aria-modal="true" aria-label={panel === "settings" ? "视频高级设置" : panel === "helper" ? "视频提示词辅助" : "关联已有任务"} onClick={(event) => event.stopPropagation()}><header><h2>{panel === "settings" ? "视频高级设置" : panel === "helper" ? "视频提示词辅助" : "关联已有任务"}</h2><Tool label="关闭视频设置" onClick={() => setPanel(null)}><X size={19} /></Tool></header>
      {panel === "settings" ? <div className="iw-panel-fields"><label>接口协议<select aria-label="视频接口协议" value={draft.protocol} onChange={(event) => update({ protocol: event.target.value as Draft["protocol"] })}><option value="auto">自动匹配</option>{VIDEO_PROTOCOLS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><p className="vw-model-note">{caps.note}</p><label>提交路径<input aria-label="视频提交路径" value={draft.endpointOverride || ""} placeholder={protocol === "ark" ? "/api/v3/contents/generations/tasks" : protocol === "newapi_video" ? "/v1/video/generations" : protocol === "grok_video" ? "/v1/videos/generations" : "/v1/videos"} onChange={(event) => update({ endpointOverride: event.target.value })} /></label><label>查询路径<input aria-label="视频查询路径" value={draft.queryEndpointOverride || ""} placeholder={protocol === "ark" ? "/api/v3/contents/generations/tasks/{id}" : protocol === "newapi_video" ? "/v1/video/generations/{id}" : "/v1/videos/{id}"} onChange={(event) => update({ queryEndpointOverride: event.target.value })} /></label>{["openai_video", "newapi_video"].includes(protocol) && <label>下载路径<input aria-label="视频下载路径" value={draft.downloadEndpointOverride || ""} placeholder="/v1/videos/{id}/content" onChange={(event) => update({ downloadEndpointOverride: event.target.value })} /></label>}
        {caps.audio && <label>声音<select aria-label="视频声音" value={draft.audio} onChange={(event) => update({ audio: event.target.value as Draft["audio"] })}><option value="default">模型默认</option><option value="on">开启</option><option value="off">关闭</option></select></label>}{protocol === "ark" && <label>随机种子<input aria-label="视频随机种子" type="number" min={-1} max={4294967295} value={draft.seed ?? ""} placeholder="模型默认" onChange={(event) => update({ seed: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}<label className="iw-checkbox"><input type="checkbox" checked={draft.showAllModels} onChange={(event) => update({ showAllModels: event.target.checked })} />显示供应商全部模型</label></div>
        : panel === "helper" ? <div className="iw-panel-fields"><label>文本供应商<select aria-label="视频提示词供应商" value={draft.helperProviderId} onChange={(event) => { const id = event.target.value, selected = providers.find((item) => item.id === id); update({ helperProviderId: id, helperModel: draft.helperModels[id] || selected?.model || "" }); if (selected) void loadModels(selected); }}><option value="">选择供应商</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="iw-field"><span>文本 / 视觉模型</span><ImageModelPicker label="视频提示词模型" value={draft.helperModel} models={helperList} onChange={(model) => update({ helperModel: model, helperModels: { ...draft.helperModels, [draft.helperProviderId]: model } })} /></div><label className="iw-checkbox"><input type="checkbox" checked={draft.creative} onChange={(event) => update({ creative: event.target.checked })} />允许创意补充</label><label className="iw-checkbox"><input type="checkbox" checked={draft.shareReferences} onChange={(event) => update({ shareReferences: event.target.checked })} />向辅助模型发送当前参考图片</label><button className="iw-primary" disabled={optimizing} onClick={() => void improve()}>{optimizing ? <LoaderCircle size={16} className="iw-spin" /> : <Sparkles size={16} />}{optimizing ? "完善中" : "完善提示词"}</button></div>
        : <div className="iw-panel-fields"><p className="vw-model-note">{attachTarget ? `${attachTarget.providerName} · ${attachTarget.input.model}` : `${provider?.name || "未选择供应商"} · ${draft.model || "未选择模型"}`}</p><label>服务端任务 ID<input aria-label="已有视频任务 ID" value={remoteId} onChange={(event) => setRemoteId(event.target.value)} /></label><button className="iw-primary" disabled={Boolean(busyTask) || !remoteId.trim()} onClick={() => void run(async () => { setBusyTask("attach"); try { await window.electronAPI.videos.attach(attachTarget?.input || draft, remoteId.trim(), attachTarget?.id); await refresh(); setPanel(null); setNotice("已关联并查询原任务，未提交新的视频生成请求。"); } finally { setBusyTask(""); } })}><Link2 size={16} />关联并查询</button></div>}
      <footer><button className="iw-command" onClick={() => setPanel(null)}>完成</button></footer></div></div>}
    {proposal !== null && <div className="iw-overlay"><div className="iw-proposal" role="dialog" aria-modal="true" aria-label="视频提示词候选"><header><h2>视频提示词候选</h2><Tool label="放弃视频候选" onClick={() => setProposal(null)}><X size={19} /></Tool></header><label>原始描述<p>{proposalSource}</p></label><label>候选提示词<textarea aria-label="视频候选提示词" rows={8} value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><footer><button className="iw-command" onClick={() => setProposal(null)}>取消</button><button className="iw-primary" onClick={() => { update({ prompt: proposal, originalPrompt: proposalSource }); setProposal(null); }}><Check size={16} />应用提示词</button></footer></div></div>}
    {preview && <div className="iw-overlay" onClick={() => setPreview(null)}><div className="iw-preview" role="dialog" aria-modal="true" aria-label="视频素材预览" onClick={(event) => event.stopPropagation()}><header><span>{nameOf(preview.file)}</span><Tool label="关闭素材预览" onClick={() => setPreview(null)}><X size={20} /></Tool></header><img src={preview.src} alt={nameOf(preview.file)} /><footer><button className="iw-command" onClick={() => { void assign(preview.file); setPreview(null); }}><ImagePlus size={16} />用作当前参考</button><Tool label="打开素材所在文件夹" onClick={() => void run(() => window.electronAPI.images.reveal(preview.file))}><FolderOpen size={18} /></Tool></footer></div></div>}
    {cancelTarget && <div className="iw-overlay"><div className="iw-proposal" role="dialog" aria-modal="true" aria-label="确认取消视频任务"><header><h2>取消排队任务</h2><Tool label="返回任务" onClick={() => setCancelTarget(null)}><X size={19} /></Tool></header><p className="vw-confirm">仅向服务端请求取消。若任务已经开始运行，服务端可能拒绝取消，计费以服务商结果为准。</p><footer><button className="iw-command" onClick={() => setCancelTarget(null)}>返回</button><button className="iw-primary" disabled={Boolean(busyTask)} onClick={() => void taskAction(cancelTarget, async () => { await window.electronAPI.videos.cancel(cancelTarget.id); setCancelTarget(null); })}><Square size={16} />确认取消</button></footer></div></div>}
    {deleteTarget && <div className="iw-overlay"><div className="iw-proposal" role="dialog" aria-modal="true" aria-label="确认删除视频任务"><header><h2>删除本地视频任务</h2><Tool label="保留视频任务" disabled={deleting} onClick={() => setDeleteTarget(null)}><X size={19} /></Tool></header><p className="vw-confirm">仅删除本地任务记录并停止本地查询，保留已有视频和参考图文件，不影响当前草稿。服务端任务不会因此取消，可能继续生成或扣费；删除后不能从本地记录恢复该任务。</p><footer><button className="iw-command" disabled={deleting} onClick={() => setDeleteTarget(null)}>保留任务</button><button className="iw-primary" disabled={deleting} onClick={() => void removeTask()}><Trash2 size={16} />{deleting ? "删除中" : "确认删除"}</button></footer></div></div>}
  </div>;
}
