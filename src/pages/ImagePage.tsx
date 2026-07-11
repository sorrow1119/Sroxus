import { useEffect, useMemo, useState } from "react";
import type { GeneratedImage, ImageGenerationMode, ImageGenerationResult, ImageGenerationSize, Provider } from "../../shared/types";

const LAST_IMAGE_SETTINGS_KEY = "imageGeneration.lastSettings";

interface LastImageSettings {
  providerId?: string;
  model?: string;
  mode?: ImageGenerationMode;
  endpointOverride?: string;
  size?: ImageGenerationSize;
  count?: number;
}

interface ImagePageProps {
  onBack: () => void;
}

const T = {
  back: "\u8fd4\u56de",
  title: "AI \u751f\u56fe",
  subtitle: "\u4e0d\u540c\u5e73\u53f0\u7684\u751f\u56fe\u534f\u8bae\u4e0d\u540c\uff0c\u53ef\u4ee5\u5728\u8fd9\u91cc\u5355\u72ec\u9009\u62e9\u751f\u56fe\u63a5\u53e3\u7c7b\u578b\u3002",
  providerEmpty: "\u8bf7\u5148\u6dfb\u52a0 Provider",
  refresh: "\u5237\u65b0",
  refreshing: "\u5237\u65b0\u4e2d",
  modeLabel: "\u751f\u56fe\u8c03\u7528\u65b9\u5f0f",
  endpointLabel: "\u751f\u56fe endpoint \u8986\u76d6\uff0c\u53ef\u9009",
  endpointHelp: "\u7559\u7a7a\u65f6\u4f1a\u6839\u636e Provider Base URL \u81ea\u52a8\u62fc\u63a5\u3002\u53ef\u586b\u5b8c\u6574 URL\uff0c\u4e5f\u53ef\u586b /v1/images/generations \u8fd9\u79cd\u8def\u5f84\u3002",
  modelLabel: "\u751f\u56fe\u6a21\u578b",
  enabledCountPrefix: "\u5df2\u542f\u7528",
  enabledCountSuffix: "\u4e2a",
  modelPlaceholder: "\u53ef\u624b\u52a8\u8f93\u5165\uff0c\u4f8b\u5982 gpt-image-2 / nano banana / gemini-2.5-flash-image",
  modelSearchPlaceholder: "\u641c\u7d22\u5df2\u542f\u7528\u6a21\u578b",
  noMatchedModel: "\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b",
  noEnabledModel: "\u5f53\u524d Provider \u8fd8\u6ca1\u6709\u5df2\u542f\u7528\u6a21\u578b\uff0c\u8bf7\u5148\u5230\u6a21\u578b\u914d\u7f6e\u91cc\u6dfb\u52a0",
  modelHelp: "\u62c9\u53d6\u6a21\u578b\u548c\u751f\u56fe\u8c03\u7528\u53ef\u4ee5\u4e0d\u662f\u540c\u4e00\u4e2a\u63a5\u53e3\uff1b\u8fd9\u91cc\u663e\u793a\u7684\u662f\u5f53\u524d Provider \u5df2\u6dfb\u52a0/\u542f\u7528\u7684\u6a21\u578b\uff0c\u4e5f\u652f\u6301\u624b\u52a8\u8f93\u5165\u3002",
  promptLabel: "\u63d0\u793a\u8bcd",
  promptPlaceholder: "\u63cf\u8ff0\u4f60\u60f3\u751f\u6210\u7684\u56fe\u7247\uff0c\u4f8b\u5982\uff1a\u4e00\u5f20\u672a\u6765\u611f\u684c\u9762 AI \u5ba2\u6237\u7aef\u5ba3\u4f20\u56fe\uff0c\u6df1\u8272\u754c\u9762\uff0c\u73bb\u7483\u8d28\u611f\uff0c\u9ad8\u6e05",
  size: "\u5c3a\u5bf8",
  count: "\u6570\u91cf",
  generating: "\u751f\u6210\u4e2d...",
  generate: "\u751f\u6210\u56fe\u7247",
  resultEmpty: "\u751f\u6210\u7ed3\u679c\u4f1a\u663e\u793a\u5728\u8fd9\u91cc",
  noImageData: "\u65e0\u56fe\u7247\u6570\u636e",
  open: "\u6253\u5f00",
  download: "\u4e0b\u8f7d",
  autoSaved: "\u5df2\u81ea\u52a8\u4fdd\u5b58",
  addProviderFirst: "\u8bf7\u5148\u5728\u8bbe\u7f6e\u91cc\u6dfb\u52a0\u4e00\u4e2a Provider\u3002",
  chooseModel: "\u8bf7\u586b\u5199\u6216\u9009\u62e9\u751f\u56fe\u6a21\u578b\u540d\u3002",
  enterPrompt: "\u8bf7\u8f93\u5165\u751f\u56fe\u63d0\u793a\u8bcd\u3002",
  generatingInfo: "\u6b63\u5728\u751f\u6210\u56fe\u7247...",
  generatedPrefix: "\u751f\u6210\u5b8c\u6210\uff0c\u5171 ",
  generatedSuffix: " \u5f20\u3002",
};

