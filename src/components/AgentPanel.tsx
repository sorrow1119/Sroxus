import type { AIAgent } from "../../shared/types";
import { useI18n } from "../i18n";
import AgentBadge from "./AgentBadge";

interface AgentPanelProps {
  agents: AIAgent[];
  selectedAgentId: string | null;
  onSelect: (agent: AIAgent | null) => void;
  onManage: () => void;
}

export default function AgentPanel({ agents, selectedAgentId, onSelect, onManage }: AgentPanelProps) {
  const { t } = useI18n();
  const onlineAgents = agents.filter((agent) => agent.enabled === 1);

  return (
    <div className="border-t border-[#2a2f3a] bg-[#11141b] px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-slate-500">{t("agents.online")}</span>
        {onlineAgents.length ? (
          onlineAgents.map((agent) => {
            const selected = agent.id === selectedAgentId;
            return (
              <button
                key={agent.id}
                onClick={() => onSelect(selected ? null : agent)}
                title={agent.description || agent.systemPrompt || agent.name}
                className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                  selected
                    ? "border-[#3b82f6] bg-[#1d4ed8]/30 text-slate-100"
                    : "border-[#343b49] bg-[#151820] text-slate-300 hover:bg-[#242936]"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <AgentBadge name={agent.name} agent={agent} compact />
                  {agent.isPrimary === 1 && <span className="text-[10px] text-emerald-300">{t("agents.primary")}</span>}
                </span>
                {agent.description && <span className="ml-2 max-w-48 truncate align-bottom text-slate-500">{agent.description}</span>}
              </button>
            );
          })
        ) : (
          <span className="rounded-md border border-dashed border-[#343b49] px-2.5 py-1.5 text-xs text-slate-500">{t("agents.none")}</span>
        )}
        <button onClick={onManage} className="ml-auto rounded-md border border-[#343b49] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-[#242936]">
          {t("agents.manage")}
        </button>
      </div>
    </div>
  );
}
