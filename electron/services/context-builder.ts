import type { Conversation, Message } from "../../shared/types";
import { formatAttachmentsForPrompt } from "./attachments";

type ContextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function buildRequestMessages(conversation: Conversation, messages: Message[], keepRecent: number): ContextMessage[] {
  const systemMessages = messages.filter((message) => !message.compressed && message.role === "system");
  const recent = messages.filter((message) => !message.compressed && message.role !== "system").slice(-keepRecent);
  const context: ContextMessage[] = [];
  if (conversation.systemPrompt) {
    context.push({ role: "system", content: conversation.systemPrompt });
  }
  if (conversation.summary) {
    context.push({ role: "system", content: `以下是之前对话的摘要：\n${conversation.summary}` });
  }
  context.push(...systemMessages.map((message) => ({ role: "system" as const, content: message.content })));
  context.push(...recent.map((message) => ({ role: message.role, content: enrichMessageContent(message) })));
  return context;
}

function enrichMessageContent(message: Message) {
  const attachmentText = formatAttachmentsForPrompt(message.attachments ?? []);
  if (!attachmentText) {
    return message.content;
  }
  return `${message.content}${message.content ? "\n\n" : ""}[附件信息]\n${attachmentText}`;
}
