import { app } from "electron";
import type { AppSettings } from "../../shared/types";
import { getDb } from "./index";

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getAllSettings(): AppSettings {
  const rows = getDb().prepare("SELECT key, value FROM settings ORDER BY key ASC").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function getAppVersion() {
  return app.getVersion();
}
