import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Film, FolderOpen, ImagePlus, LoaderCircle, Maximize2, Play, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Square, Trash2, X } from "lucide-react";
import ImageModelPicker from "../components/ImageModelPicker";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, resolveImageSizing } from "../../shared/image-sizing";
import { defaultImageMode, getImageConfigurationError, getImageInputError, imageCreationMode, imageModePath, resolveImageInput } from "../../shared/image-configuration";
import type { ImageAsset, ImageGenerationInput, ImageGenerationMode, ImageHistoryEntry, Provider } from "../../shared/types";
import "./image-workspace.css";

type Draft = ImageGenerationInput & {
  automatic: boolean; folder: string; helperProviderId: string; helperModel: string;
  creative: boolean; shareReferences: boolean; originalPrompt: string;
  imageModels: Record<string, string>; helperModels: Record<string, string>;
};
const DRAFT_KEY = "sroxus.imageWorkspace.draft.v1";
const initial: Draft = { prompt: "", negativePrompt: "", model: "", size: "1024x1024", aspectRatio: "auto", count: 1, referencePaths: [], referenceMode: "edit", creationMode: "text", automatic: true, folder: "", helperProviderId: "", helperModel: "", creative: false, shareReferences: false, originalPrompt: "", imageModels: {}, helperModels: {} };
const modes: ImageGenerationMode[] = ["openai_images", "openai_image_edits", "chat_completions_image", "gemini_generate_content"];
const statusText: Record<ImageHistoryEntry["status"], string> = { running: "生成中", completed: "已完成", partial: "部分完成", failed: "失败 · 输入已保留", interrupted: "已中断 · 输入已保留" };
const filename = (value: string) => value.split(/[\\/]/).pop() || value;
const explain = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, "");

function IconButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="iw-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

let thumbActive = 0;
const thumbQueue: Array<() => void> = [];
function queueThumbnail(file: string, variant: "gallery" | "result"): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = () => {
      thumbActive++;
      window.electronAPI.images.thumbnail(file, variant).then(resolve, reject).finally(() => { thumbActive--; thumbQueue.shift()?.(); });
    };
    if (thumbActive < 3) run(); else thumbQueue.push(run);
  });
}

