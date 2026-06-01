import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../../data/novel_analyzer.db');

const PERSIST_DEBOUNCE_MS = 500;
const PERSIST_MAX_BATCH = 5;

let db: Database;
let dbInitPromise: Promise<Database> | null = null;
let dirty = false;
let persistTimer: NodeJS.Timeout | null = null;
let persistInProgress: Promise<void> | null = null;
let pendingDirtyCount = 0;
let transactionDepth = 0;

export async function getDb(): Promise<Database> {
  if (db) return db;

  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const SQL = await initSqlJs({
        locateFile: (file: string) => {
          const sqlJsPath = require.resolve('sql.js');
          return path.join(path.dirname(sqlJsPath), file);
        },
      });

      const dataDir = path.dirname(DB_PATH);
      await fs.mkdir(dataDir, { recursive: true });

      try {
        const buffer = await fs.readFile(DB_PATH);
        db = new SQL.Database(new Uint8Array(buffer));
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
        db = new SQL.Database();
      }

      db.run('PRAGMA foreign_keys = ON');
      await initSchema();
      return db;
    })();
  }

  return dbInitPromise;
}

async function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      file_path TEXT NOT NULL UNIQUE,
      file_type TEXT NOT NULL,
      content_summary TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      folder_source TEXT,
      file_mtime INTEGER,
      file_size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL UNIQUE,
      theme TEXT,
      plot TEXT,
      characters TEXT,
      writing_style TEXT,
      emotion TEXT,
      atmosphere TEXT,
      literary_value TEXT,
      narrative_technique TEXT,
      symbolism TEXT,
      overall_summary TEXT,
      raw_response TEXT,
      model_used TEXT,
      chunk_size INTEGER DEFAULT 200000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunk_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      analysis_result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL UNIQUE,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL UNIQUE,
      category TEXT NOT NULL,
      reason TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS llm_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'openai',
      api_key TEXT,
      base_url TEXT,
      model TEXT NOT NULL DEFAULT 'gpt-4o',
      chunk_size INTEGER DEFAULT 200000,
      overlap_ratio REAL DEFAULT 0.1,
      rpm_limit INTEGER DEFAULT 0,
      timeout INTEGER DEFAULT 300,
      max_tokens INTEGER,
      prompt_analyze TEXT DEFAULT '',
      prompt_merge TEXT DEFAULT '',
      prompt_recommend TEXT DEFAULT '',
      folder_a TEXT,
      folder_b TEXT,
      auto_scan INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS batch_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'analyze',
      status TEXT NOT NULL DEFAULT 'idle',
      total INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      current TEXT DEFAULT '',
      novel_ids TEXT DEFAULT '[]',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_novels_status ON novels(status);
    CREATE INDEX IF NOT EXISTS idx_novels_folder ON novels(folder_source);
    CREATE INDEX IF NOT EXISTS idx_novels_created ON novels(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chunk_novel ON chunk_analyses(novel_id);
    CREATE INDEX IF NOT EXISTS idx_recommendations_category ON recommendations(category);
    CREATE INDEX IF NOT EXISTS idx_llm_configs_active ON llm_configs(is_active);
  `);

  migrateSchema();

  db.run(`CREATE INDEX IF NOT EXISTS idx_batch_jobs_status_type ON batch_jobs(status, type)`);
}

function migrateSchema() {
  const llmInfo = db.exec("PRAGMA table_info(llm_configs)");
  if (llmInfo.length > 0) {
    const columns = llmInfo[0].values.map(row => row[1]);
    if (!columns.includes('name')) db.run("ALTER TABLE llm_configs ADD COLUMN name TEXT DEFAULT ''");
    if (!columns.includes('rpm_limit')) db.run('ALTER TABLE llm_configs ADD COLUMN rpm_limit INTEGER DEFAULT 0');
    if (!columns.includes('timeout')) db.run('ALTER TABLE llm_configs ADD COLUMN timeout INTEGER DEFAULT 300');
    if (!columns.includes('max_tokens')) db.run('ALTER TABLE llm_configs ADD COLUMN max_tokens INTEGER');
  }

  const novelInfo = db.exec("PRAGMA table_info(novels)");
  if (novelInfo.length > 0) {
    const columns = novelInfo[0].values.map(row => row[1]);
    if (!columns.includes('file_mtime')) db.run('ALTER TABLE novels ADD COLUMN file_mtime INTEGER');
    if (!columns.includes('file_size')) db.run('ALTER TABLE novels ADD COLUMN file_size INTEGER');
  }

  const chunkInfo = db.exec("PRAGMA table_info(chunk_analyses)");
  if (chunkInfo.length > 0) {
    const columns = chunkInfo[0].values.map(row => row[1]);
    if (columns.includes('chunk_content')) {
      db.run('ALTER TABLE chunk_analyses DROP COLUMN chunk_content');
    }
  }

  const batchInfo = db.exec("PRAGMA table_info(batch_jobs)");
  if (batchInfo.length > 0) {
    const columns = batchInfo[0].values.map(row => row[1]);
    if (!columns.includes('type')) db.run("ALTER TABLE batch_jobs ADD COLUMN type TEXT NOT NULL DEFAULT 'analyze'");
  }
}

async function writeToDiskAsync(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const tmpPath = DB_PATH + '.tmp';
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, DB_PATH);
  dirty = false;
  pendingDirtyCount = 0;
}

export function saveDb() {
  dirty = true;
  pendingDirtyCount++;
  if (transactionDepth > 0) return;
  scheduleFlush();
}

function scheduleFlush() {
  if (persistTimer) return;
  const delay = pendingDirtyCount >= PERSIST_MAX_BATCH ? 0 : PERSIST_DEBOUNCE_MS;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushNow().catch(err => console.error('[DB] 持久化失败:', err));
  }, delay);
}

async function flushNow(): Promise<void> {
  if (!dirty) return;
  if (persistInProgress) {
    await persistInProgress;
    if (!dirty) return;
  }
  persistInProgress = writeToDiskAsync().finally(() => {
    persistInProgress = null;
  });
  await persistInProgress;
}

export async function flushDb(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await flushNow();
}

export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  await getDb();
  const isOuter = transactionDepth === 0;
  if (isOuter) db.run('BEGIN');
  transactionDepth++;
  try {
    const result = await fn();
    transactionDepth--;
    if (isOuter) {
      db.run('COMMIT');
      saveDb();
    }
    return result;
  } catch (err) {
    transactionDepth--;
    if (isOuter) {
      try { db.run('ROLLBACK'); } catch (e) { console.error('[DB] ROLLBACK 失败:', e); }
    }
    throw err;
  }
}

export async function closeDb() {
  if (db) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      await writeToDiskAsync();
    } catch (err) {
      console.error('[DB] 关闭时持久化失败:', err);
    }
    db.close();
  }
}
