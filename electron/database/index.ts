import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { DEFAULT_DATA_DIR_NAME } from "../../shared/constants";
import { migrate } from "./schema";

let db: Database.Database | null = null;

export function defaultDataDir() {
  return path.join(app.getPath("userData"), DEFAULT_DATA_DIR_NAME);
}

export function storageConfigPath() {
  return path.join(app.getPath("userData"), "storage-config.json");
}

export function configuredDataDir() {
  try {
    const raw = fs.readFileSync(storageConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as { storagePath?: string };
    return parsed.storagePath || defaultDataDir();
  } catch {
    return defaultDataDir();
  }
}

export function writeConfiguredDataDir(dataDir: string) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(storageConfigPath(), JSON.stringify({ storagePath: dataDir }, null, 2), "utf-8");
}

export function initDatabase(dataDir = configuredDataDir()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "data.db");
  db = new Database(dbPath);
  migrate(db);
  return db;
}

export function getDb() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export function reconnectDatabase(dataDir: string) {
  closeDatabase();
  return initDatabase(dataDir);
}
