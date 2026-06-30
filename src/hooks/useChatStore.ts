import { useCallback, useEffect, useMemo, useState } from "react";
import type { Conversation, Message, Provider } from "../../shared/types";

export interface ModelChoice {
  providerId: string;
  providerName: string;
  model: string;
  label: string;
}

export function useChatStore() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedModel, setSelectedModelState] = useState<ModelChoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [compressionMessage, setCompressionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [compressThreshold, setCompressThreshold] = useState(12000);
  const [compressionNoticeEnabled, setCompressionNoticeEnabled] = useState(true);
  const [ignoredCompressionConversationId, setIgnoredCompressionConversationId] = useState<string | null>(null);
  const [ignoredCompressionSignature, setIgnoredCompressionSignature] = useState("");

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const modelChoices = useMemo(() => flattenModelChoices(providers), [providers]);

  const defaultModelChoice = useCallback(
    (rows = providers) => {
      const choices = flattenModelChoices(rows);
      if (!choices.length) {
        return null;
      }
      const defaultProvider = rows.find((provider) => provider.isDefault) ?? rows[0];
      return (
        choices.find((choice) => choice.providerId === defaultProvider?.id && choice.model === defaultProvider?.model) ??
        choices.find((choice) => choice.providerId === defaultProvider?.id) ??
        choices[0]
      );
    },
    [providers],
  );

  const findChoice = useCallback((providerId: string, model: string, choices = modelChoices) => {
    return choices.find((choice) => choice.providerId === providerId && choice.model === model) ?? null;
  }, [modelChoices]);

  const restoreModelForConversation = useCallback(
    async (conversationId: string | null, rows = providers) => {
      const choices = flattenModelChoices(rows);
      if (!conversationId || !choices.length) {
        setSelectedModelState(defaultModelChoice(rows));
        return;
      }
      const saved = await window.electronAPI.settings.get(modelSettingKey(conversationId)).catch(() => null);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { providerId?: string; model?: string };
          const restored = parsed.providerId && parsed.model ? findChoice(parsed.providerId, parsed.model, choices) : null;
          if (restored) {
            setSelectedModelState(restored);
            return;
          }
        } catch {
          // Ignore invalid old setting and fall back below.
        }
      }
      setSelectedModelState(defaultModelChoice(rows));
    },
    [defaultModelChoice, findChoice, providers],
  );

  const selectModelForActiveConversation = useCallback(
    (choice: ModelChoice | null) => {
      setSelectedModelState(choice);
      if (activeConversationId && choice) {
        void window.electronAPI.settings.set(
          modelSettingKey(activeConversationId),
          JSON.stringify({ providerId: choice.providerId, model: choice.model }),
        );
      }
    },
    [activeConversationId],
  );

  const refreshConversations = useCallback(async () => {
    const rows = await window.electronAPI.conversations.list();
    setConversations(rows);
    setActiveConversationId((current) => current ?? rows[0]?.id ?? null);
    return rows;
  }, []);

  const loadMessages = useCallback(async (conversationId: string | null) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await window.electronAPI.messages.list(conversationId));
  }, []);

  const refreshProviders = useCallback(async () => {
    const rows = await window.electronAPI.providers.list();
    setProviders(rows);
    setSelectedModelState((current) => {
      const choices = flattenModelChoices(rows);
      if (!choices.length) {
        return null;
      }
      if (current && choices.some((choice) => choice.providerId === current.providerId && choice.model === current.model)) {
        return current;
      }
      const defaultProvider = rows.find((provider) => provider.isDefault) ?? rows[0];
      return (
        choices.find((choice) => choice.providerId === defaultProvider?.id && choice.model === defaultProvider?.model) ??
        choices.find((choice) => choice.providerId === defaultProvider?.id) ??
        choices[0]
      );
    });
    return rows;
  }, []);

  useEffect(() => {
    Promise.all([
      refreshConversations(),
      refreshProviders(),
      window.electronAPI.chat.getCompressThreshold().then(setCompressThreshold).catch(() => undefined),
      window.electronAPI.settings.get("compressionNoticeEnabled").then((value) => setCompressionNoticeEnabled(value !== "false")),
    ]).finally(() => setLoading(false));
  }, [refreshConversations, refreshProviders]);

  useEffect(() => {
    void loadMessages(activeConversationId);
    void restoreModelForConversation(activeConversationId);
    setCompressionMessage(null);
    setIgnoredCompressionConversationId(null);
    setIgnoredCompressionSignature("");
  }, [activeConversationId, loadMessages, restoreModelForConversation]);

  useEffect(() => {
    const offDelta = window.electronAPI.chat.onDelta((event) => {
      setMessages((current) => {
        if (current.some((message) => message.id === event.messageId)) {
          return current.map((message) => (message.id === event.messageId ? { ...message, content: event.content } : message));
        }
        return [
          ...current,
          {
            id: event.messageId,
            conversationId: event.conversationId,
            role: "assistant",
            content: event.content,
            compressed: false,
            createdAt: new Date().toISOString(),
            status: "sending",
            attachments: [],
          },
        ];
      });
    });
    const offDone = window.electronAPI.chat.onDone((event) => {
      setMessages((current) => upsertMessage(current, event.message));
      setGenerating(false);
      setIgnoredCompressionSignature("");
      void refreshConversations();
    });
    const offError = window.electronAPI.chat.onError((event) => {
      setMessages((current) => upsertMessage(current, event.message));
      setGenerating(false);
      setIgnoredCompressionSignature("");
      void refreshConversations();
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, [refreshConversations]);

  const createConversation = useCallback(async () => {
    const conversation = await window.electronAPI.conversations.create("新会话");
    await refreshConversations();
    setActiveConversationId(conversation.id);
    await restoreModelForConversation(conversation.id);
  }, [refreshConversations, restoreModelForConversation]);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      await window.electronAPI.conversations.rename(id, title);
      await refreshConversations();
    },
    [refreshConversations],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await window.electronAPI.conversations.delete(id);
      const rows = await refreshConversations();
      if (id === activeConversationId) {
        setActiveConversationId(rows[0]?.id ?? null);
      }
    },
    [activeConversationId, refreshConversations],
  );

  const updateSummary = useCallback(
    async (id: string, summary: string) => {
      await window.electronAPI.conversations.updateSummary(id, summary);
      await refreshConversations();
    },
    [refreshConversations],
  );

  const updateSystemPrompt = useCallback(
    async (id: string, prompt: string) => {
      await window.electronAPI.conversations.updateSystemPrompt(id, prompt);
      await refreshConversations();
    },
    [refreshConversations],
  );

  const continueFromSummary = useCallback(
    async (source: Conversation) => {
      const summary = source.summary.trim();
      if (!summary) {
        return;
      }
      const conversation = await window.electronAPI.conversations.create(`续 - ${source.title}`);
      await window.electronAPI.messages.create(conversation.id, "user", summary);
      await refreshConversations();
      setActiveConversationId(conversation.id);
      await loadMessages(conversation.id);
      await restoreModelForConversation(conversation.id);
    },
    [loadMessages, refreshConversations, restoreModelForConversation],
  );

  const sendMessage = useCallback(
    async (content: string, attachments: string[] = []) => {
      const text = content.trim();
      const cleanedAttachments = attachments.map((item) => item.trim()).filter(Boolean);
      if ((!text && !cleanedAttachments.length) || generating) {
        return;
      }

      let conversationId = activeConversationId;
      if (!conversationId) {
        const conversation = await window.electronAPI.conversations.create(text.slice(0, 30) || "新会话");
        conversationId = conversation.id;
        setActiveConversationId(conversation.id);
        if (selectedModel) {
          await window.electronAPI.settings.set(
            modelSettingKey(conversation.id),
            JSON.stringify({ providerId: selectedModel.providerId, model: selectedModel.model }),
          );
        }
      }

      setGenerating(true);
      try {
        const result = await window.electronAPI.chat.sendMessage(
          conversationId,
          text,
          cleanedAttachments,
          selectedModel?.providerId,
          selectedModel?.model,
        );
        const assistantMessages = result.assistantMessages?.length ? result.assistantMessages : [result.assistantMessage];
        setMessages((current) => [...current, result.userMessage, ...assistantMessages]);
        await refreshConversations();
      } catch (error) {
        setGenerating(false);
        window.alert(friendlyError(error));
      }
    },
    [activeConversationId, generating, refreshConversations, selectedModel],
  );

  const regenerateMessage = useCallback(
    async (assistantMessageId: string, mode: "retry" | "concise" | "detailed") => {
      if (!activeConversationId || generating) {
        return;
      }
      setGenerating(true);
      try {
        const result = await window.electronAPI.chat.regenerate(
          activeConversationId,
          assistantMessageId,
          mode,
          selectedModel?.providerId,
          selectedModel?.model,
        );
        setMessages((current) => [...current, result.assistantMessage]);
        await refreshConversations();
      } catch (error) {
        setGenerating(false);
        window.alert(friendlyError(error));
      }
    },
    [activeConversationId, generating, refreshConversations, selectedModel],
  );

  const stopGeneration = useCallback(async () => {
    await window.electronAPI.chat.stopGeneration();
  }, []);

  const compressContext = useCallback(async () => {
    if (!activeConversationId || compressing) {
      return;
    }
    setCompressing(true);
    setCompressionMessage(null);
    try {
      const result = await window.electronAPI.chat.compress(
        activeConversationId,
        selectedModel?.providerId,
        selectedModel?.model,
      );
      await Promise.all([refreshConversations(), loadMessages(activeConversationId)]);
      setCompressionMessage({
        type: "success",
        text: `已压缩 ${result.compressedCount} 条消息，摘要已更新。`,
      });
      setIgnoredCompressionConversationId(null);
      setIgnoredCompressionSignature("");
    } catch (error) {
      setCompressionMessage({
        type: "error",
        text: `${selectedModel ? `压缩模型：${selectedModel.label}\n` : ""}${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setCompressing(false);
    }
  }, [activeConversationId, compressing, loadMessages, refreshConversations, selectedModel]);

  const contextStats = useMemo(() => {
    const uncompressed = messages.filter((message) => !message.compressed);
    return {
      count: uncompressed.length,
      chars: uncompressed.reduce((sum, message) => sum + message.content.length, 0),
    };
  }, [messages]);

  const compressionSignature = `${contextStats.count}:${contextStats.chars}`;
  const shouldShowCompressionNotice =
    Boolean(activeConversationId) &&
    compressionNoticeEnabled &&
    contextStats.chars > compressThreshold &&
    !(ignoredCompressionConversationId === activeConversationId && ignoredCompressionSignature === compressionSignature);

  return {
    conversations,
    providers,
    modelChoices,
    selectedModel,
    activeConversation,
    activeConversationId,
    messages,
    loading,
    generating,
    compressing,
    compressionMessage,
    compressThreshold,
    shouldShowCompressionNotice,
    contextStats,
    setActiveConversationId,
    setSelectedModel: selectModelForActiveConversation,
    refreshConversations,
    refreshProviders,
    createConversation,
    renameConversation,
    deleteConversation,
    updateSummary,
    updateSystemPrompt,
    continueFromSummary,
    sendMessage,
    regenerateMessage,
    compressContext,
    ignoreCompressionNotice: () => {
      setIgnoredCompressionConversationId(activeConversationId);
      setIgnoredCompressionSignature(compressionSignature);
    },
    clearCompressionMessage: () => setCompressionMessage(null),
    stopGeneration,
  };
}

function modelSettingKey(conversationId: string) {
  return `conversationModel:${conversationId}`;
}

function upsertMessage(current: Message[], next: Message) {
  if (current.some((message) => message.id === next.id)) {
    return current.map((message) => (message.id === next.id ? next : message));
  }
  return [...current, next];
}

function flattenModelChoices(providers: Provider[]): ModelChoice[] {
  return providers.flatMap((provider) => {
    const models = Array.from(new Set([...(provider.enabledModels ?? []), provider.model].map((item) => item.trim()).filter(Boolean)));
    return models.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      model,
      label: `${provider.name} / ${model}`,
    }));
  });
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SQLITE") || message.toLowerCase().includes("database")) {
    return `数据库操作失败：${message}`;
  }
  return message;
}