const SIZES: ImageGenerationSize[] = ["1024x1024", "1024x1792", "1792x1024", "768x768", "512x512", "256x256"];

const MODES: Array<{ value: ImageGenerationMode; label: string; hint: string; placeholder: string }> = [
  {
    value: "openai_images",
    label: "OpenAI Images: /v1/images/generations",
    hint: "\u6807\u51c6 OpenAI \u751f\u56fe\u534f\u8bae\u3002\u9002\u5408 DALL-E\u3001gpt-image \u7cfb\u5217\u6216\u517c\u5bb9 Images API \u7684\u5e73\u53f0\u3002",
    placeholder: "/v1/images/generations",
  },
  {
    value: "chat_completions_image",
    label: "Chat Completions Image: /v1/chat/completions",
    hint: "\u90e8\u5206\u4e2d\u8f6c\u5e73\u53f0\u628a\u751f\u56fe\u5305\u88c5\u5728\u804a\u5929\u63a5\u53e3\u91cc\uff0c\u6a21\u578b\u4f1a\u901a\u8fc7 chat \u8fd4\u56de\u56fe\u7247\u94fe\u63a5\u6216 base64\u3002",
    placeholder: "/v1/chat/completions",
  },
  {
    value: "gemini_generate_content",
    label: "Gemini: /v1beta/{model}:generateContent",
    hint: "\u9002\u5408 Gemini/Google \u98ce\u683c\u751f\u56fe\u63a5\u53e3\uff0c\u4f8b\u5982 /v1beta/gemini-2.5-flash-image:generateContent\u3002",
    placeholder: "/v1beta/gemini-2.5-flash-image:generateContent",
  },
];

