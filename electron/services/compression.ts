import { getDb } from "../database";
import { DEFAULT_COMPRESS_KEEP, DEFAULT_RECENT_MESSAGES } from "../../shared/constants";
import { COMPRESSION_PROMPT } from "../../shared/compression-prompt";
import type { Message } from "../../shared/types";
import { getConversation, updateConversationSummary } from "../database/conversations";
import { listMessages, markMessagesCompressed } from "../database/messages";
import { createMemoryLayer, getNextLevel, listMemoryLayers } from "../database/memory-layers";
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
  const keep = Math.max(readPositiveIntSetting("COMPRESS_KEEP", DEFAULT_COMPRESS_KEEP), readPositiveIntSetting("recentMessages", DEFAULT_RECENT_MESSAGES));
  const allMessages = listMessages(conversationId);
  if (allMessages.some((message) => message.status === "sending")) {
    throw new Error("对话仍在生成，请完成或停止生成后再压缩，原文未修改。");
  }
  const uncompressed = allMessages.filter(
    (message) => !message.compressed && message.status !== "sending" && message.role !== "system",
  );
  // 待压缩 = 去掉最近 keep 条之后的那一批「最久远」的消息。
  let boundary = Math.max(0, uncompressed.length - keep);
  // Preserve a complete recent user turn rather than starting with an orphan answer.
  while (boundary > 0 && uncompressed[boundary]?.role !== "user") boundary -= 1;
  const compressible = uncompressed.slice(0, boundary);

  if (compressible.length < 2) {
    throw new Error("当前消息不多，不需要压缩");
  }

  const provider = providerId ? getProvider(providerId) : getDefaultProvider();
  const selectedProvider = model ? { ...provider, model } : provider;
  const client = new OpenAICompatibleClient(selectedProvider);

  // 已有分层记忆，作为本次摘要的「前置记忆」传给模型，保证信息可回溯、不丢失。
  const existingLayers = listMemoryLayers(conversationId);
  const legacySummary = existingLayers.length === 0 ? conversation.summary?.trim() : "";
  const previousMemory = legacySummary ? [{ level: 0, summary: legacySummary }] : existingLayers;
  const prompt = buildLayerSummaryPrompt(previousMemory, compressible);
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

  const sourceLength = compressible.reduce((total, message) => total + message.content.trim().length, 0);
  const minimumLength = Math.min(1500, Math.max(300, Math.ceil(sourceLength * 0.08)));
  if (sourceLength >= 2000 && summary.length < minimumLength) {
    throw new Error(`摘要过短（${summary.length} 字符，至少需要 ${minimumLength}），可能丢失关键信息。本次压缩未应用，原文保持不变。请提高摘要输出预算或更换压缩模型。`);
  }

  const latestSummary = buildLatestSummary(previousMemory, summary);
  // Memory, legacy migration and compressed flags must succeed or roll back together.
  getDb().transaction(() => {
    let level = getNextLevel(conversationId);
    if (legacySummary) createMemoryLayer(conversationId, level++, legacySummary, "", "");
    createMemoryLayer(conversationId, level, summary, compressible[0]?.id ?? "", compressible[compressible.length - 1]?.id ?? "");
    updateConversationSummary(conversationId, latestSummary);
    markMessagesCompressed(compressible.map((message) => message.id));
  })();

  return { ok: true, summary: latestSummary, compressedCount: compressible.length };
}

export function getCompressThreshold() {
  return readPositiveIntSetting("COMPRESS_THRESHOLD", 12000);
}

function readPositiveIntSetting(key: string, fallback: number) {
  const value = Number.parseInt(getSetting(key) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildLayerSummaryPrompt(existingLayers: Array<{ level: number; summary: string }>, messages: Message[]) {
  const existingText = existingLayers.length
    ? existingLayers
        .map((layer) => `--- 记忆层 ${layer.level}（更早的历史）---\n${layer.summary}`)
        .join("\n\n")
    : "无（这是第一次压缩）";
  return `已有更早的历史记忆（分层）：
${existingText}

本次需要概括的一段对话内容（这段之后还有最近的对话，会单独保留原文）：
${formatMessages(messages)}

请只概括「本次这段对话」，生成一段用于补充到分层记忆里的摘要。要求：不重复已有记忆层里已经记录的信息，只提炼这一段新增的关键内容。`;
}

function buildLatestSummary(existingLayers: Array<{ summary: string }>, newSummary: string) {
  const tail = existingLayers.length ? `\n\n（更早历史已分层记忆）` : "";
  return `${newSummary}${tail}`;
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
