import type { ModelCapabilitiesMap, ModelCapability } from "./types";

const CAPABILITIES = new Set<ModelCapability>(["text", "vision", "tools", "web", "reasoning"]);
// UI permissions/defaults, not a claim that a provider actually supports each feature.
export const DEFAULT_MODEL_CAPABILITIES: readonly ModelCapability[] = ["text", "vision", "tools", "reasoning"];
export const ALL_MODEL_CAPABILITIES: readonly ModelCapability[] = ["text", "vision", "tools", "web", "reasoning"];

export function normalizeModelCapabilities(values: readonly string[]): ModelCapability[] {
  return Array.from(new Set<ModelCapability>(["text", ...values.filter((value): value is ModelCapability => CAPABILITIES.has(value as ModelCapability))]));
}

export function inferModelCapabilities(model: string, metadata?: unknown): ModelCapability[] {
  const metadataCapabilities = inferFromMetadata(metadata);
  if (metadataCapabilities) {
    return metadataCapabilities;
  }

  return inferFromModelName(model);
}

export function defaultModelCapabilities(model: string, metadata?: unknown): ModelCapability[] {
  const metadataCapabilities = inferFromMetadata(metadata);
  if (metadataCapabilities) {
    return metadataCapabilities;
  }

  const inferred = inferFromModelName(model);
  return normalizeModelCapabilities([
    ...DEFAULT_MODEL_CAPABILITIES,
    ...(inferred.includes("web") ? ["web"] : []),
  ]);
}

function inferFromModelName(model: string): ModelCapability[] {
  const lower = model.toLowerCase();
  const capabilities: ModelCapability[] = ["text"];
  if (/vision|multimodal|vl|image[-_ ]?input|visual|gpt-4o|gemini|qwen-vl|qvq|llava|pixtral|claude-3|claude-4|doubao.*vision/.test(lower)) {
    capabilities.push("vision");
  }
  if (/tool|function|gpt-4o|gpt-5|claude|gemini|qwen|max|deepseek/.test(lower)) {
    capabilities.push("tools");
  }
  if (/web|search|online|sonar|perplexity|联网/.test(lower)) {
    capabilities.push("web");
  }
  if (/reason|thinking|r1|o1|o3|o4|qvq|qwq|deepseek-reasoner/.test(lower)) {
    capabilities.push("reasoning");
  }
  return normalizeModelCapabilities(capabilities);
}

export function mergeModelCapabilities(
  current: ModelCapabilitiesMap | undefined,
  models: readonly string[],
  detected?: ModelCapabilitiesMap,
): ModelCapabilitiesMap {
  const out: ModelCapabilitiesMap = { ...(current ?? {}) };
  for (const model of models) {
    out[model] = normalizeModelCapabilities(current?.[model] ?? detected?.[model] ?? defaultModelCapabilities(model));
  }
  return out;
}

function inferFromMetadata(metadata: unknown): ModelCapability[] | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const source = metadata as Record<string, unknown>;
  const architecture = source.architecture && typeof source.architecture === "object"
    ? source.architecture as Record<string, unknown> : undefined;
  const fields = [
    ["capabilities", source.capabilities],
    ["supported_features", source.supported_features],
    ["supportedFeatures", source.supportedFeatures],
    ["features", source.features],
    ["modalities", source.modalities],
    ["input_modalities", source.input_modalities],
    ["inputModalities", source.inputModalities],
    ["output_modalities", source.output_modalities],
    ["outputModalities", source.outputModalities],
  ] as const;
  const architectureFields = [
    ["modalities", architecture?.modalities],
    ["input_modalities", architecture?.input_modalities],
  ] as const;
  const hasMetadata = [...fields, ...architectureFields].some(([, value]) => value != null);
  if (!hasMetadata) {
    return undefined;
  }
  const tokens = [...fields, ...architectureFields].flatMap(([, value]) => flattenMetadata(value).map((item) => item.toLowerCase()));
  const capabilities: ModelCapability[] = ["text"];
  if (tokens.some((token) => /vision|image|visual|multimodal|video/.test(token))) {
    capabilities.push("vision");
  }
  if (tokens.some((token) => /tool|function[_ -]?call|function[_ -]?calling/.test(token))) {
    capabilities.push("tools");
  }
  if (tokens.some((token) => /web|search|browser|internet|online/.test(token))) {
    capabilities.push("web");
  }
  if (tokens.some((token) => /reason|thinking|chain[_ -]?of[_ -]?thought/.test(token))) {
    capabilities.push("reasoning");
  }
  return normalizeModelCapabilities(capabilities);
}

function flattenMetadata(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenMetadata);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      item === false || item == null ? [] : [key, ...flattenMetadata(item)]);
  }
  return [];
}
