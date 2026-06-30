import { useMemo, useState } from "react";
import type { Message, RegenerateMode } from "../../shared/types";
import AgentBadge from "./AgentBadge";

type AgentResultGroupProps = {
  parentMessage: Message | undefined;
  messages: Message[];
  generating: boolean;
  renderMessage: (message: Message) => React.ReactNode;
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
};

export default function AgentResultGroup({ parentMessage, messages, renderMessage }: AgentResultGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const title = useMemo(() => summarizeTask(parentMessage?.content ?? "多AI任务"), [parentMessage?.content]);
  const finished = messages.filter((message) => message.status !== "sending").length;

  return (
    <div className="rounded-lg border border-[#343b49] bg-[#11141b]/70">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 border-b border-[#2a2f3a] px-4 py-3 text-left hover:bg-[#151820]"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-200">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {messages.map((message) => (
              <AgentBadge key={message.id} name={message.agentName ?? "AI"} compact />
            ))}
          </div>
        </div>
        <div className="shrink-0 text-xs text-slate-500">
          {finished}/{messages.length} 完成 · {expanded ? "收起" : "展开"}
        </div>
      </button>
      {expanded && <div className="space-y-4 p-4">{messages.map((message) => renderMessage(message))}</div>}
    </div>
  );
}

function summarizeTask(content: string) {
  const line = content.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? content.trim();
  const clean = line.replace(/@\S+\s*/g, "").trim() || "多AI协作结果";
  return clean.length > 64 ? `${clean.slice(0, 64)}...` : clean;
}