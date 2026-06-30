import type { AIAgent } from "../../shared/types";

interface AgentBadgeProps {
  name: string;
  agent?: AIAgent | null;
  compact?: boolean;
  onClick?: () => void;
}

const COLORS = [
  "bg-blue-500/15 text-blue-200 border-blue-400/30",
  "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  "bg-amber-500/15 text-amber-200 border-amber-400/30",
  "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/30",
  "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
  "bg-rose-500/15 text-rose-200 border-rose-400/30",
  "bg-violet-500/15 text-violet-200 border-violet-400/30",
];

export default function AgentBadge({ name, agent, compact = false, onClick }: AgentBadgeProps) {
  const color = COLORS[colorIndex(agent?.id ?? name) % COLORS.length];
  const initial = name.trim().slice(0, 1).toUpperCase() || "A";
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={agent ? `${agent.name}\n${agent.description || agent.systemPrompt || "暂无简介"}` : name}
      className={`inline-flex items-center gap-1.5 rounded-md border ${color} ${
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      } ${onClick ? "hover:bg-white/10" : ""}`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px] font-semibold">
        {initial}
      </span>
      <span className="font-medium">{name}</span>
    </Tag>
  );
}

function colorIndex(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}