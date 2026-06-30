import type { AIAgent, Conversation, Message, RegenerateMode } from "../../shared/types";
import type { ModelChoice } from "../hooks/useChatStore";
import { useI18n } from "../i18n";
import AgentPanel from "./AgentPanel";
import ChatSearch from "./ChatSearch";
import CompressionNotice from "./CompressionNotice";
import MessageComposer from "./MessageComposer";
import MessageList from "./MessageList";
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
          <ChatSearch conversationId={conversation?.id ?? null} onSelectResult={onSelectSearchResult} />
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          hasConversation={Boolean(conversation)}
          generating={generating}
          targetMessageId={targetMessageId}
          onTargetMessageHandled={onTargetMessageHandled}
          onRegenerate={onRegenerate}
        />
      </div>

      <AgentPanel agents={agents} selectedAgentId={selectedAgentId} onSelect={onSelectAgent} onManage={onManageAgents} />
      <MessageComposer
        agents={agents}
        disabled={!conversation || !selectedModel}
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
