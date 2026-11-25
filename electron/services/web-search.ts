import { getSetting } from "../database/settings";

export type WebSearchProvider = "tavily" | "serper" | "brave";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface WebSearchSettings {
  enabled: boolean;
  mode: "auto" | "builtin" | "search_api";
  provider: WebSearchProvider;
  apiKey: string;
  maxResults: number;
}

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current or real-time information: news, weather, prices, market updates, recent events, product details, or anything newer than the model's training data. Returns a list of recent web search results with titles, snippets, and URLs.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A concise, focused web search query for the information the user needs.",
        },
        maxResults: {
          type: "integer",
          description: "Optional number of search results to return. Defaults to 5.",
          minimum: 1,
          maximum: 8,
        },
      },
      required: ["query"],
    },
  },
} as const;

export function webSearchToolDefinitions() {
  return [WEB_SEARCH_TOOL];
}

export function isWebSearchConfigured() {
  const settings = getWebSearchSettings();
  return settings.enabled && Boolean(settings.apiKey.trim());
}

export function getWebSearchSettings(): WebSearchSettings {
  const rawMode = getSetting("webSearchMode") ?? "auto";
  const mode: WebSearchSettings["mode"] = rawMode === "search_api" || rawMode === "builtin" ? rawMode : "auto";
  const rawProvider = getSetting("webSearchProvider") ?? "tavily";
  const provider: WebSearchProvider = rawProvider === "serper" || rawProvider === "brave" ? rawProvider : "tavily";
  return {
    enabled: getSetting("webSearchEnabled") === "true",
    mode,
    provider,
    apiKey: getSetting("webSearchApiKey") ?? "",
    maxResults: clampMaxResults(Number.parseInt(getSetting("webSearchMaxResults") ?? "5", 10)),
  };
}

export async function searchWebResults(query: string, options?: { signal?: AbortSignal; maxResults?: number }): Promise<WebSearchResult[]> {
  const settings = getWebSearchSettings();
  const maxResults = clampMaxResults(options?.maxResults ?? settings.maxResults);
  if (!settings.enabled) {
    throw new Error("联网搜索未开启，请在设置中启用。");
  }
  if (!settings.apiKey.trim()) {
    throw new Error("联网搜索未配置 API Key，请先在设置中填写。");
  }
  if (!query.trim()) {
    throw new Error("搜索关键词不能为空。");
  }
  const signal = options?.signal ?? AbortSignal.timeout(20000);
  try {
    if (settings.provider === "serper") {
      return await searchSerper(settings.apiKey, query, maxResults, signal);
    }
    if (settings.provider === "brave") {
      return await searchBrave(settings.apiKey, query, maxResults, signal);
    }
    return await searchTavily(settings.apiKey, query, maxResults, signal);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

export function formatWebSearchResults(results: WebSearchResult[]) {
  if (!results.length) {
    return "没有搜索到相关结果。";
  }
  return results
    .map((item, index) => {
      const title = item.title || "(无标题)";
      const url = item.url || "";
      const snippet = (item.snippet || "").replace(/\s+/g, " ").trim();
      return `${index + 1}. ${title}\n   链接: ${url}\n   摘要: ${snippet}`;
    })
    .join("\n\n");
}

export function parseWebSearchQuery(toolCall: WebSearchToolCall): { query: string; maxResults?: number } {
  const args = JSON.parse(toolCall.function.arguments || "{}") as { query?: unknown; maxResults?: unknown };
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const maxResults = typeof args.maxResults === "number" ? args.maxResults : undefined;
  return { query, maxResults };
}

async function searchTavily(apiKey: string, query: string, maxResults: number, signal: AbortSignal) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: maxResults }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Tavily 搜索失败: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).slice(0, maxResults).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: item.content ?? "",
  }));
}

async function searchSerper(apiKey: string, query: string, maxResults: number, signal: AbortSignal) {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Serper 搜索失败: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.organic ?? []).slice(0, maxResults).map((item) => ({
    title: item.title ?? "",
    url: item.link ?? "",
    snippet: item.snippet ?? "",
  }));
}

async function searchBrave(apiKey: string, query: string, maxResults: number, signal: AbortSignal) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Brave 搜索失败: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).slice(0, maxResults).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: item.description ?? "",
  }));
}

function clampMaxResults(value: number) {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(8, Math.max(1, Math.round(value)));
}
