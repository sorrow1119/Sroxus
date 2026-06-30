import { useEffect, useMemo, useRef, useState } from "react";
import type { AIAgent } from "../../shared/types";
import AgentBadge from "./AgentBadge";

interface AgentMentionInputProps {
  agents: AIAgent[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

type MentionState = {
  start: number;
  end: number;
  query: string;
} | null;

export default function AgentMentionInput({
  agents,
  value,
  disabled,
  placeholder,
  onChange,
  onPaste,
  onSubmit,
  inputRef,
}: AgentMentionInputProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef ?? localRef;
  const [mention, setMention] = useState<MentionState>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const onlineAgents = useMemo(() => agents.filter((agent) => agent.enabled === 1), [agents]);
  const candidates = useMemo(() => {
    if (!mention) {
      return [];
    }
    const query = mention.query.toLowerCase();
    return onlineAgents.filter((agent) => agent.name.toLowerCase().includes(query)).slice(0, 8);
  }, [mention, onlineAgents]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query]);

  function updateMention(nextValue: string, cursor: number) {
    const before = nextValue.slice(0, cursor);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) {
      setMention(null);
      return;
    }
    const query = match[2] ?? "";
    const start = cursor - query.length - 1;
    setMention({ start, end: cursor, query });
  }

  function complete(agent: AIAgent) {
    if (!mention) {
      return;
    }
    const next = `${value.slice(0, mention.start)}@${agent.name} ${value.slice(mention.end)}`;
    const cursor = mention.start + agent.name.length + 2;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => updateMention(value, event.currentTarget.selectionStart)}
        onPaste={onPaste}
        onKeyUp={(event) => updateMention(value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (mention && candidates.length) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % candidates.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
              return;
            }
            if (event.key === "Tab" || (event.key === "Enter" && mention.query)) {
              event.preventDefault();
              complete(candidates[activeIndex] ?? candidates[0]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="max-h-48 min-h-20 w-full resize-none rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#3b82f6] disabled:opacity-60"
        placeholder={placeholder}
      />
      {mention && candidates.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-md border border-[#343b49] bg-[#151820] shadow-xl">
          <div className="border-b border-[#2a2f3a] px-3 py-2 text-xs text-slate-500">选择要 @ 的 AI</div>
          {candidates.map((agent, index) => (
            <button
              key={agent.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                complete(agent);
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                index === activeIndex ? "bg-[#243047]" : "hover:bg-[#202633]"
              }`}
            >
              <AgentBadge name={agent.name} agent={agent} compact />
              <span className="min-w-0 flex-1 truncate text-slate-500">{agent.description || agent.rolePreset || "在线"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
