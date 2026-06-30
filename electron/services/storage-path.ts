import fs from "node:fs";
import path from "node:path";
import { configuredDataDir, getDb, reconnectDatabase, writeConfiguredDataDir } from "../database";
import { getSetting, setSetting } from "../database/settings";
import { copyAttachmentDirectory } from "./attachments";

export function normalizeStoragePath(input: string) {
  return input.trim();
}

export function getStoragePath() {
  return getSetting("storagePath") || configuredDataDir();
}

export function migrateStoragePath(newPathInput: string) {
  const oldPath = getStoragePath();
  const newPath = normalizeStoragePath(newPathInput);
  if (!newPath) {
    throw new Error("新路径不能为空。");
  }
  if (path.resolve(oldPath) === path.resolve(newPath)) {
    return { ok: true as const, path: oldPath };
  }

  fs.mkdirSync(newPath, { recursive: true });
  const oldDbPath = path.join(oldPath, "data.db");
  const newDbPath = path.join(newPath, "data.db");
  const backupPath = fs.existsSync(newDbPath) ? `${newDbPath}.bak-${Date.now()}` : null;

  try {
    if (backupPath) {
      fs.copyFileSync(newDbPath, backupPath);
    }
    if (fs.existsSync(oldDbPath)) {
      fs.copyFileSync(oldDbPath, newDbPath);
      copySidecarFiles(oldPath, newPath);
      copyAttachmentDirectory(oldPath, newPath);
    }
    setSetting("storagePath", newPath);
    writeConfiguredDataDir(newPath);
    reconnectDatabase(newPath);
    setSetting("storagePath", newPath);
    writeConfiguredDataDir(newPath);
    return { ok: true as const, path: newPath };
  } catch (error) {
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, newDbPath);
    }
    reconnectDatabase(oldPath);
    setSetting("storagePath", oldPath);
    writeConfiguredDataDir(oldPath);
    throw error;
  }
}

export function getDataStats() {
  const db = getDb();
  const storagePath = getStoragePath();
  const dbPath = path.join(storagePath, "data.db");
  const conversationCount = (db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count;
  const messageCount = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
  const dbSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  return { storagePath, conversationCount, messageCount, dbSizeBytes };
}

function copySidecarFiles(oldPath: string, newPath: string) {
  for (const suffix of ["-wal", "-shm"]) {
    const from = path.join(oldPath, `data.db${suffix}`);
    const to = path.join(newPath, `data.db${suffix}`);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, to);
    }
  }
}
