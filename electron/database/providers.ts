import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import type { Provider, ProviderInput } from "../../shared/types";
import { getDb } from "./index";

interface ProviderRow extends Omit<Provider, "stream" | "isDefault" | "autoAppendPath" | "enabledModels"> {
  enabledModels: string;
  stream: number;
  autoAppendPath: number;
  isDefault: number;
}

function nowIso() {
  return new Date().toISOString();
}

function encryptApiKey(apiKey: string) {
  if (!apiKey) {
    return "";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return apiKey;
  }
  return safeStorage.encryptString(apiKey).toString("base64");
}

function decryptApiKey(value: string) {
  if (!value || !safeStorage.isEncryptionAvailable()) {
    return value || "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function parseEnabledModels(value: string | null | undefined, fallbackModel: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) {
      const models = parsed.map((item) => String(item).trim()).filter(Boolean);
      return uniqueModels(models.length ? models : [fallbackModel]);
    }
  } catch {
    // Fall back below for old or invalid rows.
  }
  return uniqueModels([fallbackModel]);
}

function stringifyEnabledModels(models: string[] | undefined, fallbackModel: string) {
  return JSON.stringify(uniqueModels([...(models ?? []), fallbackModel]));
}

function uniqueModels(models: string[]) {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function toProvider(row: ProviderRow): Provider {
  return {
    ...row,
    apiKey: decryptApiKey(row.apiKey),
    enabledModels: parseEnabledModels(row.enabledModels, row.model),
    stream: Boolean(row.stream),
    endpointType: row.endpointType || "chat_completions",
    autoAppendPath: Boolean(row.autoAppendPath),
    endpointPathMode: row.endpointPathMode || (row.autoAppendPath ? "append_v1_chat_completions" : "exact"),
    isDefault: Boolean(row.isDefault),
  };
}

export function listProviders(): Provider[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, baseUrl, apiKey, model, temperature, maxTokens, stream, endpointType, autoAppendPath, endpointPathMode, isDefault, createdAt
       , enabledModels
       FROM providers
       ORDER BY isDefault DESC, createdAt ASC`,
    )
    .all() as ProviderRow[];
  return rows.map(toProvider);
}

export function getDefaultProvider(): Provider {
  const rows = listProviders();
  const provider = rows.find((item) => item.isDefault) ?? rows[0];
  if (!provider) {
    throw new Error("请先在设置中添加 AI Provider");
  }
  return provider;
}

export function getProvider(id: string): Provider {
  const row = getDb()
    .prepare(
      `SELECT id, name, baseUrl, apiKey, model, temperature, maxTokens, stream, endpointType, autoAppendPath, endpointPathMode, isDefault, createdAt
       , enabledModels
       FROM providers WHERE id = ?`,
    )
    .get(id) as ProviderRow | undefined;
  if (!row) {
    throw new Error("Provider not found");
  }
  return toProvider(row);
}

export function createProvider(input: ProviderInput): Provider {
  const db = getDb();
  const id = randomUUID();
  const at = nowIso();
  const isDefault = input.isDefault ? 1 : 0;
  const tx = db.transaction(() => {
    if (isDefault) {
      db.prepare("UPDATE providers SET isDefault = 0").run();
    }
    db.prepare(
      `INSERT INTO providers(id, name, baseUrl, apiKey, model, enabledModels, temperature, maxTokens, stream, endpointType, autoAppendPath, endpointPathMode, isDefault, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name.trim(),
      input.baseUrl.trim(),
      encryptApiKey(input.apiKey),
      input.model.trim(),
      stringifyEnabledModels(input.enabledModels, input.model),
      input.temperature ?? 0.7,
      input.maxTokens ?? 4096,
      input.stream === false ? 0 : 1,
      input.endpointType ?? "chat_completions",
      input.autoAppendPath ? 1 : 0,
      input.endpointPathMode ?? (input.autoAppendPath ? "append_v1_chat_completions" : "exact"),
      isDefault,
      at,
    );
  });
  tx();
  return getProvider(id);
}

export function updateProvider(id: string, input: Partial<ProviderInput>): Provider {
  const current = getProvider(id);
  const next = { ...current, ...input };
  const db = getDb();
  const tx = db.transaction(() => {
    if (input.isDefault) {
      db.prepare("UPDATE providers SET isDefault = 0").run();
    }
    db.prepare(
      `UPDATE providers
       SET name = ?, baseUrl = ?, apiKey = ?, model = ?, enabledModels = ?, temperature = ?, maxTokens = ?, stream = ?, endpointType = ?, autoAppendPath = ?, endpointPathMode = ?, isDefault = ?
       WHERE id = ?`,
    ).run(
      next.name.trim(),
      next.baseUrl.trim(),
      input.apiKey === undefined ? encryptApiKey(current.apiKey) : encryptApiKey(input.apiKey),
      next.model.trim(),
      stringifyEnabledModels(next.enabledModels, next.model),
      next.temperature ?? 0.7,
      next.maxTokens ?? 4096,
      next.stream === false ? 0 : 1,
      next.endpointType ?? "chat_completions",
      next.autoAppendPath ? 1 : 0,
      next.endpointPathMode ?? (next.autoAppendPath ? "append_v1_chat_completions" : "exact"),
      next.isDefault ? 1 : 0,
      id,
    );
  });
  tx();
  return getProvider(id);
}

export function deleteProvider(id: string) {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function setDefaultProvider(id: string): Provider {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE providers SET isDefault = 0").run();
    db.prepare("UPDATE providers SET isDefault = 1 WHERE id = ?").run(id);
  });
  tx();
  return getProvider(id);
}
