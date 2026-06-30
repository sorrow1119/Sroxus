import { ipcMain, type WebContents } from "electron";
import { DEFAULT_RECENT_MESSAGES } from "../../shared/constants";
import type { AIAgent, Message, RegenerateMode } from "../../shared/types";
import { listEnabledAgents } from "../database/agents";
import { getConversation } from "../database/conversations";
import { createMessage, listMessages, updateMessageContent, updateMessageStatus } from "../database/messages";
import { getDefaultProvider, getProvider } from "../database/providers";
import { getSetting } from "../database/settings";
import { prepareAttachments } from "../services/attachments";
import { OpenAICompatibleClient } from "../services/ai-client";
import { handleCoordinating } from "../services/collaboration";
import { compressConversation, getCompressThreshold } from "../services/compression";
import { buildRequestMessages } from "../services/context-builder";
import { detectCollaborationMode, type ManualAgentTask } from "../services/agent-router";
import { runAgent, runMultipleAgents } from "../services/agent-runner";

let activeController: AbortController | null = null;

export function registerChatIpc() {
  ipcMain.handle(
    "chat:send-message",
    async (event, conversationId: string, content: string, attachmentPaths?: string[], providerId?: string, model?: string) => {
      if (activeController) {
        throw new Error("当前已有 AI 正在生成，请先停止或等待完成。");
      }

      const attachments = await prepareAttachments(Array.isArray(attachmentPaths) ? attachmentPaths : []);
      const text = content.trim();
      if (!text && !attachments.length) {
        throw new Error("消息内容和附件不能同时为空。");
      }

      const userContent = text || "请结合我上传的附件继续处理。";
      const route = detectCollaborationMode(userContent, listEnabledAgents());
      const userMessage = createMessage(conversationId, "user", userContent, "success", { attachments });
      const controller = createTimeoutController();
      activeController = controller;

      if (route.mode === "manual") {
        const assistantMessages = route.tasks.map((task) =>
          createMessage(conversationId, "assistant", "", "sending", {
            agentId: task.agent.id,
            agentName: task.agent.name,
            parentMessageId: userMessage.id,
            messageType: "agent",
          }),
        );

        void runManualAgentGeneration(event.sender, conversationId, assistantMessages, controller, route.tasks, userMessage.id).finally(() => {
          if (activeController === controller) {
            activeController = null;
          }
        });

        return { userMessage, assistantMessage: assistantMessages[0], assistantMessages };
      }

      if (route.mode === "coordinator") {
        const assistantMessage = createMessage(conversationId, "assistant", "正在分析任务...", "sending", {
          agentId: route.primaryAgent.id,
          agentName: `${route.primaryAgent.name} / 协调`,
          parentMessageId: userMessage.id,
          messageType: "agent",
        });

        void runCoordinatorGeneration(
          event.sender,
          conversationId,
          assistantMessage.id,
          controller,
          route.task,
          listEnabledAgents(),
          userMessage.id,
        ).finally(() => {
          if (activeController === controller) {
            activeController = null;
          }
        });

        return { userMessage, assistantMessage, assistantMessages: [assistantMessage] };
      }

      const assistantMessage =
        route.mode === "mention"
          ? createMessage(conversationId, "assistant", "", "sending", {
              agentId: route.targetAgent.id,
              agentName: route.targetAgent.name,
              parentMessageId: userMessage.id,
              messageType: "agent",
            })
          : createMessage(conversationId, "assistant", "", "sending");

      const generation =
        route.mode === "mention"
          ? runAgentGeneration(event.sender, conversationId, assistantMessage.id, controller, route.targetAgent, route.task, userMessage.id)
          : runGeneration(event.sender, conversationId, assistantMessage.id, controller, providerId, model);

      void generation.finally(() => {
        if (activeController === controller) {
          activeController = null;
        }
      });

      return { userMessage, assistantMessage, assistantMessages: [assistantMessage] };
    },
  );

  ipcMain.handle(
    "chat:regenerate",
    async (
      event,
      conversationId: string,
      assistantMessageId: string,
      mode: RegenerateMode,
      providerId?: string,
      model?: string,
    ) => {
      if (activeController) {
        throw new Error("当前已有 AI 正在生成，请先停止或等待完成。");
      }

      const messages = listMessages(conversationId);
      const targetIndex = messages.findIndex((message) => message.id === assistantMessageId);
      if (targetIndex < 0) {
        throw new Error("找不到要重新回答的消息。");
      }
      const previousUser = [...messages.slice(0, targetIndex)].reverse().find((message) => message.role === "user");
      if (!previousUser) {
        throw new Error("找不到这条回复对应的用户问题。");
      }

      const assistantMessage = createMessage(conversationId, "assistant", "", "sending");
      const controller = createTimeoutController();
      activeController = controller;

      void runGeneration(event.sender, conversationId, assistantMessage.id, controller, providerId, model, {
        upToMessageId: previousUser.id,
        instruction: regenerateInstruction(mode),
      }).finally(() => {
        if (activeController === controller) {
          activeController = null;
        }
      });

      return { assistantMessage };
    },
  );

  ipcMain.handle("chat:stop-generation", () => {
    activeController?.abort();
    return { ok: true as const };
  });

  ipcMain.handle("chat:compress", async (_event, conversationId: string, providerId?: string, model?: string) =>
    compressConversation(conversationId, providerId, model),
  );
  ipcMain.handle("chat:get-compress-threshold", () => getCompressThreshold());
}

