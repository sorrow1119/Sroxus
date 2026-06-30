import { randomUUID } from "node:crypto";
import type { Message, MessageAttachment, MessageSearchResult, Role } from "../../shared/types";
import { getDb } from "./index";

interface MessageRow extends Omit<Message, "compressed" | "attachments"> {
  compressed: number;
  attachments?: string;
}

function parseAttachments(value: string | null | undefined): MessageAttachment[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const attachment = item as Partial<MessageAttachment>;
        return {
          id: String(attachment.id ?? ""),
          name: String(attachment.name ?? ""),
          originalPath: String(attachment.originalPath ?? ""),
          storedPath: String(attachment.storedPath ?? ""),
          mimeType: String(attachment.mimeType ?? ""),
          size: Number(attachment.size ?? 0),
          kind: (attachment.kind === "image" ? "image" : "document") as MessageAttachment["kind"],
          extractedText: attachment.extractedText ? String(attachment.extractedText) : undefined,
          previewDataUrl: attachment.previewDataUrl ? String(attachment.previewDataUrl) : undefined,
          note: attachment.note ? String(attachment.note) : undefined,
        };
      })
      .filter((attachment) => attachment.id && attachment.name && attachment.storedPath);
  } catch {
    return [];
  }
}

function stringifyAttachments(attachments: MessageAttachment[] | undefined) {
  return JSON.stringify(Array.isArray(attachments) ? attachments : []);
}

function toMessage(row: MessageRow): Message {
  return {
    ...row,
    compressed: Boolean(row.compressed),
    agentId: row.agentId || undefined,
    agentName: row.agentName || undefined,
    parentMessageId: row.parentMessageId || undefined,
    messageType: row.messageType || "normal",
    attachments: parseAttachments(row.attachments),
  };
}

function nowIso() {
  return new Date().toISOString();
}

export function listMessages(conversationId: string): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT id, conversationId, role, content, compressed, createdAt, status
       , agentId, agentName, parentMessageId, attachments, messageType
       FROM messages
       WHERE conversationId = ?
       ORDER BY createdAt ASC`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(toMessage);
}

export function getMessage(id: string): Message {
  const row = getDb()
    .prepare(
      "SELECT id, conversationId, role, content, compressed, createdAt, status, agentId, agentName, parentMessageId, attachments, messageType FROM messages WHERE id = ?",
    )
    .get(id) as MessageRow | undefined;
  if (!row) {
    throw new Error("Message not found");
  }
  return toMessage(row);
}

export function createMessage(
  conversationId: string,
  role: Role,
  content: string,
  status = "success",
  meta: {
    agentId?: string;
    agentName?: string;
    parentMessageId?: string;
    messageType?: "normal" | "agent";
    attachments?: MessageAttachment[];
  } = {},
): Message {
  const id = randomUUID();
  const at = nowIso();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages(id, conversationId, role, content, compressed, createdAt, status, agentId, agentName, parentMessageId, attachments, messageType)
       VALUES(?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      conversationId,
      role,
      content,
      at,
      status,
      meta.agentId ?? "",
      meta.agentName ?? "",
      meta.parentMessageId ?? "",
      stringifyAttachments(meta.attachments),
      meta.messageType ?? "normal",
    );
    db.prepare("UPDATE conversations SET updatedAt = ? WHERE id = ?").run(at, conversationId);
  });
  tx();
  return getMessage(id);
}

export function updateMessageContent(id: string, content: string): Message {
  getDb().prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
  return getMessage(id);
}

export function updateMessageStatus(id: string, status: "sending" | "success" | "error", content?: string): Message {
  if (content === undefined) {
    getDb().prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, id);
  } else {
    getDb().prepare("UPDATE messages SET status = ?, content = ? WHERE id = ?").run(status, content, id);
  }
  return getMessage(id);
}

export function markMessagesCompressed(ids: string[]): number {
  if (!ids.length) {
    return 0;
  }
  const stmt = getDb().prepare("UPDATE messages SET compressed = 1 WHERE id = ?");
  const tx = getDb().transaction((messageIds: string[]) => {
    let updated = 0;
    for (const id of messageIds) {
      updated += stmt.run(id).changes;
    }
    return updated;
  });
  return tx(ids) as number;
}

export function searchMessages(query: string, conversationId?: string | null): MessageSearchResult[] {
  const keyword = query.trim();
  if (!keyword) {
    return [];
  }
  const like = `%${keyword.replace(/[%_]/g, (char) => `\\${char}`)}%`;
  const baseSql = `
    SELECT
      m.id,
      m.conversationId,
      c.title AS conversationTitle,
      m.role,
      m.content,
      m.compressed,
      m.createdAt,
      m.status
      , m.agentId, m.agentName, m.parentMessageId, m.attachments, m.messageType
    FROM messages m
    JOIN conversations c ON c.id = m.conversationId
    WHERE m.content LIKE ? ESCAPE '\\'
      ${conversationId ? "AND m.conversationId = ?" : ""}
    ORDER BY m.createdAt DESC
    LIMIT 80
  `;
  const rows = conversationId
    ? getDb().prepare(baseSql).all(like, conversationId)
    : getDb().prepare(baseSql).all(like);
  return (rows as Array<Omit<MessageSearchResult, "compressed" | "attachments"> & { compressed: number; attachments?: string }>).map((row) => ({
    ...row,
    compressed: Boolean(row.compressed),
    attachments: parseAttachments(row.attachments),
  }));
}
