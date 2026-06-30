import { DEFAULT_RECENT_MESSAGES } from "../../shared/constants";
import type { AIAgent, AgentResult, Message } from "../../shared/types";
import { getConversation } from "../database/conversations";
import { listMessages } from "../database/messages";
import { getDefaultProvider, getProvider } from "../database/providers";
import { getSetting } from "../database/settings";
import { OpenAICompatibleClient, type ChatMessage } from "./ai-client";
import { buildRequestMessages } from "./context-builder";
import type { ManualAgentTask } from "./agent-router";

type RunAgentOptions = {
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  parentMessageId?: string;
};

type RunMultipleAgentsOptions = {
  signal: AbortSignal;
  conversationId: string;
  parentMessageId?: string;
  onDelta?: (task: ManualAgentTask, index: number, delta: string) => void;
  onResult?: (result: AgentResult, index: number) => void;
};

export async function runAgent(
  agent: AIAgent,
  userMessage: string,
  conversationId: string,
  options: RunAgentOptions,
): Promise<string> {
  const provider = agent.providerId ? getProvider(agent.providerId) : getDefaultProvider();
  const client = new OpenAICompatibleClient(agent.model ? { ...provider, model: agent.model } : provider);
  const conversation = getConversation(conversationId);
  const keepRecent = Number.parseInt(getSetting("recentMessages") ?? "", 10) || DEFAULT_RECENT_MESSAGES;
  const contextMessages = buildAgentContext(
    agent,
    buildMessagesForAgent(listMessages(conversationId), options.parentMessageId),
    conversation,
    keepRecent,
    userMessage,
  );

  return client.chat(contextMessages, {
    signal: options.signal,
    onDelta: options.onDelta,
  });
}

export async function runMultipleAgents(tasks: ManualAgentTask[], options: RunMultipleAgentsOptions): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (const [index, task] of tasks.entries()) {
    try {
      const content = await runAgent(task.agent, task.task, options.conversationId, {
        signal: options.signal,
        parentMessageId: options.parentMessageId,
        onDelta: (delta) => options.onDelta?.(task, index, delta),
      });
      const result: AgentResult = {
        agentId: task.agent.id,
        agentName: task.agent.name,
        content,
        parentMessageId: options.parentMessageId,
      };
      results.push(result);
      options.onResult?.(result, index);
    } catch (error) {
      const result: AgentResult = {
        agentId: task.agent.id,
        agentName: task.agent.name,
        content: "",
        error: error instanceof Error ? error.message : String(error),
        parentMessageId: options.parentMessageId,
      };
      results.push(result);
      options.onResult?.(result, index);
      if (options.signal.aborted) {
        break;
      }
    }
  }
  return results;
}

function buildAgentContext(
  agent: AIAgent,
  messages: Message[],
  conversation: ReturnType<typeof getConversation>,
  keepRecent: number,
  userMessage: string,
): ChatMessage[] {
  const context: ChatMessage[] = [];
  if (agent.systemPrompt) {
    context.push({ role: "system", content: agent.systemPrompt });
  }
  context.push(...buildRequestMessages(conversation, messages, keepRecent));
  context.push({ role: "user", content: userMessage });
  return dedupeAdjacentSystemMessages(context);
}

function buildMessagesForAgent(messages: Message[], parentMessageId?: string): Message[] {
  return messages.filter((message) => {
    if (message.status === "sending") {
      return false;
    }
    if (parentMessageId && message.id === parentMessageId) {
      return false;
    }
    return true;
  });
}

function dedupeAdjacentSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message, index) => {
    if (message.role !== "system") {
      return true;
    }
    const previous = messages[index - 1];
    return !previous || previous.role !== "system" || previous.content !== message.content;
  });
}