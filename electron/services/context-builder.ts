import type { Conversation, Message } from "../../shared/types";
import { formatAttachmentsForPrompt, imageAttachmentToDataUrl } from "./attachments";

type ContextMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export async function buildRequestMessages(conversation: Conversation, messages: Message[], keepRecent: number): Promise<ContextMessage[]> {
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
  context.push(...(await Promise.all(recent.map(async (message) => ({ role: message.role, content: await enrichMessageContent(message) })))));
  return context;
}

async function enrichMessageContent(message: Message): Promise<ContextMessage["content"]> {
  const attachments = message.attachments ?? [];
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const documentAttachments = attachments.filter((attachment) => attachment.kind !== "image");
  const attachmentText = formatAttachmentsForPrompt(documentAttachments);
  const text = `${message.content}${attachmentText ? `${message.content ? "\n\n" : ""}[附件信息]\n${attachmentText}` : ""}`;
  if (!imageAttachments.length) {
    return text;
  }
  const parts: ContextMessage["content"] = [];
  if (text.trim()) {
    parts.push({ type: "text", text });
  }
  for (const attachment of imageAttachments) {
    const dataUrl = await imageAttachmentToDataUrl(attachment);
    if (dataUrl) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }
  return parts.length ? parts : text;
}


