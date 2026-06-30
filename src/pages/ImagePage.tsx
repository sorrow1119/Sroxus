import { useEffect, useMemo, useState } from "react";
import type { GeneratedImage, ImageGenerationResult, ImageGenerationSize, Provider } from "../../shared/types";

interface ImagePageProps {
  onBack: () => void;
}

const SIZES: ImageGenerationSize[] = ["1024x1024", "1024x1792", "1792x1024", "768x768", "512x512", "256x256"];

export default function ImagePage({ onBack }: ImagePageProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageGenerationSize>("1024x1024");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const [result, setResult] = useState<ImageGenerationResult | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId) ?? providers.find((provider) => provider.isDefault) ?? providers[0] ?? null,
    [providerId, providers],
  );

  const modelOptions = useMemo(() => {
    if (!selectedProvider) return [];
    return Array.from(new Set([...(selectedProvider.enabledModels ?? []), selectedProvider.model].filter(Boolean)));
  }, [selectedProvider]);

  useEffect(() => {
    window.electronAPI.providers.list().then((rows) => {
      setProviders(rows);
      const first = rows.find((provider) => provider.isDefault) ?? rows[0];
      if (first) {
        setProviderId(first.id);
        setModel(first.model);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedProvider && !model) {
      setModel(selectedProvider.model);
    }
  }, [model, selectedProvider]);

  async function generate() {
    const text = prompt.trim();
    if (!selectedProvider) {
      setMessage({ type: "error", text: "请先在设置里添加一个支持生图的 Provider。" });
      return;
    }
    if (!model.trim()) {
      setMessage({ type: "error", text: "请填写或选择生图模型名。" });
      return;
    }
    if (!text) {
      setMessage({ type: "error", text: "请输入生图提示词。" });
      return;
    }

    setGenerating(true);
    setResult(null);
    setMessage({ type: "info", text: "正在生成图片..." });
    try {
      const next = await window.electronAPI.images.generate({
        providerId: selectedProvider.id,
        model: model.trim(),
        prompt: text,
        size,
        count,
      });
      setResult(next);
      setMessage({ type: "success", text: `生成完成，共 ${next.images.length} 张。` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setGenerating(false);
    }
  }

  function selectProvider(id: string) {
    const next = providers.find((provider) => provider.id === id);
    setProviderId(id);
    setModel(next?.model ?? "");
  }

  return (
    <div className="flex h-screen flex-col bg-[#0f1117] text-slate-100">
      <header className="flex h-14 items-center gap-3 border-b border-[#2a2f3a] bg-[#151820] px-5">
        <button onClick={onBack} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm hover:bg-[#242936]">
          返回
        </button>
        <div>
          <h1 className="text-sm font-semibold">AI 生图</h1>
          <p className="text-xs text-slate-500">使用支持 /v1/images/generations 的云端模型生成图片。</p>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-5 overflow-hidden p-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Provider</span>
              <select
                value={selectedProvider?.id ?? ""}
                onChange={(event) => selectProvider(event.target.value)}
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
              >
                {!providers.length && <option value="">请先添加 Provider</option>}
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm text-slate-300">
              <span>生图模型</span>
              <input
                list="image-models"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="例如 dall-e-3 / gpt-image-1 / 服务商给你的生图模型名"
                className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <datalist id="image-models">
                {modelOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <span className="text-xs text-slate-500">如果聊天模型不能生图，请在这里手动填平台提供的生图模型名。</span>
            </label>

            <label className="grid gap-1 text-sm text-slate-300">
              <span>提示词</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述你想生成的图片，例如：一张未来感桌面 AI 客户端宣传图，深色界面，玻璃质感，高清"
                className="min-h-40 resize-y rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-300">
                <span>尺寸</span>
                <select
                  value={size}
                  onChange={(event) => setSize(event.target.value as ImageGenerationSize)}
                  className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
                >
                  {SIZES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-slate-300">
                <span>数量</span>
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
              {generating ? "生成中..." : "生成图片"}
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
              生成结果会显示在这里
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
        {src ? <img src={src} alt={`Generated ${index + 1}`} className="h-full w-full object-contain" /> : <span className="text-sm text-slate-500">无图片数据</span>}
      </div>
      <figcaption className="space-y-2 p-3">
        {image.revisedPrompt && <p className="text-xs leading-5 text-slate-500">{image.revisedPrompt}</p>}
        <div className="flex flex-wrap gap-2">
          {image.url && (
            <button onClick={() => window.open(image.url, "_blank", "noopener,noreferrer")} className="rounded-md border border-[#343b49] px-2 py-1 text-xs text-slate-300 hover:bg-[#242936]">
              打开
            </button>
          )}
          {src && (
            <a href={src} download={`sroxus-image-${Date.now()}-${index + 1}.png`} className="rounded-md bg-[#2563eb] px-2 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]">
              下载
            </a>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
