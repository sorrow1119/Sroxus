import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { defaultModelCapabilities } from "../../shared/model-capabilities";
import type { EndpointPathMode, ModelCapabilitiesMap, ProviderInput } from "../../shared/types";
import { sanitizeForLog, sanitizeMessagesForAI } from "./privacy-filter";
import { getStoragePath } from "./storage-path";
import {
  formatWebSearchResults,
  getWebSearchSettings,
  isWebSearchConfigured,
  parseWebSearchQuery,
  searchWebResults,
  webSearchToolDefinitions,
  type WebSearchToolCall,
} from "./web-search";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[];
  tool_calls?: WebSearchToolCall[];
  tool_call_id?: string;
};

type ChatOptions = {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  maxTokens?: number;
  stream?: boolean;
  disableWebSearch?: boolean;
};

type ProbeResult =
  | { ok: true; endpoint: string; fullText: string }
  | { ok: false; endpoint: string; retryable: boolean; message: string };

type SearchProbeResult =
  | { status: "ok"; endpoint: string; fullText: string }
  | { status: "tool_calls"; endpoint: string; fullText: string; toolCalls: WebSearchToolCall[] }
  | { status: "error"; endpoint: string; retryable: boolean; unsupportedTools: boolean; message: string };

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

  async listModels(fetcher: typeof fetch = fetch): Promise<{ ok: boolean; models: string[]; modelCapabilities?: ModelCapabilitiesMap; message: string }> {
    const roots = this.baseUrls();
    let lastError = "Provider 不支持获取模型。";
    for (const baseUrl of roots) {
      for (const endpoint of this.modelCandidates(baseUrl)) {
        try {
          const response = await fetcher(endpoint, {
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
          const parsed = parseModelsList(text);
          if (parsed.models.length) {
            return { ok: true, models: parsed.models, modelCapabilities: parsed.modelCapabilities, message: `已从 ${endpoint} 获取模型。` };
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
              const models = parseModelsList(text).models;
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
    const builtinWebSearch = !options.disableWebSearch && this.hasBuiltinWebSearch();
    if (!options.disableWebSearch && isWebSearchConfigured() && !builtinWebSearch) {
      const searchResult = await this.chatWithWebSearch(outboundMessages, options);
      if (searchResult.ok) {
        logAiEvent("chat:success", { endpoint: searchResult.endpoint, model: this.config.model, outputChars: searchResult.fullText.length, webSearch: true });
        return searchResult.fullText;
      }
      lastError = searchResult.message;
      // tool-calls 路径失败（网关不支持 function calling / 模型反复要搜不收尾等），
      // 自动降级为"直接搜索"：应用自己定搜索词并调用搜索 API，把结果注入上下文后
      // 用普通聊天请求发送，完全绕开工具调用，不依赖网关的 function calling 能力。
      const directFallback = await this.chatWithDirectSearch(outboundMessages, options);
      if (directFallback.ok) {
        logAiEvent("chat:success", { endpoint: directFallback.endpoint, model: this.config.model, outputChars: directFallback.fullText.length, webSearch: true, mode: "direct" });
        return directFallback.fullText;
      }
      logAiEvent("chat:failed", { model: this.config.model, message: `直接搜索降级也失败：${directFallback.message}`, webSearch: true, mode: "direct" });
      if (!searchResult.unsupportedTools) {
        logAiEvent("chat:failed", { model: this.config.model, message: searchResult.message, webSearch: true });
        throw new Error(searchResult.message);
      }
    }
    for (const baseUrl of this.baseUrls()) {
      for (const endpoint of this.chatCandidates(baseUrl)) {
        const result = await this.tryChatEndpoint(endpoint, outboundMessages, options, builtinWebSearch);
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

  private hasBuiltinWebSearch() {
    const mode = getWebSearchSettings().mode;
    if (mode === "search_api") {
      return false;
    }
    // 「模型自带联网」只有在 responses 端点（能注入 web_search_preview 工具）
    // 或模型名本身是原生联网模型（sonar/perplexity 等）时才真正成立。
    // chat_completions 网关下即使手动勾了 "web" 能力也无法注入联网工具，
    // 此时应退回第三方搜索 API 流程，而不是把 "web" 标记误判为已联网。
    if (modelLooksBuiltinWeb(this.config.model)) {
      return true;
    }
    if (this.config.endpointType !== "responses") {
      return false;
    }
    const capabilities = this.config.modelCapabilities?.[this.config.model] ?? [];
    return capabilities.includes("web");
  }

  private async chatWithWebSearch(messages: ChatMessage[], options: ChatOptions): Promise<{
    ok: boolean;
    endpoint: string;
    fullText: string;
    message: string;
    unsupportedTools: boolean;
  }> {
    let lastError = "联网搜索请求失败。";
    for (const baseUrl of this.baseUrls()) {
      for (const endpoint of this.chatCandidates(baseUrl)) {
        const result = await this.tryChatEndpointWithWebSearch(endpoint, messages, options);
        if (result.status === "ok") {
          options.onDelta(result.fullText);
          return { ok: true, endpoint, fullText: result.fullText, message: "", unsupportedTools: false };
        }
        if (result.status === "tool_calls") {
          try {
            const fullText = await this.runWebSearchLoop(endpoint, messages, result.toolCalls, options);
            return { ok: true, endpoint, fullText, message: "", unsupportedTools: false };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/工具不存在|不支持/.test(message)) {
              return { ok: false, endpoint, fullText: "", message, unsupportedTools: true };
            }
            return { ok: false, endpoint, fullText: "", message, unsupportedTools: false };
          }
        }
        if (result.unsupportedTools) {
          return { ok: false, endpoint, fullText: "", message: result.message, unsupportedTools: true };
        }
        lastError = result.message;
        if (!result.retryable) {
          return { ok: false, endpoint, fullText: "", message: result.message, unsupportedTools: false };
        }
      }
    }
    return { ok: false, endpoint: "", fullText: "", message: lastError, unsupportedTools: false };
  }

  // 直接搜索降级路线：不依赖网关的 function calling。
  // 流程：取用户最新消息作为搜索词 → 调用搜索 API → 把搜索结果作为"参考资料"
  // 注入上下文 → 走普通聊天请求（流式，与正常对话完全一致）。
  private async chatWithDirectSearch(messages: ChatMessage[], options: ChatOptions): Promise<{
    ok: boolean;
    endpoint: string;
    fullText: string;
    message: string;
  }> {
    const settings = getWebSearchSettings();
    let query = "";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        query = chatContentText(messages[index].content).trim();
        break;
      }
    }
    if (!query) {
      return { ok: false, endpoint: "", fullText: "", message: "没有可用的搜索关键词。" };
    }
    // 搜索词太长时截断，避免把整段对话塞给搜索引擎。
    if (query.length > 200) {
      query = query.slice(0, 200);
    }

    let searchBlock: string;
    try {
      const results = await searchWebResults(query, { signal: options.signal, maxResults: settings.maxResults });
      searchBlock = formatWebSearchResults(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, endpoint: "", fullText: "", message: `搜索请求失败：${message}` };
    }

    const augmented: ChatMessage[] = [
      ...messages,
      {
        role: "system",
        content: `以下是对搜索词「${query}」的网络搜索结果（可能已过时或不完整，请结合常识判断，引用时注明来源）：\n\n${searchBlock}\n\n请优先依据以上搜索结果回答用户最新的问题。`,
      },
    ];

    let lastError = "联网搜索（直接模式）请求失败。";
    for (const baseUrl of this.baseUrls()) {
      for (const endpoint of this.chatCandidates(baseUrl)) {
        const result = await this.tryChatEndpoint(endpoint, augmented, options, false);
        if (result.ok) {
          return { ok: true, endpoint, fullText: result.fullText, message: "" };
        }
        lastError = result.message;
        if (!result.retryable) {
          return { ok: false, endpoint, fullText: "", message: result.message };
        }
      }
    }
    return { ok: false, endpoint: "", fullText: "", message: lastError };
  }

  private async tryChatEndpointWithWebSearch(endpoint: string, messages: ChatMessage[], options: ChatOptions): Promise<SearchProbeResult> {
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
          stream: false,
          tools: webSearchToolDefinitions(),
          tool_choice: "auto",
        }),
        signal: options.signal,
      });
    } catch (error) {
      const message = explainFetchError(error);
      return { status: "error", endpoint, retryable: !message.includes("请求超时"), unsupportedTools: false, message };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const unsupportedTools = looksLikeUnsupportedTools(response.status, rawText, contentType);
      const logPath = saveAiRawResponse("web-search-http-error", endpoint, rawText);
      return {
        status: "error",
        endpoint,
        retryable: shouldRetry(response.status, rawText, contentType),
        unsupportedTools,
        message: `${explainHttpError(response.status, rawText)}\n日志: ${logPath}`,
      };
    }

    const rawText = await response.text().catch(() => "");
    const search = parseSearchCompletion(rawText);
    if (search.toolCalls.length) {
      return { status: "tool_calls", endpoint, fullText: search.content, toolCalls: search.toolCalls };
    }
    const parsed = parseCompletionText(rawText);
    if (parsed) {
      return { status: "ok", endpoint, fullText: parsed };
    }
    const logPath = saveAiRawResponse("web-search-parse-failed", endpoint, rawText);
    return {
      status: "error",
      endpoint,
      retryable: true,
      unsupportedTools: false,
      message: `联网搜索响应格式不符合预期。\n日志: ${logPath}`,
    };
  }

  private async runWebSearchLoop(endpoint: string, messages: ChatMessage[], firstToolCalls: WebSearchToolCall[], options: ChatOptions): Promise<string> {
    const working = [...messages];
    let toolCalls = firstToolCalls;
    let lastAnswer = "";
    let previousToolCallsSignature = "";
    let consecutiveToolOnlyRounds = 0;
    for (let round = 0; round < 4; round += 1) {
      const assistantContent = "";
      working.push({
        role: "assistant",
        content: assistantContent,
        tool_calls: toolCalls,
      });
      for (const toolCall of toolCalls) {
        let content: string;
        if (toolCall.function.name === "web_search") {
          try {
            const { query, maxResults } = parseWebSearchQuery(toolCall);
            if (!query) {
              content = "搜索关键词为空。";
            } else {
              const results = await searchWebResults(query, { signal: options.signal, maxResults });
              content = formatWebSearchResults(results);
            }
          } catch (error) {
            content = `搜索失败：${error instanceof Error ? error.message : String(error)}`;
          }
        } else {
          content = `工具不存在：${toolCall.function.name}`;
        }
        working.push({ role: "tool", tool_call_id: toolCall.id, content });
      }

      const result = await this.tryChatEndpointWithWebSearch(endpoint, working, options);
      if (result.status === "ok") {
        options.onDelta(result.fullText);
        return result.fullText;
      }
      if (result.status === "tool_calls") {
        // 模型既给了文字答案又继续请求工具：优先把已产出的答案落地，
        // 避免网关模型反复要搜、永不收尾导致循环耗尽。
        const hasText = Boolean(result.fullText && result.fullText.trim());
        if (hasText) {
          lastAnswer = result.fullText;
          consecutiveToolOnlyRounds = 0;
        } else {
          consecutiveToolOnlyRounds += 1;
        }
        // 连续两轮请求完全相同的工具（相同 query）说明网关模型陷入死循环。
        const nextSignature = result.toolCalls
          .map((call) => `${call.function.name}:${call.function.arguments}`)
          .sort()
          .join("|");
        if (previousToolCallsSignature && nextSignature === previousToolCallsSignature) {
          if (lastAnswer.trim()) {
            options.onDelta(lastAnswer);
            return lastAnswer;
          }
          throw new Error("联网搜索陷入重复搜索，已停止。请换一个模型或简化问题后重试。");
        }
        previousToolCallsSignature = nextSignature;
        // 连续两轮只返回工具调用、从不给出文字答案：说明该网关模型未正确支持
        // 函数调用（把 tools 参数忽略/幻觉出 tool_calls），及时终止避免空转。
        if (consecutiveToolOnlyRounds >= 2) {
          if (lastAnswer.trim()) {
            options.onDelta(lastAnswer);
            return lastAnswer;
          }
          throw new Error("当前模型未正确支持联网工具调用，已停止。请换一个支持 function calling 的模型，或在设置中改用第三方搜索。");
        }
        toolCalls = result.toolCalls;
        continue;
      }
      if (result.unsupportedTools) {
        throw new Error(result.message);
      }
      throw new Error(result.message);
    }
    // 循环耗尽：若中途已累积到模型给出的文字答案则兜底返回，否则才报错。
    if (lastAnswer.trim()) {
      options.onDelta(lastAnswer);
      return lastAnswer;
    }
    throw new Error("联网搜索工具循环超过最大轮数，请稍后重试。");
  }

  private async tryChatEndpoint(endpoint: string, messages: ChatMessage[], options: ChatOptions, nativeWebSearch = false): Promise<ProbeResult> {
    let response: Response;
    try {
      const requestBody: Record<string, unknown> = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
        stream: options.stream ?? this.config.stream ?? true,
      };
      if (nativeWebSearch && this.config.endpointType === "responses") {
        requestBody.tools = [{ type: "web_search_preview" }];
      }
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(requestBody),
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
      if (nativeWebSearch && looksLikeUnsupportedTools(response.status, rawText, contentType)) {
        return this.tryChatEndpoint(endpoint, messages, options, false);
      }
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

function parseSearchCompletion(text: string): { content: string; toolCalls: WebSearchToolCall[] } {
  try {
    const data = JSON.parse(text) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ text?: string }>;
          tool_calls?: Array<WebSearchToolCall & { id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    const content = Array.isArray(message?.content)
      ? (message?.content ?? []).map((part) => part.text ?? "").join("")
      : message?.content ?? "";
    const toolCalls = (message?.tool_calls ?? [])
      .map((call) => ({
        id: call.id ?? "",
        function: {
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "{}",
        },
      }))
      .filter((call) => call.id && call.function.name);
    return { content, toolCalls };
  } catch {
    return { content: "", toolCalls: [] };
  }
}

function looksLikeUnsupportedTools(status: number, text: string, contentType: string | null) {
  if (status !== 400 && status !== 422 && status !== 415 && status !== 501) {
    return false;
  }
  const lower = `${contentType ?? ""} ${text}`.toLowerCase();
  return (
    lower.includes("tool") ||
    lower.includes("function") ||
    lower.includes("unsupported") ||
    lower.includes("not support") ||
    lower.includes("does not support") ||
    lower.includes("no tools")
  );
}

function modelLooksBuiltinWeb(model: string) {
  return /sonar|perplexity|search-preview|search-preview|web-search|web_search|online|gemini.*search|glm.*web|deepseek.*web/i.test(model);
}

function parseModelsList(text: string): { models: string[]; modelCapabilities: ModelCapabilitiesMap } {
  try {
    const data = JSON.parse(text) as {
      data?: Array<Record<string, unknown> | string>;
      models?: Array<Record<string, unknown> | string>;
      object?: string;
    };
    const modelCapabilities: ModelCapabilitiesMap = {};
    const models = [...(data.data ?? []), ...(data.models ?? [])]
      .map((item) => {
        const id = typeof item === "string" ? item : typeof item.id === "string" ? item.id : "";
        if (id) {
          modelCapabilities[id] = defaultModelCapabilities(id, typeof item === "string" ? undefined : item);
        }
        return id;
      })
      .filter(Boolean);
    return { models: Array.from(new Set(models)).sort(), modelCapabilities };
  } catch {
    return { models: [], modelCapabilities: {} };
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

function chatContentText(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}
