import { RECOMMENDED_PROVIDERS } from "../../shared/constants";

interface ProviderRecommendationsProps {
  onUse: (name: string, baseUrl: string) => void;
}

export default function ProviderRecommendations({ onUse }: ProviderRecommendationsProps) {
  return (
    <section className="rounded-lg border border-[#2a2f3a] bg-[#0f1117] p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">推荐服务商</h3>
        <p className="mt-1 text-xs text-slate-500">点击“使用”会自动填写名称和 Base URL；“获取 API Key”会打开申请页面。</p>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {RECOMMENDED_PROVIDERS.map((provider) => (
          <div key={provider.name} className="rounded-md border border-[#343b49] bg-[#151820] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">{provider.name}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{provider.baseUrl}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onUse(provider.name, provider.baseUrl)}
                  className="rounded-md border border-[#343b49] px-2 py-1 text-xs text-slate-300 hover:bg-[#242936]"
                >
                  使用
                </button>
                <button
                  type="button"
                  onClick={() => window.open(provider.signupUrl, "_blank", "noopener,noreferrer")}
                  className="rounded-md bg-[#2563eb] px-2 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                >
                  获取 API Key
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {provider.tags.map((tag) => (
                <span key={tag} className="rounded bg-[#1f2937] px-1.5 py-0.5 text-[11px] text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
