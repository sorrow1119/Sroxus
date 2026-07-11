import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { EndpointPathMode, ProviderInput } from "../../shared/types";
import { sanitizeForLog, sanitizeMessagesForAI } from "./privacy-filter";
import { getStoragePath } from "./storage-path";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

type ChatOptions = {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  maxTokens?: number;
  stream?: boolean;
};

type ProbeResult =
  | { ok: true; endpoint: string; fullText: string }
  | { ok: false; endpoint: string; retryable: boolean; message: string };

export class OpenAICompatibleClient {
  constructor(private readonly config: ProviderInput) {}

  async testConnection() {
    if (!this.baseUrls().length || !this.config.model) {
      return { ok: false, message: "请先填写 Base URL 和模型名称。" };
    }
    try {
      const text = await this.chat([{ role: "user", content: "你好，请回复 ok" }], {
        signal: AbortSignal.timeout(30000),
        onDelta: () => undefined,
        maxTokens: 32,
        stream: false,
      });
      return { ok: true, message: text || "模型测试成功。" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels() {
    const roots = this.baseUrls();
    let lastError = "Provider 不支持获取模型。";
    for (const baseUrl of roots) {
      for (const endpoint of this.modelCandidates(baseUrl)) {
        try {
          const response = await fetch(endpoint, {
            method: "GET",
            headers: this.headers(),
            signal: AbortSignal.timeout(20000),
          });
          const text = await response.text();
          if (!response.ok) {
            if (shouldRetry(response.status, text, response.headers.get("content-type"))) {
              lastError = explainHttpError(response.status, text);
              continue;
            }
            return { ok: false, models: [], message: explainHttpError(response.status, text) };
          }
          const models = parseModelsList(text);
          if (models.length) {
            return { ok: true, models, message: `已从 ${endpoint} 获取模型。` };
          }
          lastError = `接口可达，但未解析到模型列表：${endpoint}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    return { ok: false, models: [], message: lastError };
  }

  async benchmarkBaseUrls() {
    const results = await Promise.all(
      this.baseUrls().map(async (baseUrl) => {
        const started = performance.now();
        for (const endpoint of this.modelCandidates(baseUrl)) {
          try {
            const response = await fetch(endpoint, {
              method: "GET",
              headers: this.headers(),
              signal: AbortSignal.timeout(15000),
            });
            const text = await response.text();
            const latencyMs = Math.round(performance.now() - started);
            if (response.ok) {
              const models = parseModelsList(text);
              if (models.length || looksLikeModelsPayload(text)) {
                return { url: baseUrl, ok: true, latencyMs, message: `可用: ${endpoint}` };
              }
            }
            if (!shouldRetry(response.status, text, response.headers.get("content-type"))) {
              return { url: baseUrl, ok: false, latencyMs, message: explainHttpError(response.status, text) };
            }
          } catch (error) {
            return { url: baseUrl, ok: false, latencyMs: null, message: error instanceof Error ? error.message : String(error) };
          }
        }
        return { url: baseUrl, ok: false, latencyMs: null, message: "未找到可用 endpoint" };
      }),
    );
    const best = results.filter((item) => item.ok && item.latencyMs !== null).sort((a, b) => Number(a.latencyMs) - Number(b.latencyMs))[0];
    return { ok: Boolean(best), bestUrl: best?.url ?? null, results };
  }

  async chat(messages: ChatMessage[], options: ChatOptions) {
    const privacy = sanitizeMessagesForAI(messages);
    const outboundMessages = privacy.messages;
    const stream = options.stream ?? this.config.stream ?? true;
    logAiEvent("chat:start", {
      provider: this.config.name,
      model: this.config.model,
      messageCount: outboundMessages.length,
      inputChars: outboundMessages.reduce((sum, message) => sum + chatContentTextLength(message.content), 0),
      privacyFilterEnabled: privacy.report.enabled,
      privacyFilterChanged: privacy.report.changed,
      privacyFilterHits: privacy.report.totalHits,
      stream,
      maxTokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
    });

    let lastError = "AI 接口地址或 endpoint 不正确。";
    for (const baseUrl of this.baseUrls()) {
      for (const endpoint of this.chatCandidates(baseUrl)) {
        const result = await this.tryChatEndpoint(endpoint, outboundMessages, options);
        if (result.ok) {
          logAiEvent("chat:success", { endpoint, model: this.config.model, outputChars: result.fullText.length });
          return result.fullText;
        }
        lastError = result.message;
        if (!result.retryable) {
          logAiEvent("chat:failed", { endpoint, model: this.config.model, message: result.message });
          throw new Error(result.message);
        }
      }
    }
    logAiEvent("chat:failed", { model: this.config.model, message: lastError });
    throw new Error(lastError);
  }

  private async tryChatEndpoint(endpoint: string, messages: ChatMessage[], options: ChatOptions): Promise<ProbeResult> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: this.config.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
          stream: options.stream ?? this.config.stream ?? true,
        }),
        signal: options.signal,
      });
    } catch (error) {
      const message = explainFetchError(error);
      return {
        ok: false,
        endpoint,
        retryable: !message.includes("请求超时"),
        message,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const logPath = saveAiRawResponse("http-error", endpoint, rawText);
      return {
        ok: false,
        endpoint,
        retryable: shouldRetry(response.status, rawText, contentType),
        message: `${explainHttpError(response.status, rawText)}\n日志: ${logPath}`,
      };
    }

    if ((options.stream ?? this.config.stream ?? true) && response.body) {
      const streamResult = await readSseStream(response, options.onDelta, endpoint);
      if (streamResult.ok) {
        return { ok: true, endpoint, fullText: streamResult.fullText };
      }
      return { ok: false, endpoint, retryable: true, message: streamResult.message };
    }

    const rawText = await response.text().catch(() => "");
    if (contentType.includes("text/event-stream") || rawText.includes("data:")) {
      const streamResult = parseSsePayload(rawText, options.onDelta);
      if (streamResult.ok) {
        return { ok: true, endpoint, fullText: streamResult.fullText };
      }
      return {
        ok: false,
        endpoint,
        retryable: true,
        message: `${streamResult.message}\n日志: ${saveAiRawResponse("stream-parse-failed", endpoint, rawText)}`,
      };
    }

    const parsed = parseCompletionText(rawText);
    if (parsed) {
      options.onDelta(parsed);
      return { ok: true, endpoint, fullText: parsed };
    }

    const logPath = saveAiRawResponse("parse-failed", endpoint, rawText);
    return {
      ok: false,
      endpoint,
      retryable: true,
      message: looksLikeHtml(rawText)
        ? `AI 接口返回了网页 HTML，可能是 endpoint 不对。\n日志: ${logPath}`
        : `AI 响应格式不符合预期，请尝试其它 endpoint。\n日志: ${logPath}`,
    };
  }

  private baseUrls() {
    return splitValues(this.config.baseUrl);
  }

  private chatCandidates(baseUrl: string) {
    return buildCandidates(baseUrl, this.config, "chat");
  }

  private modelCandidates(baseUrl: string) {
    return buildCandidates(baseUrl, this.config, "models");
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }
}

function buildCandidates(baseUrl: string, config: ProviderInput, kind: "chat" | "models") {
  const base = normalizeBase(baseUrl);
  const mode = config.endpointPathMode ?? (config.autoAppendPath ? "append_v1_chat_completions" : "exact");
  const isResponses = config.endpointType === "responses";
  const paths = kind === "chat" ? preferredChatPaths(mode, isResponses) : preferredModelPaths(mode, isResponses);
  return unique([base, ...paths.map((item) => joinPath(rootBase(base), item))]);
}

function preferredChatPaths(mode: EndpointPathMode, isResponses: boolean) {
  if (isResponses) {
    if (mode === "append_chat_completions") {
      return ["/responses", "/v1/responses", "", "/chat/completions", "/v1/chat/completions"];
    }
    if (mode === "append_v1_chat_completions") {
      return ["/v1/responses", "/responses", "", "/v1/chat/completions", "/chat/completions"];
    }
    return ["", "/responses", "/v1/responses", "/chat/completions", "/v1/chat/completions"];
  }
  if (mode === "append_chat_completions") {
    return ["/chat/completions", "", "/v1/chat/completions"];
  }
  if (mode === "append_v1_chat_completions") {
    return ["/v1/chat/completions", "", "/chat/completions"];
  }
  return ["", "/chat/completions", "/v1/chat/completions"];
}

function preferredModelPaths(mode: EndpointPathMode, isResponses: boolean) {
  if (isResponses) {
    if (mode === "append_chat_completions") {
      return ["/models", "/v1/models", "/responses", "/v1/responses", "/chat/completions", "/v1/chat/completions"];
    }
    if (mode === "append_v1_chat_completions") {
      return ["/v1/models", "/models", "/v1/responses", "/responses", "/v1/chat/completions", "/chat/completions"];
    }
    return ["", "/models", "/v1/models", "/responses", "/v1/responses", "/chat/completions", "/v1/chat/completions"];
  }
  if (mode === "append_chat_completions") {
    return ["/models", "", "/v1/models", "/chat/completions", "/v1/chat/completions", "/responses", "/v1/responses"];
  }
  if (mode === "append_v1_chat_completions") {
    return ["/v1/models", "", "/models", "/v1/chat/completions", "/chat/completions", "/responses", "/v1/responses"];
  }
  return ["", "/models", "/v1/models", "/chat/completions", "/v1/chat/completions", "/responses", "/v1/responses"];
}

async function readSseStream(response: Response, onDelta: (delta: string) => void, endpoint: string) {
  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, fullText: "", message: "AI 流式响应没有可读取的内容。" };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let rawText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const delta = parseSseBlock(part);
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      }
    }
    const tail = `${buffer}${decoder.decode()}`;
    if (tail.trim()) {
      rawText += tail;
      const delta = parseSseBlock(tail);
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
    }
  } catch (error) {
    const logPath = saveAiRawResponse("stream-read-error", endpoint, rawText);
    return {
      ok: false,
      fullText,
      message: `AI 流式读取失败：${error instanceof Error ? error.message : String(error)}\n日志: ${logPath}`,
    };
  }

  if (fullText) {
    return { ok: true, fullText, message: "" };
  }
  const parsed = parseCompletionText(rawText);
  if (parsed) {
    onDelta(parsed);
    return { ok: true, fullText: parsed, message: "" };
  }
  const logPath = saveAiRawResponse("stream-empty", endpoint, rawText);
  return { ok: false, fullText: "", message: `AI 流式响应未解析到文本，请尝试关闭 stream 或换 endpoint。\n日志: ${logPath}` };
}

function parseSseBlock(block: string) {
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  let output = "";
  for (const data of dataLines) {
    if (data === "[DONE]") {
      continue;
    }
    output += parseDeltaPayload(data);
  }
  return output;
}

function parseDeltaPayload(text: string) {
  try {
    const json = JSON.parse(text) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
        text?: string;
      }>;
      output_text?: string;
      response?: string;
      content?: Array<{ text?: string }> | string;
    };
    if (typeof json.content === "string") {
      return json.content;
    }
    return (
      json.choices?.[0]?.delta?.content ??
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.text ??
      json.output_text ??
      json.response ??
      json.content?.map((item) => item.text ?? "").join("") ??
      ""
    );
  } catch {
    return "";
  }
}

function parseSsePayload(text: string, onDelta: (delta: string) => void): { ok: boolean; fullText: string; message: string } {
  let fullText = "";
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const delta = parseSseBlock(block);
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
  }
  return fullText ? { ok: true, fullText, message: "" } : { ok: false, fullText: "", message: "AI 流式响应未解析到文本。" };
}

function parseCompletionText(text: string) {
  try {
    const data = JSON.parse(text) as {
      output_text?: string;
      response?: string;
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
        text?: string;
      }>;
      content?: Array<{ text?: string }> | string;
    };
    if (typeof data.content === "string") {
      return data.content;
    }
    return (
      data.output_text ||
      data.response ||
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      data.choices?.[0]?.text ||
      data.content?.map((item) => item.text ?? "").join("") ||
      ""
    );
  } catch {
    return "";
  }
}

function parseModelsList(text: string) {
  try {
    const data = JSON.parse(text) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string } | string>;
      object?: string;
    };
    const models = [
      ...(data.data ?? []).map((item) => item.id).filter(Boolean),
      ...(data.models ?? []).map((item) => (typeof item === "string" ? item : item.id)).filter(Boolean),
    ] as string[];
    return Array.from(new Set(models)).sort();
  } catch {
    return [];
  }
}

function shouldRetry(status: number, text: string, contentType: string | null) {
  if (status === 401 || status === 403 || status === 429) {
    return false;
  }
  if (status === 404 || status === 405 || status === 410 || status === 415) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  if (looksLikeHtml(text) || (contentType ? contentType.includes("text/html") : false)) {
    return true;
  }
  const lower = text.toLowerCase();
  return lower.includes("endpoint") || lower.includes("route") || lower.includes("path") || lower.includes("not found") || lower.includes("404");
}

function explainHttpError(status: number, text: string) {
  const body = text.slice(0, 500);
  if (status === 401) {
    return `认证失败，请检查 API Key。${body}`;
  }
  if (status === 403) {
    return `当前账号无权限或订阅不可用。${body}`;
  }
  if (status === 404) {
    return `接口地址、endpoint 或模型不存在。${body}`;
  }
  if (status === 429) {
    return `触发限流，请稍后再试。${body}`;
  }
  return `AI 请求失败：HTTP ${status} ${body}`;
}

function explainFetchError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "请求超时，请稍后重试。";
    }
    const message = error.message.toLowerCase();
    if (
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("etimedout")
    ) {
      return "网络连接失败，请检查网络或代理设置。";
    }
    return error.message;
  }
  return String(error);
}

function saveAiRawResponse(kind: string, endpoint: string, content: string) {
  const dir = path.join(getStoragePath(), "logs", "ai");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ kind, endpoint, createdAt: new Date().toISOString(), content: sanitizeForLog(content.slice(0, 200000)) }, null, 2),
    "utf-8",
  );
  return filePath;
}

function logAiEvent(event: string, payload: Record<string, unknown>) {
  try {
    const dir = path.join(getStoragePath(), "logs", "ai");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "ai-events.log"), `${JSON.stringify({ event, at: new Date().toISOString(), ...payload })}\n`, "utf-8");
  } catch {
    // Logging should never break chat.
  }
}

function splitValues(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function rootBase(value: string) {
  return value
    .replace(/\/chat\/completions$/, "")
    .replace(/\/responses$/, "")
    .replace(/\/models$/, "")
    .replace(/\/v1$/, "");
}

function joinPath(base: string, suffix: string) {
  return suffix ? `${base}${suffix}` : base;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function looksLikeHtml(text: string) {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.includes("<script") || trimmed.includes("<head");
}

function looksLikeModelsPayload(text: string) {
  try {
    const data = JSON.parse(text) as { data?: unknown[]; models?: unknown[]; object?: string };
    return Boolean((Array.isArray(data.data) && data.data.length) || (Array.isArray(data.models) && data.models.length) || data.object === "list");
  } catch {
    return false;
  }
}

function chatContentTextLength(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content.length;
  }
  return content.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
}
