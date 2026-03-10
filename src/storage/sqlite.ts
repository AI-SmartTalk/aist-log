import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): Database.Database {
  mkdirSync(dirname(config.sqlitePath), { recursive: true });

  db = new Database(config.sqlitePath);

  // Performance tuning for high-write workloads
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64 MB cache
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name)
  );

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
    })();
    console.log(`[db] Applied migration: ${migration.name}`);
  }
}

const migrations = [
  {
    name: '001_initial',
    sql: `
      -- Request logs from Pino NDJSON files
      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        request_id TEXT,
        method TEXT,
        path TEXT,
        status_code INTEGER,
        duration_ms REAL,
        user_id TEXT,
        chat_model_id TEXT,
        organization_id TEXT,
        ip TEXT,
        message TEXT,
        error_message TEXT,
        error_stack TEXT,
        raw JSON NOT NULL,
        source TEXT DEFAULT 'default',
        ingested_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rl_timestamp ON request_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_rl_request_id ON request_logs(request_id);
      CREATE INDEX IF NOT EXISTS idx_rl_path ON request_logs(path);
      CREATE INDEX IF NOT EXISTS idx_rl_status ON request_logs(status_code);
      CREATE INDEX IF NOT EXISTS idx_rl_level ON request_logs(level);
      CREATE INDEX IF NOT EXISTS idx_rl_user ON request_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_rl_source ON request_logs(source);

      -- Audit logs from HTTP ingestion
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        log_type TEXT NOT NULL,
        status TEXT NOT NULL,
        details JSON,
        error_message TEXT,
        user_id TEXT,
        entity_id TEXT,
        source TEXT NOT NULL,
        ingested_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_al_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_al_type ON audit_logs(log_type);
      CREATE INDEX IF NOT EXISTS idx_al_status ON audit_logs(status);
      CREATE INDEX IF NOT EXISTS idx_al_source ON audit_logs(source);
      CREATE INDEX IF NOT EXISTS idx_al_user ON audit_logs(user_id);

      -- File offset tracking for incremental ingestion
      CREATE TABLE IF NOT EXISTS file_offsets (
        file_path TEXT PRIMARY KEY,
        byte_offset INTEGER NOT NULL DEFAULT 0,
        inode INTEGER,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '002_tags',
    sql: `
      -- Add tags column for generic key-value metadata (replaces entity_id)
      ALTER TABLE audit_logs ADD COLUMN tags JSON DEFAULT '{}';

      -- Migrate existing entity_id data into tags
      UPDATE audit_logs SET tags = json_object('entityId', entity_id) WHERE entity_id IS NOT NULL AND entity_id != '';

      -- Index for common tag lookups via json_extract
      CREATE INDEX IF NOT EXISTS idx_al_tags ON audit_logs(tags);
    `,
  },
  {
    name: '003_projects',
    sql: `
      -- Projects table: each project has its own API key for SDK ingestion
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now')),
        settings JSON DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_proj_api_key ON projects(api_key);
      CREATE INDEX IF NOT EXISTS idx_proj_slug ON projects(slug);

      -- Add project_id to audit_logs and request_logs
      ALTER TABLE audit_logs ADD COLUMN project_id TEXT REFERENCES projects(id);
      ALTER TABLE request_logs ADD COLUMN project_id TEXT REFERENCES projects(id);

      CREATE INDEX IF NOT EXISTS idx_al_project ON audit_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_rl_project ON request_logs(project_id);
    `,
  },
];

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
