import fs from "node:fs";
import { getDb } from "../database";

export function exportAllData() {
  const db = getDb();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: db.prepare("SELECT * FROM conversations ORDER BY updatedAt DESC").all(),
    messages: db.prepare("SELECT * FROM messages ORDER BY createdAt ASC").all(),
    settings: db.prepare("SELECT * FROM settings ORDER BY key ASC").all(),
    providers: db.prepare("SELECT * FROM providers ORDER BY createdAt ASC").all(),
  };
}

export function exportAllDataToFile(filePath: string) {
  fs.writeFileSync(filePath, JSON.stringify(exportAllData(), null, 2), "utf-8");
}

export function importAllDataFromFile(filePath: string) {
  let payload: {
    conversations?: Record<string, unknown>[];
    messages?: Record<string, unknown>[];
    settings?: Record<string, unknown>[];
    providers?: Record<string, unknown>[];
  };
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    throw new Error("导入数据格式错误：不是合法 JSON 文件。");
  }
  validateImportPayload(payload);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM conversations").run();
    db.prepare("DELETE FROM settings").run();
    db.prepare("DELETE FROM providers").run();

    for (const row of payload.conversations ?? []) {
      db.prepare(
        `INSERT OR REPLACE INTO conversations(id, title, summary, systemPrompt, createdAt, updatedAt)
         VALUES(@id, @title, @summary, @systemPrompt, @createdAt, @updatedAt)`,
      ).run(row);
    }
    for (const row of payload.messages ?? []) {
      db.prepare(
        `INSERT OR REPLACE INTO messages(
          id, conversationId, role, content, compressed, createdAt, status,
          agentId, agentName, parentMessageId, attachments, messageType
        )
         VALUES(
          @id, @conversationId, @role, @content, @compressed, @createdAt, @status,
          @agentId, @agentName, @parentMessageId, @attachments, @messageType
        )`,
      ).run({
        agentId: "",
        agentName: "",
        parentMessageId: "",
        attachments: "[]",
        messageType: "normal",
        ...row,
      });
    }
    for (const row of payload.settings ?? []) {
      db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(@key, @value)").run(row);
    }
    for (const row of payload.providers ?? []) {
      db.prepare(
        `INSERT OR REPLACE INTO providers(
          id, name, baseUrl, apiKey, model, enabledModels, temperature, maxTokens, stream,
          endpointType, autoAppendPath, endpointPathMode, isDefault, createdAt
        )
         VALUES(
          @id, @name, @baseUrl, @apiKey, @model, @enabledModels, @temperature, @maxTokens, @stream,
          @endpointType, @autoAppendPath, @endpointPathMode, @isDefault, @createdAt
        )`,
      ).run({
        enabledModels: "[]",
        endpointType: "chat_completions",
        autoAppendPath: 0,
        endpointPathMode: "append_chat_completions",
        ...row,
      });
    }
  });
  tx();
}

function validateImportPayload(payload: unknown): asserts payload is {
  conversations?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
  settings?: Record<string, unknown>[];
  providers?: Record<string, unknown>[];
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("导入数据格式错误：文件内容不是对象。");
  }
  const data = payload as Record<string, unknown>;
  for (const key of ["conversations", "messages", "settings", "providers"]) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`导入数据格式错误：${key} 必须是数组。`);
    }
  }
  for (const row of (data.conversations as Record<string, unknown>[] | undefined) ?? []) {
    if (!row.id || !row.title) {
      throw new Error("导入数据格式错误：conversations 缺少 id 或 title。");
    }
  }
  for (const row of (data.messages as Record<string, unknown>[] | undefined) ?? []) {
    if (!row.id || !row.conversationId || !row.role || row.content === undefined) {
      throw new Error("导入数据格式错误：messages 缺少必要字段。");
    }
  }
}
