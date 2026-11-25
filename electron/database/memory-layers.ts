import { randomUUID } from "node:crypto";
import { getDb } from "./index";

export interface MemoryLayer {
  id: string;
  conversationId: string;
  level: number;
  summary: string;
  startMessageId: string;
  endMessageId: string;
  createdAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

export function listMemoryLayers(conversationId: string): MemoryLayer[] {
  const rows = getDb()
    .prepare(
      `SELECT id, conversationId, level, summary, startMessageId, endMessageId, createdAt
       FROM memory_layers
       WHERE conversationId = ?
       ORDER BY level ASC, createdAt ASC`,
    )
    .all(conversationId) as MemoryLayer[];
  return rows;
}

export function createMemoryLayer(
  conversationId: string,
  level: number,
  summary: string,
  startMessageId: string,
  endMessageId: string,
): MemoryLayer {
  const id = randomUUID();
  const at = nowIso();
  getDb()
    .prepare(
      `INSERT INTO memory_layers(id, conversationId, level, summary, startMessageId, endMessageId, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, conversationId, level, summary, startMessageId, endMessageId, at);
  return {
    id,
    conversationId,
    level,
    summary,
    startMessageId,
    endMessageId,
    createdAt: at,
  };
}

export function getNextLevel(conversationId: string): number {
  const row = getDb()
    .prepare("SELECT MAX(level) AS maxLevel FROM memory_layers WHERE conversationId = ?")
    .get(conversationId) as { maxLevel: number | null };
  return (row?.maxLevel ?? 0) + 1;
}

export function deleteMemoryLayers(conversationId: string) {
  getDb().prepare("DELETE FROM memory_layers WHERE conversationId = ?").run(conversationId);
}
