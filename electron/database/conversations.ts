import { randomUUID } from "node:crypto";
import type { Conversation } from "../../shared/types";
import { getDb } from "./index";

function nowIso() {
  return new Date().toISOString();
}

export function listConversations(): Conversation[] {
  return getDb()
    .prepare(
      `SELECT id, title, summary, systemPrompt, createdAt, updatedAt
       FROM conversations
       ORDER BY updatedAt DESC`,
    )
    .all() as Conversation[];
}

export function getConversation(id: string): Conversation {
  const row = getDb()
    .prepare("SELECT id, title, summary, systemPrompt, createdAt, updatedAt FROM conversations WHERE id = ?")
    .get(id) as Conversation | undefined;
  if (!row) {
    throw new Error("Conversation not found");
  }
  return row;
}

export function createConversation(title: string): Conversation {
  const id = randomUUID();
  const at = nowIso();
  const cleanTitle = title.trim() || "新会话";
  getDb()
    .prepare(
      `INSERT INTO conversations(id, title, summary, systemPrompt, createdAt, updatedAt)
       VALUES(?, ?, '', '', ?, ?)`,
    )
    .run(id, cleanTitle, at, at);
  return getConversation(id);
}

export function renameConversation(id: string, title: string): Conversation {
  const cleanTitle = title.trim() || "未命名会话";
  getDb().prepare("UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?").run(cleanTitle, nowIso(), id);
  return getConversation(id);
}

export function deleteConversation(id: string) {
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function updateConversationSummary(id: string, summary: string): Conversation {
  getDb().prepare("UPDATE conversations SET summary = ?, updatedAt = ? WHERE id = ?").run(summary, nowIso(), id);
  return getConversation(id);
}

export function updateConversationSystemPrompt(id: string, prompt: string): Conversation {
  getDb().prepare("UPDATE conversations SET systemPrompt = ?, updatedAt = ? WHERE id = ?").run(prompt, nowIso(), id);
  return getConversation(id);
}

export function updateConversationSummaryAndCompressMessages(id: string, summary: string, messageIds: string[]): Conversation {
  const db = getDb();
  const at = nowIso();
  const tx = db.transaction(() => {
    db.prepare("UPDATE conversations SET summary = ?, updatedAt = ? WHERE id = ?").run(summary, at, id);
    const stmt = db.prepare("UPDATE messages SET compressed = 1 WHERE id = ?");
    for (const messageId of messageIds) {
      stmt.run(messageId);
    }
  });
  tx();
  return getConversation(id);
}
