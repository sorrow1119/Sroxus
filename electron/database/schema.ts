import type Database from "better-sqlite3";

export function migrate(db: Database.Database) {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      systemPrompt TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      compressed INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      status TEXT DEFAULT 'success' CHECK(status IN ('sending', 'success', 'error')),
      agentId TEXT DEFAULT '',
      agentName TEXT DEFAULT '',
      parentMessageId TEXT DEFAULT '',
      attachments TEXT DEFAULT '[]',
      messageType TEXT DEFAULT 'normal',
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversationId, createdAt);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      baseUrl TEXT NOT NULL,
      apiKey TEXT NOT NULL,
      model TEXT NOT NULL,
      enabledModels TEXT DEFAULT '[]',
      temperature REAL DEFAULT 0.7,
      maxTokens INTEGER DEFAULT 4096,
      stream INTEGER DEFAULT 1,
      endpointType TEXT DEFAULT 'chat_completions',
      autoAppendPath INTEGER DEFAULT 0,
      endpointPathMode TEXT DEFAULT 'exact',
      isDefault INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_providers_default
      ON providers(isDefault);

    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      providerId TEXT DEFAULT '',
      model TEXT DEFAULT '',
      systemPrompt TEXT DEFAULT '',
      rolePreset TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      isPrimary INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_agents_enabled
      ON ai_agents(enabled);

    CREATE INDEX IF NOT EXISTS idx_ai_agents_primary
      ON ai_agents(isPrimary);
  `);

  ensureColumn(db, "providers", "endpointType", "TEXT DEFAULT 'chat_completions'");
  ensureColumn(db, "providers", "autoAppendPath", "INTEGER DEFAULT 0");
  ensureColumn(db, "providers", "endpointPathMode", "TEXT DEFAULT 'exact'");
  ensureColumn(db, "providers", "enabledModels", "TEXT DEFAULT '[]'");
  ensureColumn(db, "messages", "agentId", "TEXT DEFAULT ''");
  ensureColumn(db, "messages", "agentName", "TEXT DEFAULT ''");
  ensureColumn(db, "messages", "parentMessageId", "TEXT DEFAULT ''");
  ensureColumn(db, "messages", "attachments", "TEXT DEFAULT '[]'");
  ensureColumn(db, "messages", "messageType", "TEXT DEFAULT 'normal'");
  ensureColumn(db, "ai_agents", "description", "TEXT DEFAULT ''");
  ensureColumn(db, "ai_agents", "providerId", "TEXT DEFAULT ''");
  ensureColumn(db, "ai_agents", "model", "TEXT DEFAULT ''");
  ensureColumn(db, "ai_agents", "systemPrompt", "TEXT DEFAULT ''");
  ensureColumn(db, "ai_agents", "rolePreset", "TEXT DEFAULT ''");
  ensureColumn(db, "ai_agents", "enabled", "INTEGER DEFAULT 1");
  ensureColumn(db, "ai_agents", "isPrimary", "INTEGER DEFAULT 0");
  ensureColumn(db, "ai_agents", "updatedAt", "TEXT DEFAULT ''");
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
