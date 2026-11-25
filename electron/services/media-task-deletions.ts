import { getDb } from "../database";

type MediaKind = "image" | "video";
function database() {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS media_task_deletions (kind TEXT NOT NULL, id TEXT NOT NULL, deletedAt TEXT NOT NULL, PRIMARY KEY(kind,id))");
  return db;
}
export function isMediaTaskDeleted(kind: MediaKind, id: string) {
  return Boolean(database().prepare("SELECT 1 FROM media_task_deletions WHERE kind=? AND id=?").get(kind, id));
}
export function markMediaTaskDeleted(kind: MediaKind, id: string) {
  if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid media task ID");
  database().prepare("INSERT OR IGNORE INTO media_task_deletions(kind,id,deletedAt) VALUES(?,?,?)").run(kind, id, new Date().toISOString());
}