async function runGeneration(
  sender: WebContents,
  conversationId: string,
  assistantMessageId: string,
  controller: AbortController,
  providerId?: string,
  model?: string,
  options?: { upToMessageId?: string; instruction?: string },
) {
  let full = "";
  try {
    const conversation = getConversation(conversationId);
    const keepRecent = Number.parseInt(getSetting("recentMessages") ?? "", 10) || DEFAULT_RECENT_MESSAGES;
    const contextMessages = buildRequestMessages(
      conversation,
      buildMessagesForGeneration(listMessages(conversationId), assistantMessageId, options?.upToMessageId, options?.instruction),
      keepRecent,
    );
    const provider = providerId ? getProvider(providerId) : getDefaultProvider();
    const client = new OpenAICompatibleClient(model ? { ...provider, model } : provider);

    await client.chat(contextMessages, {
      signal: controller.signal,
      onDelta: (delta) => {
        full += delta;
        updateMessageContent(assistantMessageId, full);
        sender.send("chat:delta", { conversationId, messageId: assistantMessageId, delta, content: full });
      },
    });

    const message = updateMessageStatus(assistantMessageId, "success", full);
    sender.send("chat:done", { conversationId, message });
  } catch (error) {
    handleGenerationError(sender, conversationId, assistantMessageId, controller, full, error);
  }
}

async function runAgentGeneration(
  sender: WebContents,
  conversationId: string,
  assistantMessageId: string,
  controller: AbortController,
  agent: AIAgent,
  task: string,
  parentMessageId: string,
) {
  let full = "";
  try {
    await runAgent(agent, task, conversationId, {
      signal: controller.signal,
      parentMessageId,
      onDelta: (delta) => {
        full += delta;
        updateMessageContent(assistantMessageId, full);
        sender.send("chat:delta", { conversationId, messageId: assistantMessageId, delta, content: full });
      },
    });

    const message = updateMessageStatus(assistantMessageId, "success", full);
    sender.send("chat:done", { conversationId, message });
  } catch (error) {
    handleGenerationError(sender, conversationId, assistantMessageId, controller, full, error);
  }
}

async function runCoordinatorGeneration(
  sender: WebContents,
  conversationId: string,
  assistantMessageId: string,
  controller: AbortController,
  task: string,
  agents: AIAgent[],
  parentMessageId: string,
) {
  let full = "";
  let statusText = "";
  const publish = (content: string, delta = content) => {
    full = content;
    updateMessageContent(assistantMessageId, full);
    sender.send("chat:delta", { conversationId, messageId: assistantMessageId, delta, content: full });
  };

  try {
    const finalText = await handleCoordinating(conversationId, task, agents, {
      signal: controller.signal,
      parentMessageId,
      onStatus: (update) => {
        statusText += `${statusText ? "\n" : ""}- ${update.content}`;
        publish(statusText, `\n- ${update.content}`);
      },
      onFinalDelta: (delta) => {
        const prefix = statusText ? `${statusText}\n\n---\n\n` : "";
        const previousFinal = full.startsWith(prefix) ? full.slice(prefix.length) : "";
        publish(`${prefix}${previousFinal}${delta}`, delta);
      },
    });

    const prefix = statusText ? `${statusText}\n\n---\n\n` : "";
    const message = updateMessageStatus(assistantMessageId, "success", `${prefix}${finalText}`);
    sender.send("chat:done", { conversationId, message });
  } catch (error) {
    handleGenerationError(sender, conversationId, assistantMessageId, controller, full, error);
  }
}

