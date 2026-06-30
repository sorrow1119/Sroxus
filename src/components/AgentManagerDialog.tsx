import { useEffect, useMemo, useState } from "react";
import type { AIAgent, AIAgentInput, Provider } from "../../shared/types";
import AgentBadge from "./AgentBadge";

interface AgentManagerDialogProps {
  open: boolean;
  agents: AIAgent[];
  providers: Provider[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

const ROLE_PRESETS = [
  {
    name: "代码AI",
    description: "负责写代码、实现功能、解释技术方案",
    rolePreset: "code",
    systemPrompt: "你是代码实现助手。回答要具体、可执行，优先给出清晰的实现方案和代码注意事项。",
  },
  {
    name: "审查AI",
    description: "负责找 bug、风险、边界条件和测试缺口",
    rolePreset: "review",
    systemPrompt: "你是严谨的代码审查助手。优先指出问题、风险、复现方式和建议测试。",
  },
  {
    name: "优化AI",
    description: "负责性能、结构、体验和成本优化建议",
    rolePreset: "optimize",
    systemPrompt: "你是优化顾问。关注效率、性能、用户体验和复杂度，给出务实建议。",
  },
  {
    name: "总结AI",
    description: "负责归纳、整理和生成最终汇总",
    rolePreset: "summary",
    systemPrompt: "你是总结助手。输出要简洁、结构清楚，保留关键结论和下一步。",
  },
];

const EMPTY_FORM: AIAgentInput = {
  name: "",
  description: "",
  providerId: "",
  model: "",
  systemPrompt: "",
  rolePreset: "custom",
  enabled: true,
  isPrimary: false,
};

export default function AgentManagerDialog({ open, agents, providers, onClose, onChanged }: AgentManagerDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AIAgentInput>(EMPTY_FORM);
  const [message, setMessage] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const selectedProvider = providers.find((provider) => provider.id === form.providerId) ?? providers[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!selectedId && agents.length) {
      setSelectedId(agents[0].id);
    }
  }, [agents, open, selectedId]);

  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name,
        description: selected.description,
        providerId: selected.providerId,
        model: selected.model,
        systemPrompt: selected.systemPrompt,
        rolePreset: selected.rolePreset,
        enabled: selected.enabled === 1,
        isPrimary: selected.isPrimary === 1,
      });
    } else {
      setForm({ ...EMPTY_FORM, providerId: providers[0]?.id ?? "", model: providers[0]?.model ?? "" });
    }
    setMessage(null);
  }, [providers, selected]);

  const validation = useMemo(() => validate(form, providers), [form, providers]);

  if (!open) {
    return null;
  }

  async function save() {
    if (validation) {
      setMessage({ type: "error", text: validation });
      return;
    }
    if (selected) {
      await window.electronAPI.agents.update(selected.id, form);
      setMessage({ type: "success", text: "AI 已保存。" });
    } else {
      const created = await window.electronAPI.agents.create(form);
      setSelectedId(created.id);
      setMessage({ type: "success", text: "AI 已创建。" });
    }
    await onChanged();
  }

  async function testAgent() {
    if (validation) {
      setMessage({ type: "error", text: validation });
      return;
    }
    if (!selectedProvider) {
      setMessage({ type: "error", text: "请先选择 Provider。" });
      return;
    }
    setMessage({ type: "info", text: "正在测试 AI..." });
    const result = await window.electronAPI.providers.testConnection({ ...selectedProvider, model: form.model || selectedProvider.model });
    setMessage({ type: result.ok ? "success" : "error", text: result.ok ? `测试成功：${result.message}` : `测试失败：${result.message}` });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[78vh] w-full max-w-5xl overflow-hidden rounded-lg border border-[#343b49] bg-[#11141b] shadow-2xl">
        <aside className="w-64 border-r border-[#2a2f3a] bg-[#0f1117] p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">AI 管理</h2>
            <button
              onClick={() => setSelectedId(null)}
              className="rounded-md bg-[#2563eb] px-2 py-1 text-xs text-white hover:bg-[#1d4ed8]"
            >
              新建
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedId(agent.id)}
                className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                  selectedId === agent.id ? "border-[#3b82f6] bg-[#1d4ed8]/20" : "border-[#343b49] bg-[#151820] hover:bg-[#202633]"
                }`}
              >
                <AgentBadge name={agent.name} agent={agent} compact />
                <div className="mt-1 truncate text-slate-500">{agent.description || "暂无简介"}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[#2a2f3a] px-5 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">{selected ? "编辑 AI" : "新建 AI"}</div>
              <div className="text-xs text-slate-500">配置名字、角色、Provider 和系统提示词</div>
            </div>
            <button onClick={onClose} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
              关闭
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              {ROLE_PRESETS.map((preset) => (
                <button
                  key={preset.rolePreset}
                  onClick={() => setForm((current) => ({ ...current, ...preset }))}
                  className="rounded-md border border-[#343b49] px-3 py-1.5 text-xs text-slate-300 hover:bg-[#242936]"
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="名称" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <Field label="简介" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
              <label className="grid gap-1 text-sm text-slate-300">
                <span>Provider</span>
                <select
                  value={form.providerId}
                  onChange={(event) => {
                    const provider = providers.find((item) => item.id === event.target.value);
                    setForm((current) => ({ ...current, providerId: event.target.value, model: current.model || provider?.model || "" }));
                  }}
                  className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
                >
                  <option value="">请选择 Provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </label>
              <Field label="模型" value={form.model} onChange={(value) => setForm((current) => ({ ...current, model: value }))} />
            </div>

            <label className="mt-4 grid gap-1 text-sm text-slate-300">
              <span>系统提示词</span>
              <textarea
                value={form.systemPrompt}
                onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                className="min-h-32 resize-y rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
                启用
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={Boolean(form.isPrimary)} onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))} />
                设为主AI
              </label>
            </div>

            {message && (
              <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" :
                message.type === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" :
                "border-blue-500/30 bg-blue-500/10 text-blue-200"
              }`}>
                {message.text}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between border-t border-[#2a2f3a] px-5 py-3">
            <button
              onClick={async () => {
                if (!selected || !window.confirm(`删除 AI「${selected.name}」？`)) return;
                await window.electronAPI.agents.delete(selected.id);
                setSelectedId(null);
                await onChanged();
              }}
              disabled={!selected}
              className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              删除
            </button>
            <div className="flex gap-2">
              <button onClick={() => void testAgent()} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
                测试AI
              </button>
              <button onClick={() => void save()} className="rounded-md bg-[#2563eb] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8]">
                保存
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
      />
    </label>
  );
}

function validate(form: AIAgentInput, providers: Provider[]) {
  if (!form.name.trim()) {
    return "请填写 AI 名称。";
  }
  if (!form.providerId || !providers.some((provider) => provider.id === form.providerId)) {
    return "请选择有效的 Provider。";
  }
  if (!form.model.trim()) {
    return "请填写模型名称。";
  }
  return "";
}