import { DEFAULT_COMPRESS_KEEP } from "../../shared/constants";
import { COMPRESSION_PROMPT } from "../../shared/compression-prompt";
import type { Message } from "../../shared/types";
import { getConversation, updateConversationSummaryAndCompressMessages } from "../database/conversations";
import { listMessages } from "../database/messages";
import { getDefaultProvider, getProvider } from "../database/providers";
import { getSetting } from "../database/settings";
import { OpenAICompatibleClient } from "./ai-client";

export interface CompressionResult {
  ok: true;
  summary: string;
  compressedCount: number;
}

export async function compressConversation(conversationId: string, providerId?: string, model?: string): Promise<CompressionResult> {
  const conversation = getConversation(conversationId);
  const keep = readPositiveIntSetting("COMPRESS_KEEP", DEFAULT_COMPRESS_KEEP);
  const uncompressed = listMessages(conversationId).filter(
    (message) => !message.compressed && message.status !== "sending" && message.role !== "system",
  );
  const compressible = uncompressed.slice(0, Math.max(0, uncompressed.length - keep));

  if (compressible.length < 2) {
    throw new Error("当前消息不多，不需要压缩");
  }

  const provider = providerId ? getProvider(providerId) : getDefaultProvider();
  const selectedProvider = model ? { ...provider, model } : provider;
  const client = new OpenAICompatibleClient(selectedProvider);
  const prompt = buildCompressionUserPrompt(conversation.summary, compressible);
  const summary = (
    await client.chat(
      [
        { role: "system", content: COMPRESSION_PROMPT },
        { role: "user", content: prompt },
      ],
      {
        signal: AbortSignal.timeout(120000),
        onDelta: () => undefined,
        stream: false,
        maxTokens: selectedProvider.maxTokens ?? 4096,
      },
    )
  ).trim();

  if (!summary) {
    throw new Error("AI 没有返回摘要，压缩失败。");
  }

  updateConversationSummaryAndCompressMessages(
    conversationId,
    summary,
    compressible.map((message) => message.id),
  );

  return { ok: true, summary, compressedCount: compressible.length };
}

export function getCompressThreshold() {
  return readPositiveIntSetting("COMPRESS_THRESHOLD", 12000);
}

function readPositiveIntSetting(key: string, fallback: number) {
  const value = Number.parseInt(getSetting(key) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildCompressionUserPrompt(summary: string, messages: Message[]) {
  return `已有会话摘要：
${summary.trim() || "无"}

新增对话内容：
${formatMessages(messages)}`;
}

function formatMessages(messages: Message[]) {
  return messages
    .map((message, index) => {
      const role = message.role === "user" ? "用户" : message.role === "assistant" ? "AI" : "系统";
      return `--- 消息 ${index + 1} / ${role} / ${message.createdAt} ---
${message.content.trim()}`;
    })
    .join("\n\n");
}