async function runManualAgentGeneration(
  sender: WebContents,
  conversationId: string,
  assistantMessages: Message[],
  controller: AbortController,
  tasks: ManualAgentTask[],
  parentMessageId: string,
) {
  const fullByMessageId = new Map<string, string>();
  for (const message of assistantMessages) {
    fullByMessageId.set(message.id, "");
  }

  await runMultipleAgents(tasks, {
    signal: controller.signal,
    conversationId,
    parentMessageId,
    onDelta: (_task, index, delta) => {
      const message = assistantMessages[index];
      if (!message) {
        return;
      }
      const full = `${fullByMessageId.get(message.id) ?? ""}${delta}`;
      fullByMessageId.set(message.id, full);
      updateMessageContent(message.id, full);
      sender.send("chat:delta", { conversationId, messageId: message.id, delta, content: full });
    },
    onResult: (result, index) => {
      const message = assistantMessages[index];
      if (!message) {
        return;
      }
      if (result.error) {
        const current = fullByMessageId.get(message.id) ?? "";
        const content = current ? `${current}\n\n${result.error}` : result.error;
        const updated = updateMessageStatus(message.id, "error", content);
        sender.send("chat:error", { conversationId, message: updated, error: result.error });
        return;
      }
      const updated = updateMessageStatus(message.id, "success", result.content);
      sender.send("chat:done", { conversationId, message: updated });
    },
  });
}

function handleGenerationError(
  sender: WebContents,
  conversationId: string,
  assistantMessageId: string,
  controller: AbortController,
  full: string,
  error: unknown,
) {
  const stopped = controller.signal.aborted;
  const timedOut = (controller as AbortController & { timedOut?: boolean }).timedOut;
  const errorText = timedOut
    ? "请求超时，请稍后重试。"
    : stopped
      ? "已停止生成"
      : error instanceof Error
        ? error.message
        : String(error);
  const nextContent = full ? `${full}\n\n${errorText}` : errorText;
  const message = updateMessageStatus(assistantMessageId, "error", nextContent);
  sender.send("chat:error", { conversationId, message, error: errorText });
}

function buildMessagesForGeneration(
  messages: Message[],
  assistantMessageId: string,
  upToMessageId?: string,
  instruction?: string,
): Message[] {
  let scoped = messages.filter((message) => message.id !== assistantMessageId);
  if (upToMessageId) {
    const index = scoped.findIndex((message) => message.id === upToMessageId);
    if (index >= 0) {
      scoped = scoped.slice(0, index + 1);
    }
  }
  if (!instruction) {
    return scoped;
  }
  return [
    ...scoped,
    {
      id: `regen-${Date.now()}`,
      conversationId: scoped[0]?.conversationId ?? "",
      role: "system",
      content: instruction,
      compressed: false,
      createdAt: new Date().toISOString(),
      status: "success",
    },
  ];
}

function regenerateInstruction(mode: RegenerateMode) {
  if (mode === "concise") {
    return "请重新回答上一条用户问题。要求：更简洁、更直接，只保留关键结论和必要步骤。";
  }
  if (mode === "detailed") {
    return "请重新回答上一条用户问题。要求：比之前更展开，补充推理过程、步骤、注意事项和可执行建议。";
  }
  return "请重新回答上一条用户问题。保持准确，不要提到这是重试。";
}

function createTimeoutController() {
  const controller = new AbortController() as AbortController & { timedOut?: boolean };
  const timer = setTimeout(() => {
    controller.timedOut = true;
    controller.abort();
  }, 300000);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller;
}