export default function ImagePage({ onBack }: ImagePageProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [mode, setMode] = useState<ImageGenerationMode>("openai_images");
  const [endpointOverride, setEndpointOverride] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageGenerationSize>("1024x1024");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const [result, setResult] = useState<ImageGenerationResult | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId) ?? providers.find((provider) => provider.isDefault) ?? providers[0] ?? null,
    [providerId, providers],
  );
  const selectedMode = MODES.find((item) => item.value === mode) ?? MODES[0];

  const modelOptions = useMemo(() => {
    if (!selectedProvider) return [];
    return Array.from(new Set([...(selectedProvider.enabledModels ?? []), selectedProvider.model].map((item) => item.trim()).filter(Boolean)));
  }, [selectedProvider]);

  const visibleModelOptions = useMemo(() => {
    const keyword = modelFilter.trim().toLowerCase();
    if (!keyword) return modelOptions;
    return modelOptions.filter((item) => item.toLowerCase().includes(keyword));
  }, [modelFilter, modelOptions]);

  async function loadProviders(preferredProviderId?: string, preferredModel?: string) {
    setLoadingProviders(true);
    try {
      const rows = await window.electronAPI.providers.list();
      setProviders(rows);
      const nextProvider = rows.find((provider) => provider.id === preferredProviderId) ?? rows.find((provider) => provider.isDefault) ?? rows[0];
      if (nextProvider) {
        setProviderId(nextProvider.id);
        const options = Array.from(new Set([...(nextProvider.enabledModels ?? []), nextProvider.model].map((item) => item.trim()).filter(Boolean)));
        const keepModel = preferredModel?.trim() || "";
        setModel(keepModel || options[0] || nextProvider.model || "");
      } else {
        setProviderId("");
        setModel("");
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoadingProviders(false);
    }
  }

  useEffect(() => {
    async function init() {
      let saved: LastImageSettings = {};
      try {
        const raw = await window.electronAPI.settings.get(LAST_IMAGE_SETTINGS_KEY);
        saved = raw ? (JSON.parse(raw) as LastImageSettings) : {};
        if (saved.mode && MODES.some((item) => item.value === saved.mode)) setMode(saved.mode);
        if (saved.endpointOverride !== undefined) setEndpointOverride(saved.endpointOverride);
        if (saved.size && SIZES.includes(saved.size)) setSize(saved.size);
        if (typeof saved.count === "number") setCount(Math.min(4, Math.max(1, Math.trunc(saved.count))));
      } catch {
        saved = {};
      }
      await loadProviders(saved.providerId, saved.model);
      setSettingsLoaded(true);
    }

    void init();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => {
      void window.electronAPI.settings.set(
        LAST_IMAGE_SETTINGS_KEY,
        JSON.stringify({ providerId, model, mode, endpointOverride, size, count }),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [providerId, model, mode, endpointOverride, size, count, settingsLoaded]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (!model && modelOptions.length) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions, selectedProvider]);

  async function generate() {
    const text = prompt.trim();
    if (!selectedProvider) {
      setMessage({ type: "error", text: T.addProviderFirst });
      return;
    }
    if (!model.trim()) {
      setMessage({ type: "error", text: T.chooseModel });
      return;
    }
    if (!text) {
      setMessage({ type: "error", text: T.enterPrompt });
      return;
    }

    setGenerating(true);
    setResult(null);
    setMessage({ type: "info", text: T.generatingInfo });
    try {
      const next = await window.electronAPI.images.generate({
        providerId: selectedProvider.id,
        model: model.trim(),
        prompt: text,
        mode,
        endpointOverride: endpointOverride.trim() || undefined,
        size,
        count,
      });
      setResult(next);
      void window.electronAPI.settings.set(
        LAST_IMAGE_SETTINGS_KEY,
        JSON.stringify({ providerId: selectedProvider.id, model: model.trim(), mode, endpointOverride, size, count }),
      );
      setMessage({ type: "success", text: T.generatedPrefix + next.images.length + T.generatedSuffix });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setGenerating(false);
    }
  }

  function selectProvider(id: string) {
    const next = providers.find((provider) => provider.id === id);
    setProviderId(id);
    const options = next ? Array.from(new Set([...(next.enabledModels ?? []), next.model].map((item) => item.trim()).filter(Boolean))) : [];
    setModel(options.includes(model) ? model : (options[0] ?? ""));
    setModelFilter("");
  }

  return (
    <div className="flex h-screen flex-col bg-[#0f1117] text-slate-100">
      <header className="flex h-14 items-center gap-3 border-b border-[#2a2f3a] bg-[#151820] px-5">
        <button onClick={onBack} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm hover:bg-[#242936]">
          {T.back}
        </button>
        <div>
          <h1 className="text-sm font-semibold">{T.title}</h1>
          <p className="text-xs text-slate-500">{T.subtitle}</p>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-5 overflow-hidden p-5 xl:grid-cols-[460px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Provider</span>
              <div className="flex gap-2">
                <select
                  value={selectedProvider?.id ?? ""}
                  onChange={(event) => selectProvider(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
                >
                  {!providers.length && <option value="">{T.providerEmpty}</option>}
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} ({provider.enabledModels?.length || 1})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadProviders(selectedProvider?.id, model)}
                  disabled={loadingProviders}
                  className="rounded-md border border-[#343b49] px-3 py-2 text-xs text-slate-300 hover:bg-[#242936] disabled:opacity-60"
                >
                  {loadingProviders ? T.refreshing : T.refresh}
                </button>
              </div>
            </label>

            <label className="grid gap-1 text-sm text-slate-300">
              <span>{T.modeLabel}</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ImageGenerationMode)}
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
              >
                {MODES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-xs leading-5 text-slate-500">{selectedMode.hint}</span>
            </label>

            <label className="grid gap-1 text-sm text-slate-300">
              <span>{T.endpointLabel}</span>
              <input
                value={endpointOverride}
                onChange={(event) => setEndpointOverride(event.target.value)}
                placeholder={selectedMode.placeholder}
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <span className="text-xs leading-5 text-slate-500">{T.endpointHelp}</span>
            </label>

            <div className="grid gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span>{T.modelLabel}</span>
                <span className="text-xs text-slate-500">{T.enabledCountPrefix} {modelOptions.length} {T.enabledCountSuffix}</span>
              </div>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={T.modelPlaceholder}
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <input
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={T.modelSearchPlaceholder}
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <div className="max-h-36 overflow-y-auto rounded-md border border-[#343b49] bg-[#0f1117] p-2">
                {visibleModelOptions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {visibleModelOptions.map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() => setModel(item)}
                        className={`max-w-full truncate rounded-md border px-2.5 py-1.5 text-xs ${
                          model === item
                            ? "border-[#3b82f6] bg-[#2563eb]/20 text-blue-100"
                            : "border-[#343b49] text-slate-300 hover:bg-[#242936]"
                        }`}
                        title={item}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-slate-500">
                    {modelOptions.length ? T.noMatchedModel : T.noEnabledModel}
                  </div>
                )}
              </div>
              <span className="text-xs leading-5 text-slate-500">{T.modelHelp}</span>
            </div>

            <label className="grid gap-1 text-sm text-slate-300">
              <span>{T.promptLabel}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={T.promptPlaceholder}
                className="min-h-40 resize-y rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-300">
                <span>{T.size}</span>
                <select
                  value={size}
                  onChange={(event) => setSize(event.target.value as ImageGenerationSize)}
                  disabled={mode === "gemini_generate_content"}
                  className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6] disabled:opacity-60"
                >
                  {SIZES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-slate-300">
                <span>{T.count}</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={count}
                  onChange={(event) => setCount(Math.min(4, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))}
                  className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
                />
              </label>
            </div>

            <button
              onClick={() => void generate()}
              disabled={generating}
              className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? T.generating : T.generate}
            </button>

            {message && (
              <pre
                className={`whitespace-pre-wrap rounded-md border p-3 text-sm ${
                  message.type === "success"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : message.type === "error"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                      : "border-[#343b49] bg-[#0f1117] text-slate-300"
                }`}
              >
                {message.text}
              </pre>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
          {!result ? (
            <div className="flex h-full min-h-[420px] items-center justify-center rounded-lg border border-dashed border-[#343b49] text-sm text-slate-500">
              {T.resultEmpty}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-[#343b49] bg-[#0f1117] p-3 text-xs text-slate-400">
                <div>Provider: {result.providerName}</div>
                <div>Model: {result.model}</div>
                <div className="break-all">Endpoint: {result.endpoint}</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {result.images.map((image, index) => (
                  <GeneratedImageCard key={`${image.url ?? image.dataUrl}-${index}`} image={image} index={index} />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function GeneratedImageCard({ image, index }: { image: GeneratedImage; index: number }) {
  const src = image.dataUrl ?? image.url ?? "";
  return (
    <figure className="overflow-hidden rounded-lg border border-[#343b49] bg-[#0f1117]">
      <div className="flex aspect-square items-center justify-center bg-black/20">
        {src ? <img src={src} alt={`Generated ${index + 1}`} className="h-full w-full object-contain" /> : <span className="text-sm text-slate-500">{T.noImageData}</span>}
      </div>
      <figcaption className="space-y-2 p-3">
        {image.revisedPrompt && <p className="text-xs leading-5 text-slate-500">{image.revisedPrompt}</p>}
        {image.savedPath && <p className="break-all text-xs text-emerald-300">{T.autoSaved}: {image.savedPath}</p>}
        <div className="flex flex-wrap gap-2">
          {image.url && (
            <button onClick={() => window.open(image.url, "_blank", "noopener,noreferrer")} className="rounded-md border border-[#343b49] px-2 py-1 text-xs text-slate-300 hover:bg-[#242936]">
              {T.open}
            </button>
          )}
          {src && (
            <a href={src} download={`sroxus-image-${Date.now()}-${index + 1}.png`} className="rounded-md bg-[#2563eb] px-2 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]">
              {T.download}
            </a>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
