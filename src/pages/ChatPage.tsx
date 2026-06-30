import { useEffect, useState } from "react";
import ChatView from "../components/ChatView";
import Sidebar from "../components/Sidebar";
import SummaryDialog from "../components/SummaryDialog";
import SystemPromptDialog from "../components/SystemPromptDialog";
import AgentManagerDialog from "../components/AgentManagerDialog";
import PluginManagerDialog from "../components/PluginManagerDialog";
import type { AIAgent } from "../../shared/types";
import { useChatStore } from "../hooks/useChatStore";
import SettingsPage from "./SettingsPage";
import ImagePage from "./ImagePage";

export default function ChatPage() {
  const chat = useChatStore();
  const [showSummary, setShowSummary] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [mentionSignal, setMentionSignal] = useState(0);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);

  async function createAndFocusConversation() {
    await chat.createConversation();
    setComposerFocusSignal((value) => value + 1);
  }

  async function refreshAgents() {
    const rows = await window.electronAPI.agents.list();
    setAgents(rows);
    setSelectedAgent((current) => (current ? rows.find((agent) => agent.id === current.id) ?? null : null));
  }

  function selectAgent(agent: AIAgent | null) {
    setSelectedAgent(agent);
    if (agent) {
      setMentionSignal((value) => value + 1);
      setComposerFocusSignal((value) => value + 1);
    }
  }

  function selectSearchResult(conversationId: string, messageId: string) {
    setTargetMessageId(messageId);
    chat.setActiveConversationId(conversationId);
  }

  useEffect(() => {
    void refreshAgents();
  }, [chat.activeConversationId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createAndFocusConversation();
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void chat.compressContext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.compressContext, chat.createConversation]);

  if (showSettings) {
    return (
      <SettingsPage
        onBack={() => {
          setShowSettings(false);
          void chat.refreshProviders();
          void chat.refreshConversations();
          void refreshAgents();
        }}
      />
    );
  }

  if (showImages) {
    return <ImagePage onBack={() => setShowImages(false)} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f1117] text-slate-100">
      <Sidebar
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        onCreate={() => void createAndFocusConversation()}
        onSelect={chat.setActiveConversationId}
        onRename={(id, title) => void chat.renameConversation(id, title)}
        onDelete={(id) => void chat.deleteConversation(id)}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        onOpenImages={() => setShowImages(true)}
        onOpenPlugins={() => setShowPluginManager(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      {!sidebarCollapsed && (
        <div
          className="w-1 cursor-col-resize bg-transparent hover:bg-[#3b82f6]"
          onMouseDown={(event) => {
            const startX = event.clientX;
            const startWidth = sidebarWidth;
            const onMove = (moveEvent: MouseEvent) => {
              setSidebarWidth(Math.min(420, Math.max(220, startWidth + moveEvent.clientX - startX)));
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        />
      )}
      <ChatView
        conversation={chat.activeConversation}
        messages={chat.messages}
        contextStats={chat.contextStats}
        generating={chat.generating}
        focusSignal={composerFocusSignal}
        compressing={chat.compressing}
        compressionMessage={chat.compressionMessage}
        shouldShowCompressionNotice={chat.shouldShowCompressionNotice}
        modelChoices={chat.modelChoices}
        selectedModel={chat.selectedModel}
        agents={agents}
        selectedAgentId={selectedAgent?.id ?? null}
        mentionPrefix={selectedAgent ? `@${selectedAgent.name} ` : ""}
        mentionSignal={mentionSignal}
        onSelectModel={chat.setSelectedModel}
        onSelectAgent={selectAgent}
        onManageAgents={() => setShowAgentManager(true)}
        targetMessageId={targetMessageId}
        onSelectSearchResult={selectSearchResult}
        onTargetMessageHandled={() => setTargetMessageId(null)}
        onSend={chat.sendMessage}
        onRegenerate={chat.regenerateMessage}
        onCompress={chat.compressContext}
        onIgnoreCompressionNotice={chat.ignoreCompressionNotice}
        onClearCompressionMessage={chat.clearCompressionMessage}
        onStop={chat.stopGeneration}
        onOpenSummary={() => setShowSummary(true)}
        onOpenSystemPrompt={() => setShowSystemPrompt(true)}
      />
      <AgentManagerDialog
        open={showAgentManager}
        agents={agents}
        providers={chat.providers}
        onClose={() => setShowAgentManager(false)}
        onChanged={async () => {
          await refreshAgents();
          await chat.refreshProviders();
        }}
      />
      <PluginManagerDialog open={showPluginManager} onClose={() => setShowPluginManager(false)} />
      <SummaryDialog
        open={showSummary}
        conversation={chat.activeConversation}
        onClose={() => setShowSummary(false)}
        onSave={async (summary) => {
          if (!chat.activeConversation) return;
          await chat.updateSummary(chat.activeConversation.id, summary);
        }}
        onClear={async () => {
          if (!chat.activeConversation) return;
          await chat.updateSummary(chat.activeConversation.id, "");
        }}
        onContinue={async () => {
          if (!chat.activeConversation) return;
          await chat.continueFromSummary(chat.activeConversation);
          setShowSummary(false);
        }}
      />
      <SystemPromptDialog
        open={showSystemPrompt}
        conversation={chat.activeConversation}
        onClose={() => setShowSystemPrompt(false)}
        onSave={async (prompt) => {
          if (!chat.activeConversation) return;
          await chat.updateSystemPrompt(chat.activeConversation.id, prompt);
        }}
      />
    </div>
  );
}
