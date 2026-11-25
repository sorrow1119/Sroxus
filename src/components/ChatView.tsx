import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AIAgent, Conversation, Message, RegenerateMode } from "../../shared/types";
import type { ModelChoice } from "../hooks/useChatStore";
import { useI18n } from "../i18n";
import AgentPanel from "./AgentPanel";
import ChatSearch from "./ChatSearch";
import CompressionNotice from "./CompressionNotice";
import MessageComposer from "./MessageComposer";
import MessageList, { type MessageQuote, type SearchMatchSpec } from "./MessageList";
import ModelSelector from "./ModelSelector";

interface ChatViewProps {
  conversation: Conversation | null;
  messages: Message[];
  contextStats: { count: number; chars: number };
  generating: boolean;
  focusSignal: number;
  compressing: boolean;
  compressionMessage: { type: "success" | "error"; text: string } | null;
  shouldShowCompressionNotice: boolean;
  modelChoices: ModelChoice[];
  selectedModel: ModelChoice | null;
  agents: AIAgent[];
  selectedAgentId: string | null;
  mentionPrefix: string;
  mentionSignal: number;
  onSelectModel: (choice: ModelChoice | null) => void;
  onSelectAgent: (agent: AIAgent | null) => void;
  onManageAgents: () => void;
  targetMessageId: string | null;
  onSelectSearchResult: (conversationId: string, messageId: string) => void;
  onTargetMessageHandled: () => void;
  onSend: (content: string, attachments: string[]) => Promise<void> | void;
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
  onCompress: () => Promise<void> | void;
  onIgnoreCompressionNotice: () => void;
  onClearCompressionMessage: () => void;
  onStop: () => Promise<void> | void;
  onOpenSummary: () => void;
  onOpenSystemPrompt: () => void;
}

export default function ChatView({
  conversation,
  messages,
  contextStats,
  generating,
  focusSignal,
  compressing,
  compressionMessage,
  shouldShowCompressionNotice,
  modelChoices,
  selectedModel,
  agents,
  selectedAgentId,
  mentionPrefix,
  mentionSignal,
  onSelectModel,
  onSelectAgent,
  onManageAgents,
  targetMessageId,
  onSelectSearchResult,
  onTargetMessageHandled,
  onSend,
  onRegenerate,
  onCompress,
  onIgnoreCompressionNotice,
  onClearCompressionMessage,
  onStop,
  onOpenSummary,
  onOpenSystemPrompt,
}: ChatViewProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"current" | "all">("current");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const quoteSequence = useRef(0);
  const [quoteRequest, setQuoteRequest] = useState<{ quote: MessageQuote; conversationId: string; id: number } | null>(null);
  const handleQuote = useCallback((quote: MessageQuote) => {
    if (conversation) setQuoteRequest({ quote, conversationId: conversation.id, id: ++quoteSequence.current });
  }, [conversation?.id]);
  const quoteHandled = useCallback((id: number) => setQuoteRequest((current) => current?.id === id ? null : current), []);
  const searchMatches = useMemo(() => buildSearchMatches(messages, searchQuery), [messages, searchQuery]);
  const searchMatchCount = searchMatches.reduce((sum, item) => sum + item.count, 0);
  const matchPosition = searchMatches.length && searchQuery.trim() ? { index: searchActiveIndex + 1, count: searchMatchCount } : null;

  useEffect(() => {
    setSearchQuery("");
    setSearchScope("current");
    setSearchActiveIndex(0);
    setQuoteRequest(null);
  }, [conversation?.id]);

  function handleQueryChange(query: string) {
    setSearchQuery(query);
    setSearchActiveIndex(0);
  }

  function handleScopeChange(scope: "current" | "all") {
    setSearchScope(scope);
    setSearchActiveIndex(0);
  }

  function handleNavigateMatch(direction: 1 | -1) {
    if (!searchMatchCount) {
      return;
    }
    setSearchActiveIndex((current) => (current + direction + searchMatchCount) % searchMatchCount);
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[#0f1117]">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b border-[#2a2f3a] bg-[#151820] px-5 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{conversation?.title ?? t("chat.noConversation")}</div>
          <div className="text-xs text-slate-500">
            {t("chat.contextStats", { count: contextStats.count, chars: contextStats.chars.toLocaleString() })}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <ChatSearch
            conversationId={conversation?.id ?? null}
            query={searchQuery}
            scope={searchScope}
            matchPosition={matchPosition}
            onQueryChange={handleQueryChange}
            onScopeChange={handleScopeChange}
            onNavigateMatch={handleNavigateMatch}
            onSelectResult={onSelectSearchResult}
          />
          <ModelSelector choices={modelChoices} selected={selectedModel} disabled={generating || !modelChoices.length} onSelect={onSelectModel} />
          <button
            onClick={() => void onCompress()}
            disabled={!conversation || compressing || generating}
            className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {compressing ? t("chat.compressing") : t("chat.compress")}
          </button>
          <button onClick={onOpenSummary} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
            {t("chat.summary")}
          </button>
          <button onClick={onOpenSystemPrompt} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
            {t("chat.systemPrompt")}
          </button>
        </div>
      </header>

      {shouldShowCompressionNotice && (
        <CompressionNotice chars={contextStats.chars} compressing={compressing} onCompress={onCompress} onIgnore={onIgnoreCompressionNotice} />
      )}

      {compressionMessage && (
        <div
          className={`border-b px-5 py-2 text-sm ${
            compressionMessage.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/20 bg-rose-500/10 text-rose-200"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{compressionMessage.text}</span>
            <button onClick={onClearCompressionMessage} className="rounded px-2 py-1 text-xs hover:bg-white/10">
              {t("chat.closeNotice")}
            </button>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} data-chat-scroll className="min-h-0 flex-1 overflow-y-auto">
        <MessageList
          key={conversation?.id || "empty"}
          messages={messages}
          hasConversation={Boolean(conversation)}
          generating={generating}
          targetMessageId={targetMessageId}
          onTargetMessageHandled={onTargetMessageHandled}
          searchQuery={searchQuery}
          searchMatches={searchMatches}
          searchActiveIndex={searchActiveIndex}
          onRegenerate={onRegenerate}
          scrollContainerRef={scrollContainerRef}
          onQuote={handleQuote}
        />
      </div>

      <AgentPanel agents={agents} selectedAgentId={selectedAgentId} onSelect={onSelectAgent} onManage={onManageAgents} />
      <MessageComposer
        key={conversation?.id || "empty"}
        conversationId={conversation?.id}
        quoteRequest={quoteRequest}
        onQuoteHandled={quoteHandled}
        agents={agents}
        disabled={!conversation}
        sendDisabled={!selectedModel}
        generating={generating}
        focusSignal={focusSignal}
        mentionPrefix={mentionPrefix}
        mentionSignal={mentionSignal}
        onSend={onSend}
        onStop={onStop}
      />
    </main>
  );
}

function buildSearchMatches(messages: Message[], query: string): SearchMatchSpec[] {
  const text = query.trim().toLowerCase();
  if (!text) {
    return [];
  }
  const matches: SearchMatchSpec[] = [];
  let globalStart = 0;
  for (const message of messages) {
    const content = message.content ?? "";
    const lower = content.toLowerCase();
    let cursor = 0;
    let count = 0;
    while (cursor < lower.length) {
      const found = lower.indexOf(text, cursor);
      if (found < 0) {
        break;
      }
      count += 1;
      cursor = found + text.length;
    }
    if (count) {
      matches.push({ messageId: message.id, globalStart, count });
      globalStart += count;
    }
  }
  return matches;
}
