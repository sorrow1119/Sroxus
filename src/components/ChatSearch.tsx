import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageSearchResult } from "../../shared/types";

interface ChatSearchProps {
  conversationId: string | null;
  onSelectResult: (conversationId: string, messageId: string) => void;
}

type Scope = "current" | "all";

export default function ChatSearch({ conversationId, onSelectResult }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("current");
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const searchConversationId = scope === "current" ? conversationId : null;

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults([]);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      window.electronAPI.messages
        .search(text, searchConversationId)
        .then((rows) => {
          setResults(rows);
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, searchConversationId]);

  const placeholder = useMemo(() => (scope === "current" ? "搜索当前对话" : "搜索全部对话"), [scope]);

  return (
    <div ref={boxRef} className="relative flex min-w-[280px] max-w-[440px] flex-1 items-center gap-2">
      <select
        value={scope}
        onChange={(event) => setScope(event.target.value as Scope)}
        className="rounded-md border border-[#343b49] bg-[#0f1117] px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-[#3b82f6]"
      >
        <option value="current">当前</option>
        <option value="all">全部</option>
      </select>
      <input
        value={query}
        onFocus={() => setOpen(Boolean(query.trim()))}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
      />
      {query && (
        <button
          onClick={() => {
            setQuery("");
            setResults([]);
          }}
          className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-[#242936] hover:text-slate-200"
        >
          清空
        </button>
      )}

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-10 z-20 max-h-96 overflow-y-auto rounded-md border border-[#343b49] bg-[#11141b] shadow-xl">
          <div className="border-b border-[#2a2f3a] px-3 py-2 text-xs text-slate-500">
            {loading ? "搜索中..." : results.length ? `找到 ${results.length} 条结果` : "没有找到结果"}
          </div>
          {results.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onSelectResult(item.conversationId, item.id);
                setOpen(false);
              }}
              className="block w-full border-b border-[#202632] px-3 py-2 text-left last:border-b-0 hover:bg-[#1d222d]"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-slate-300">{item.conversationTitle}</span>
                <span className="shrink-0 text-slate-600">{roleLabel(item.role)}</span>
              </div>
              <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">{snippet(item.content, query)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function roleLabel(role: MessageSearchResult["role"]) {
  if (role === "user") return "用户";
  if (role === "assistant") return "AI";
  return "系统";
}

function snippet(content: string, query: string) {
  const text = content.replace(/\s+/g, " ").trim();
  const index = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (index < 0) {
    return text.slice(0, 160);
  }
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 110);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}
