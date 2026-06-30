import { randomUUID } from "node:crypto";
import type { AIAgent, AIAgentInput } from "../../shared/types";
import { getDb } from "./index";

type AIAgentRow = AIAgent;

function nowIso() {
  return new Date().toISOString();
}

function toAgent(row: AIAgentRow): AIAgent {
  return {
    ...row,
    enabled: row.enabled ? 1 : 0,
    isPrimary: row.isPrimary ? 1 : 0,
  };
}

function normalizeInput(input: Partial<AIAgentInput>, fallback?: AIAgent): AIAgentInput {
  return {
    name: (input.name ?? fallback?.name ?? "").trim(),
    description: (input.description ?? fallback?.description ?? "").trim(),
    providerId: (input.providerId ?? fallback?.providerId ?? "").trim(),
    model: (input.model ?? fallback?.model ?? "").trim(),
    systemPrompt: (input.systemPrompt ?? fallback?.systemPrompt ?? "").trim(),
    rolePreset: (input.rolePreset ?? fallback?.rolePreset ?? "").trim(),
    enabled: normalizeFlag(input.enabled ?? fallback?.enabled ?? 1),
    isPrimary: normalizeFlag(input.isPrimary ?? fallback?.isPrimary ?? 0),
  };
}

function normalizeFlag(value: number | boolean) {
  return value === true || value === 1 ? 1 : 0;
}

export function listAgents(): AIAgent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, description, providerId, model, systemPrompt, rolePreset, enabled, isPrimary, createdAt, updatedAt
       FROM ai_agents
       ORDER BY isPrimary DESC, enabled DESC, createdAt ASC`,
    )
    .all() as AIAgentRow[];
  return rows.map(toAgent);
}

export function listEnabledAgents(): AIAgent[] {
  return listAgents().filter((agent) => agent.enabled);
}

export function getAgent(id: string): AIAgent {
  const row = getDb()
    .prepare(
      `SELECT id, name, description, providerId, model, systemPrompt, rolePreset, enabled, isPrimary, createdAt, updatedAt
       FROM ai_agents WHERE id = ?`,
    )
    .get(id) as AIAgentRow | undefined;
  if (!row) {
    throw new Error("AI Agent not found");
  }
  return toAgent(row);
}

export function getPrimaryAgent(): AIAgent | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, description, providerId, model, systemPrompt, rolePreset, enabled, isPrimary, createdAt, updatedAt
       FROM ai_agents WHERE isPrimary = 1 LIMIT 1`,
    )
    .get() as AIAgentRow | undefined;
  return row ? toAgent(row) : null;
}

export function createAgent(input: AIAgentInput): AIAgent {
  const next = normalizeInput(input);
  if (!next.name) {
    throw new Error("AI 名称不能为空");
  }
  const db = getDb();
  const id = randomUUID();
  const at = nowIso();
  const tx = db.transaction(() => {
    if (next.isPrimary) {
      db.prepare("UPDATE ai_agents SET isPrimary = 0").run();
    }
    db.prepare(
      `INSERT INTO ai_agents(id, name, description, providerId, model, systemPrompt, rolePreset, enabled, isPrimary, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      next.name,
      next.description,
      next.providerId,
      next.model,
      next.systemPrompt,
      next.rolePreset,
      normalizeFlag(next.enabled ?? 1),
      next.isPrimary ? 1 : 0,
      at,
      at,
    );
  });
  tx();
  return getAgent(id);
}

export function updateAgent(id: string, input: Partial<AIAgentInput>): AIAgent {
  const current = getAgent(id);
  const next = normalizeInput(input, current);
  if (!next.name) {
    throw new Error("AI 名称不能为空");
  }
  const db = getDb();
  const tx = db.transaction(() => {
    if (input.isPrimary) {
      db.prepare("UPDATE ai_agents SET isPrimary = 0").run();
    }
    db.prepare(
      `UPDATE ai_agents
       SET name = ?, description = ?, providerId = ?, model = ?, systemPrompt = ?, rolePreset = ?,
           enabled = ?, isPrimary = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(
      next.name,
      next.description,
      next.providerId,
      next.model,
      next.systemPrompt,
      next.rolePreset,
      normalizeFlag(next.enabled ?? 1),
      next.isPrimary ? 1 : 0,
      nowIso(),
      id,
    );
  });
  tx();
  return getAgent(id);
}

export function deleteAgent(id: string) {
  getDb().prepare("DELETE FROM ai_agents WHERE id = ?").run(id);
}

export function setPrimaryAgent(id: string): AIAgent {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE ai_agents SET isPrimary = 0").run();
    db.prepare("UPDATE ai_agents SET isPrimary = 1, enabled = 1, updatedAt = ? WHERE id = ?").run(nowIso(), id);
  });
  tx();
  return getAgent(id);
}

export function setAgentEnabled(id: string, enabled: boolean): AIAgent {
  getDb()
    .prepare("UPDATE ai_agents SET enabled = ?, updatedAt = ? WHERE id = ?")
    .run(enabled ? 1 : 0, nowIso(), id);
  return getAgent(id);
}