export function Thumbnail({ file, refresh = 0, variant = "gallery", ratio }: { file: string; refresh?: number; variant?: "gallery" | "result"; ratio?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState("");
  useEffect(() => {
    let disposed = false;
    setSrc(""); setFailed("");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void queueThumbnail(file, variant).then((value) => { if (!disposed) setSrc(value); }, (error) => { if (!disposed) setFailed(explain(error)); });
    }, { rootMargin: "100px" });
    if (holder.current) observer.observe(holder.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [file, refresh, variant]);
  return <div ref={holder} className={`iw-thumbnail iw-thumbnail-${variant}`} style={ratio ? { aspectRatio: ratio } : undefined}>{src ? <img src={src} alt={filename(file)} draggable={false} /> : failed ? <span title={failed}>无法预览</span> : <LoaderCircle size={18} className="iw-spin" />}</div>;
}

export default function ImagePage({ onBack, onCreateVideo }: { onBack: () => void; onCreateVideo?: (file: string) => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [ready, setReady] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [gallery, setGallery] = useState<ImageAsset[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<ImageHistoryEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalSource, setProposalSource] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ file: string; src: string } | null>(null);
  const [tab, setTab] = useState<"latest" | "history">("latest");
  const [panel, setPanel] = useState<"settings" | "helper" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImageHistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const galleryRequest = useRef(0);
  const mounted = useRef(true);
  const provider = providers.find((item) => item.id === draft.providerId);
  const helper = providers.find((item) => item.id === draft.helperProviderId);
  const references = draft.referencePaths ?? [];
  const creationMode = imageCreationMode(draft);
  const activeReferences = creationMode === "text" ? [] : references;
  const mode = draft.automatic ? defaultImageMode(draft.model || "", creationMode !== "text") : draft.mode || "openai_images";
  const running = history.find((entry) => entry.status === "running");
  const busy = submitting || Boolean(running);
  const update = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));
  const run = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { if (mounted.current) setNotice(explain(error)); } };

  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      const list = await window.electronAPI.providers.list();
      if (!mounted.current) return;
      setProviders(list);
      let restored: Partial<Draft> = {};
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) restored = JSON.parse(raw);
      else {
        const legacy = await window.electronAPI.settings.get("imageGeneration.lastSettings");
        if (legacy) restored = { ...JSON.parse(legacy), automatic: true, endpointOverride: "" };
      }
      const selected = list.find((item) => item.id === restored.providerId) || list.find((item) => /hive/i.test(item.name)) || list.find((item) => item.isDefault) || list[0];
      if (!mounted.current) return;
      setDraft({ ...initial, ...restored, creationMode: imageCreationMode(restored), automatic: restored.creationMode ? restored.automatic !== false : !restored.endpointOverride, aspectRatio: restored.aspectRatio || (restored.size ? "custom" : "auto"), providerId: selected?.id, model: restored.model || bestModel(selected), referencePaths: Array.isArray(restored.referencePaths) ? restored.referencePaths.slice(0, 4) : [] });
    }).finally(() => { if (mounted.current) setReady(true); });
    const refresh = () => { void window.electronAPI.images.history().then((entries) => { if (mounted.current) setHistory(entries); }).catch((error) => { if (mounted.current) setNotice(explain(error)); }); };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
    catch { setNotice("草稿保存失败：本地存储不可用，关闭页面前请复制提示词。"); }
  }, [draft, ready]);

  const loadGallery = async (folder: string) => {
    const request = ++galleryRequest.current;
    setGalleryBusy(true);
    try {
      const entries = await window.electronAPI.images.gallery(folder);
      if (mounted.current && request === galleryRequest.current) { setGallery(entries); setPage(0); }
    } catch (error) {
      if (mounted.current && request === galleryRequest.current) { setGallery([]); setNotice(explain(error)); }
    } finally { if (mounted.current && request === galleryRequest.current) setGalleryBusy(false); }
  };
  useEffect(() => { if (ready && draft.folder) void loadGallery(draft.folder); }, [draft.folder, ready]);
  useEffect(() => { setPage(0); }, [search, sort]);
  useEffect(() => {
    if (!preview && proposal === null && !panel) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setPreview(null); setProposal(null); setPanel(null); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview, proposal, panel]);

  const filtered = useMemo(() => gallery.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "recent" ? b.modifiedAt - a.modifiedAt : a.name.localeCompare(b.name, undefined, { numeric: true })), [gallery, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 48));
  const visible = filtered.slice(page * 48, (page + 1) * 48);
  const showPreview = (file: string) => run(async () => { const src = await window.electronAPI.images.preview(file); if (mounted.current) setPreview({ file, src }); });
  const addReferences = (paths: string[]) => run(async () => {
    const assets = await window.electronAPI.images.importReferences(paths);
    setDraft((current) => {
      const next = [...new Set([...(current.referencePaths ?? []), ...assets.map((asset) => asset.path)])];
      if (next.length > 4) { setNotice("参考图最多 4 张，请先移除多余图片。"); return current; }
      return { ...current, referencePaths: next };
    });
  });

  const generate = async () => {
    if (busy) return;
    if (!provider || !draft.model?.trim() || !draft.prompt.trim()) { setNotice("请选择服务商、模型，并输入提示词。"); return; }
    const error = getImageConfigurationError(provider.baseUrl, mode, draft.endpointOverride);
    if (error) { setNotice(error); return; }
    const input = resolveImageInput({ prompt: draft.prompt, negativePrompt: draft.negativePrompt, providerId: draft.providerId, model: draft.model, mode, creationMode, protocolAutomatic: draft.automatic, endpointOverride: draft.endpointOverride, size: draft.size, aspectRatio: draft.aspectRatio, resolution: draft.resolution, count: draft.count, referencePaths: [...references], referenceMode: draft.referenceMode });
    const inputError = getImageInputError(input);
    if (inputError) { setNotice(inputError); return; }
    try { resolveImageSizing(draft); } catch (error) { setNotice(explain(error)); return; }
    setSubmitting(true); setNotice(""); setTab("latest");
    try {
      await window.electronAPI.images.generate(input);
    } catch (error) { if (mounted.current) setNotice(explain(error)); }
    finally {
      if (mounted.current) { setSubmitting(false); void run(async () => setHistory(await window.electronAPI.images.history())); }
    }
  };

  const improve = async () => {
    if (!draft.helperProviderId || !draft.helperModel || !draft.prompt.trim()) { setNotice("请选择提示词助手的文本模型，并输入原始描述。"); return; }
    setOptimizing(true); setNotice("");
    const source = draft.prompt;
    try {
      const text = await window.electronAPI.images.improvePrompt({ providerId: draft.helperProviderId, model: draft.helperModel, prompt: source, creative: draft.creative, referencePaths: draft.shareReferences ? activeReferences : [] });
      if (mounted.current) { setPanel(null); setProposalSource(source); setProposal(text); }
    } catch (error) { if (mounted.current) setNotice(explain(error)); }
    finally { if (mounted.current) setOptimizing(false); }
  };

  const reuse = (entry: ImageHistoryEntry) => { update({ ...entry.input, creationMode: imageCreationMode(entry.input), aspectRatio: entry.input.aspectRatio || "custom", automatic: entry.input.protocolAutomatic ?? !entry.input.endpointOverride }); setNotice("已恢复该次输入与配置，尚未发起生成。"); };
  const selectProvider = (id: string, helperMode = false) => {
    const selected = providers.find((item) => item.id === id);
    if (helperMode) update({ helperProviderId: id, helperModel: draft.helperModels[id] || selected?.model || "" });
    else update({ providerId: id, model: draft.imageModels[id] || bestModel(selected), automatic: true, endpointOverride: "" });
  };
  const chooseModel = (model: string, helperMode = false) => {
    if (helperMode) update({ helperModel: model, helperModels: { ...draft.helperModels, [draft.helperProviderId]: model } });
    else update({ model, imageModels: { ...draft.imageModels, [draft.providerId || ""]: model }, automatic: true, endpointOverride: "" });
  };
  const pasteImages = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    if (files.length + references.length > 4) { setNotice("参考图最多 4 张。"); return; }
    void run(async () => {
      const paths: string[] = [];
      for (const file of files) {
        const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("粘贴图片读取失败")); reader.readAsDataURL(file); });
        paths.push(await window.electronAPI.data.savePastedImage(url));
      }
      await addReferences(paths);
    });
  };
  const copy = (text: string) => run(async () => { await navigator.clipboard.writeText(text); setNotice("已复制。"); });
  const entries = tab === "latest" ? history.slice(0, 1) : history;
  return <div className="image-workspace">
    <header className="iw-header">
      <IconButton label="返回聊天" onClick={onBack}><ArrowLeft size={19} /></IconButton>
      <h1>AI 生图</h1><span className="iw-tag">创作工作区</span>
      <span className="iw-header-status">{busy ? <><LoaderCircle size={15} className="iw-spin" /> 生成中</> : "草稿自动保存"}</span>
    </header>
    {notice && <div className="iw-notice" role="status"><span>{notice}</span><IconButton label="关闭提示" onClick={() => setNotice("")}><X size={16} /></IconButton></div>}
    <main className="iw-layout">
      <section className="iw-gallery" aria-label="本地图库">
        <div className="iw-section-head"><h2>本地图库</h2><span>{gallery.length}</span>
          <IconButton label="打开图片文件夹" onClick={() => void run(async () => { const folder = await window.electronAPI.images.chooseFolder(); if (folder) { if (folder === draft.folder) await loadGallery(folder); else update({ folder }); } })}><FolderOpen size={18} /></IconButton>
          <IconButton label="刷新图库" disabled={!draft.folder || galleryBusy} onClick={() => void loadGallery(draft.folder)}><RefreshCw size={16} className={galleryBusy ? "iw-spin" : ""} /></IconButton>
        </div>
        <p className="iw-folder" title={draft.folder}>{draft.folder || "未选择文件夹"}</p>
        <div className="iw-search"><Search size={15} /><input aria-label="搜索图片" placeholder="搜索文件名" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <select aria-label="图库排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">文件名</option><option value="recent">最近修改</option></select>
        <div className="iw-gallery-scroll">
          {!visible.length && <div className="iw-empty"><FolderOpen size={30} /><span>{galleryBusy ? "读取中" : draft.folder ? "暂无匹配图片" : "本地图片"}</span><button className="iw-command" onClick={() => void run(async () => { const folder = await window.electronAPI.images.chooseFolder(); if (folder) update({ folder }); })}><FolderOpen size={15} />打开文件夹</button></div>}
          <div className="iw-gallery-grid">{visible.map((asset) => <figure key={asset.path} className="iw-asset" draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-sroxus-image", asset.path); event.dataTransfer.effectAllowed = "copy"; }}>
            <button className="iw-image-button" title={`预览 ${asset.name}`} onClick={() => void showPreview(asset.path)}><Thumbnail file={asset.path} refresh={asset.modifiedAt} /></button>
            <figcaption title={asset.name}>{asset.name}</figcaption>
            <IconButton label={`添加参考图 ${asset.name}`} onClick={() => void addReferences([asset.path])}><Plus size={16} /></IconButton>
          </figure>)}</div>
        </div>
        <div className="iw-pagination"><IconButton label="上一页" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></IconButton><span>{page + 1} / {pageCount}</span><IconButton label="下一页" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></IconButton></div>
      </section>
      <section className="iw-editor iw-composer" aria-label="生图设置" onPaste={pasteImages}>
        <div className="iw-segment iw-creation-modes" role="group" aria-label="创作模式">{([ ["text", "文生图"], ["edit", "修改原图"], ["reference", "参考创作"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={creationMode === value} onClick={() => update({ creationMode: value, referenceMode: value === "reference" ? "reference" : "edit" })}>{label}</button>)}</div>
        <div className="iw-reference-zone" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => {
          event.preventDefault();
          const internal = event.dataTransfer.getData("application/x-sroxus-image");
          const files = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter((value): value is string => Boolean(value));
          if (internal || files.length) void addReferences(internal ? [internal] : files); else setNotice("未取得本地图片路径，请使用选择参考图按钮。");
        }}>
          <button className="iw-add-reference" aria-label="选择参考图" onClick={() => void run(async () => { const assets = await window.electronAPI.images.chooseReferences(); if (assets.length) await addReferences(assets.map((asset) => asset.path)); })}><ImagePlus size={18} /><span>参考图</span><small>{references.length}/4</small></button>
          <div className="iw-references">{references.map((file, index) => <figure key={file} className="iw-reference"><button className="iw-image-button" onClick={() => void showPreview(file)} title={file}><Thumbnail file={file} /></button><figcaption title={filename(file)}>{index === 0 ? "来源 · " : ""}{filename(file)}</figcaption><IconButton label={`移除参考图 ${filename(file)}`} onClick={() => update({ referencePaths: references.filter((item) => item !== file) })}><X size={13} /></IconButton></figure>)}{!references.length && <span className="iw-muted">未添加参考图</span>}</div>
          {creationMode === "text" && references.length > 0 && <span className="iw-muted">素材已保留 · 本次文生图不发送</span>}
        </div>
        <textarea className="iw-prompt-input" aria-label="生图提示词" placeholder="描述画面主体、风格、构图，或输入对原图的修改要求" rows={3} value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} />
        <div className="iw-toolbar">
          <div className="iw-model-group"><select aria-label="生图服务商" disabled={!ready} value={draft.providerId || ""} onChange={(event) => selectProvider(event.target.value)}><option value="" disabled>选择服务商</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ImageModelPicker label="生图模型" value={draft.model || ""} models={provider?.enabledModels || []} onChange={(model) => chooseModel(model)} /></div>
          <select className="iw-ratio-select" aria-label="生成比例" value={draft.aspectRatio || "auto"} onChange={(event) => { update({ aspectRatio: event.target.value as Draft["aspectRatio"] }); if (event.target.value === "custom") setPanel("settings"); }}><option value="auto">自动适配</option>{IMAGE_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}<option value="custom">自定义</option></select>
          <select className="iw-count-select" aria-label="图片数量" value={draft.count} onChange={(event) => update({ count: Number(event.target.value) })}>{[1,2,3,4].map((count) => <option key={count} value={count}>{count} 张</option>)}</select>
          <select className="iw-ratio-select" aria-label="生图清晰度" title={draft.aspectRatio === "custom" ? "自定义尺寸以宽高为准" : "生图清晰度"} disabled={draft.aspectRatio === "custom"} value={draft.aspectRatio === "custom" ? "auto" : draft.resolution || "auto"} onChange={(event) => update({ resolution: event.target.value as Draft["resolution"] })}>{IMAGE_RESOLUTIONS.map((value) => <option key={value} value={value} disabled={value !== "auto" && value !== "1K" && /gpt-image-1(?:\D|$)|dall-e/i.test(draft.model || "")}>{value === "auto" ? "默认清晰度" : value}</option>)}</select>
          <button className="iw-command" onClick={() => setPanel("settings")}><SlidersHorizontal size={15} />全部设置</button>
          <button className="iw-command" onClick={() => setPanel("helper")}><Sparkles size={15} />帮我写</button>
          {draft.originalPrompt && <IconButton label="还原原始描述" onClick={() => update({ prompt: draft.originalPrompt, originalPrompt: "" })}><RotateCcw size={16} /></IconButton>}
          <button className="iw-primary iw-generate" disabled={busy || !ready} onClick={() => void generate()}>{busy ? <LoaderCircle className="iw-spin" size={17} /> : <Play size={17} />}{busy ? "生成中" : creationMode === "text" ? "生成图片" : creationMode === "reference" ? "开始参考创作" : "开始图生图"}</button>{running && <IconButton label="中断生图" onClick={() => void run(() => window.electronAPI.images.cancel(running.id))}><Square size={16} /></IconButton>}
        </div>
        <div className="iw-composer-meta"><output className="iw-route" aria-label="实际接口">{draft.endpointOverride || imageModePath(mode)}</output><span>{draft.aspectRatio === "auto" ? activeReferences.length ? "自动 · 跟随来源图比例" : "自动 · 模型默认" : draft.aspectRatio === "custom" ? draft.size : draft.aspectRatio}</span><IconButton label="刷新模型列表" onClick={() => void run(async () => setProviders(await window.electronAPI.providers.list()))}><RefreshCw size={13} /></IconButton></div>
      </section>
      <section className="iw-results" aria-label="生成结果">
        <div className="iw-section-head iw-tabs"><button role="tab" aria-selected={tab === "latest"} onClick={() => setTab("latest")}>本次结果</button><button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>生成记录 <span>{history.length}</span></button></div>
        <div className="iw-results-scroll">{!entries.length && <div className="iw-empty"><ImagePlus size={38} /><span>暂无生成记录</span></div>}
          {entries.map((entry) => <article key={entry.id} className="iw-history-entry">
            <div className="iw-result-heading"><strong className={`iw-status-${entry.status}`}>{statusText[entry.status]}</strong><time>{new Date(entry.createdAt).toLocaleString()}</time><IconButton label="恢复该次输入" onClick={() => reuse(entry)}><RotateCcw size={16} /></IconButton><IconButton label="删除生图任务" onClick={() => setDeleteTarget(entry)}><Trash2 size={16} /></IconButton></div>
            <div className="iw-meta"><span>{entry.result?.providerName || providers.find((item) => item.id === entry.input.providerId)?.name}</span><span>{entry.input.model}</span><code>{entry.result?.endpoint || imageModePath(entry.input.mode || "openai_images")}</code></div>
            <p className="iw-prompt-snapshot">{entry.input.prompt}</p>
            {entry.input.referencePaths?.length ? <p className="iw-lineage">来源：{entry.input.referencePaths.map(filename).join(" · ")}</p> : null}
            {entry.error && <p className="iw-error">{entry.error}</p>}{entry.result?.warning && <p className="iw-error">{entry.result.warning}</p>}
            {entry.status === "running" && <div className="iw-empty iw-pending"><LoaderCircle size={28} className="iw-spin" /><span>等待图片响应</span></div>}
            {entry.result?.sizeNote && <p className="iw-size-note">{entry.result.sizeNote}</p>}
            <div className="iw-output-grid">{entry.result?.images.map((image, index) => image.savedPath && <figure key={image.savedPath} className="iw-output"><button className="iw-image-button" title="预览生成图片" onClick={() => void showPreview(image.savedPath!)}><Thumbnail file={image.savedPath} variant="result" ratio={image.width && image.height ? image.width / image.height : undefined} /></button><figcaption>{image.savedFileName || `图片 ${index + 1}`}</figcaption><div className="iw-output-tools"><IconButton label="预览图片" onClick={() => void showPreview(image.savedPath!)}><Maximize2 size={16} /></IconButton><IconButton label="用作参考图" onClick={() => void addReferences([image.savedPath!])}><ImagePlus size={16} /></IconButton>{onCreateVideo && <IconButton label="生成视频" onClick={() => onCreateVideo(image.savedPath!)}><Film size={16} /></IconButton>}<IconButton label="另存图片" onClick={() => void run(async () => { const saved = await window.electronAPI.images.saveAs(image.savedPath!); if (saved) setNotice(`已保存：${saved}`); })}><Download size={16} /></IconButton><IconButton label="打开所在文件夹" onClick={() => void run(() => window.electronAPI.images.reveal(image.savedPath!))}><FolderOpen size={16} /></IconButton></div></figure>)}</div>
            <div className="iw-history-tools"><button className="iw-command" onClick={() => reuse(entry)}><RotateCcw size={14} />恢复输入</button><IconButton label="复制提示词" onClick={() => void copy(entry.input.prompt)}><Copy size={15} /></IconButton><IconButton label="复制脱敏诊断" onClick={() => void copy(JSON.stringify({ id: entry.id, status: entry.status, createdAt: entry.createdAt, model: entry.input.model, mode: entry.input.mode, size: entry.input.size, count: entry.input.count, referenceCount: entry.input.referencePaths?.length || 0, savedCount: entry.result?.images.length || 0 }, null, 2))}><Copy size={15} /></IconButton></div>
          </article>)}
        </div>
      </section>
    </main>
    {panel && <div className="iw-overlay" onClick={() => setPanel(null)}><div className="iw-settings-panel" role="dialog" aria-modal="true" aria-label={panel === "settings" ? "全部设置" : "AI 完善提示词"} onClick={(event) => event.stopPropagation()}><header><h2>{panel === "settings" ? "全部设置" : "AI 完善提示词"}</h2><IconButton label="关闭设置" onClick={() => setPanel(null)}><X size={19} /></IconButton></header>
      {panel === "settings" ? <div className="iw-panel-fields">
        <label>调用接口<select aria-label="调用接口" value={draft.automatic ? "auto" : mode} onChange={(event) => update({ automatic: event.target.value === "auto", mode: event.target.value === "auto" ? undefined : event.target.value as ImageGenerationMode, endpointOverride: "" })}><option value="auto">自动匹配</option>{modes.map((item) => <option key={item} value={item}>{imageModePath(item)}</option>)}</select></label>
        <label>尺寸模式<select aria-label="设置生成比例" value={draft.aspectRatio || "auto"} onChange={(event) => update({ aspectRatio: event.target.value as Draft["aspectRatio"] })}><option value="auto">自动适配</option>{IMAGE_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}<option value="custom">自定义宽高</option></select></label>
        {draft.aspectRatio === "custom" && <div className="iw-row"><label>宽度<input aria-label="自定义宽度" type="number" min={1} max={16384} value={draft.size.split("x")[0] || ""} onChange={(event) => update({ size: `${event.target.value}x${draft.size.split("x")[1] || "1024"}` })} /></label><label>高度<input aria-label="自定义高度" type="number" min={1} max={16384} value={draft.size.split("x")[1] || ""} onChange={(event) => update({ size: `${draft.size.split("x")[0] || "1024"}x${event.target.value}` })} /></label></div>}
        <label>反向提示词<textarea aria-label="反向提示词" rows={3} value={draft.negativePrompt || ""} onChange={(event) => update({ negativePrompt: event.target.value })} /></label><label>自定义接口<input aria-label="自定义接口" value={draft.endpointOverride || ""} placeholder={imageModePath(mode)} onChange={(event) => update({ endpointOverride: event.target.value })} /></label>
      </div> : <div className="iw-panel-fields">
        <label>文本服务商<select aria-label="提示词服务商" value={draft.helperProviderId} onChange={(event) => selectProvider(event.target.value, true)}><option value="">选择服务商</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="iw-field"><span>文本 / 视觉模型</span><ImageModelPicker label="提示词模型" value={draft.helperModel} models={helper?.enabledModels || []} onChange={(model) => chooseModel(model, true)} /></div>
        <label className="iw-checkbox"><input type="checkbox" checked={draft.creative} onChange={(event) => update({ creative: event.target.checked })} />允许创意补充</label><label className="iw-checkbox"><input type="checkbox" checked={draft.shareReferences} onChange={(event) => update({ shareReferences: event.target.checked })} />向提示词模型发送参考图</label>
        <button className="iw-primary" disabled={optimizing || !ready} onClick={() => void improve()}>{optimizing ? <LoaderCircle size={16} className="iw-spin" /> : <Sparkles size={16} />}{optimizing ? "完善中" : "完善提示词"}</button>
      </div>}
      <footer><button className="iw-command" onClick={() => setPanel(null)}>完成</button></footer>
    </div></div>}
    {preview && <div className="iw-overlay" onClick={() => setPreview(null)}><div className="iw-preview" role="dialog" aria-modal="true" aria-label="图片预览" onClick={(event) => event.stopPropagation()}><header><span>{filename(preview.file)}</span><IconButton label="关闭预览" onClick={() => setPreview(null)}><X size={20} /></IconButton></header><img src={preview.src} alt={filename(preview.file)} /><footer><button className="iw-command" onClick={() => { void addReferences([preview.file]); setPreview(null); }}><ImagePlus size={16} />用作参考图</button>{onCreateVideo && <button className="iw-command" onClick={() => onCreateVideo(preview.file)}><Film size={16} />生成视频</button>}<IconButton label="打开所在文件夹" onClick={() => void run(() => window.electronAPI.images.reveal(preview.file))}><FolderOpen size={18} /></IconButton></footer></div></div>}
    {proposal !== null && <div className="iw-overlay"><div className="iw-proposal" role="dialog" aria-modal="true" aria-label="提示词候选"><header><h2>提示词候选</h2><IconButton label="放弃候选" onClick={() => setProposal(null)}><X size={19} /></IconButton></header><label>原始描述<p>{proposalSource}</p></label><label>候选提示词<textarea aria-label="候选提示词" rows={9} value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><footer><button className="iw-command" onClick={() => setProposal(null)}>取消</button><button className="iw-primary" onClick={() => { update({ prompt: proposal, originalPrompt: proposalSource }); setProposal(null); }}>应用提示词</button></footer></div></div>}
    {deleteTarget && <div className="iw-overlay"><div className="iw-proposal" role="dialog" aria-modal="true" aria-label="确认删除生图任务"><header><h2>删除本地生图任务</h2><IconButton label="保留生图任务" disabled={deleting} onClick={() => setDeleteTarget(null)}><X size={19} /></IconButton></header><p className="iw-delete-confirm">仅删除本地任务记录并停止本地等待，保留已有图片和参考图文件，不影响当前草稿。服务端仍可能继续生成或扣费；删除后不能从本地记录恢复该任务。</p><footer><button className="iw-command" disabled={deleting} onClick={() => setDeleteTarget(null)}>保留任务</button><button className="iw-primary" disabled={deleting} onClick={() => { if (deleting) return; setDeleting(true); void run(async () => { await window.electronAPI.images.delete(deleteTarget.id); setHistory(await window.electronAPI.images.history()); setDeleteTarget(null); setNotice("已删除本地任务记录，已有文件与当前草稿保留。"); }).finally(() => setDeleting(false)); }}><Trash2 size={16} />{deleting ? "删除中" : "确认删除"}</button></footer></div></div>}
  </div>;
}

function bestModel(provider?: Provider) {
  return provider?.enabledModels.find((model) => /^gpt-image-2$/i.test(model))
    || provider?.enabledModels.find((model) => /gemini.*image/i.test(model))
    || provider?.enabledModels.find((model) => /image|banana/i.test(model)) || provider?.model || "";
}
