import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../../data', 'agent-kanban.db');

let dbInstance: any = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    const useMemory = process.env.DB_PATH === ':memory:';
    const dbPath = process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? process.env.DB_PATH : DB_PATH;
    
    if (useMemory) {
      dbInstance = new Database(':memory:');
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('foreign_keys = ON');
      dbInstance.pragma('busy_timeout = 5000');
      dbInstance.exec('PRAGMA journal_mode=WAL');
    } else {
      ensureDataDir(dbPath);
      dbInstance = new Database(dbPath);
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('foreign_keys = ON');
      dbInstance.pragma('busy_timeout = 5000');
    }
  }
  return dbInstance;
}

function ensureDataDir(dirPath: string) {
  const dir = path.dirname(dirPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Reset the database to a clean state for testing.
 *
 * For in-memory databases (DB_PATH=':memory:'), simply closing the instance
 * discards all data — getDb() creates a fresh one on next call.
 *
 * For file-based databases, the function deletes the database file so the
 * next getDb() call creates a fresh file.
 */
export function resetDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  // For file-based databases, delete the file so getDb() creates a fresh one
  // on next call. When DB_PATH is ':memory:', this block is skipped.
  if (process.env.DB_PATH !== ':memory:' && fs.existsSync(DB_PATH)) {
    try {
      fs.unlinkSync(DB_PATH);
    } catch { /* ignore */ }
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
    ensureDataDir(DB_PATH);
  }
}

/**
 * Get a fallback role ID for operations where no role is specified.
 * Returns the first role from the database, or null if no roles exist.
 * This avoids hardcoding role IDs.
 */
export function getFallbackRoleId(): number | null {
  const db = getDb();
  const row = db.prepare('SELECT id FROM roles WHERE name = ? LIMIT 1').get('Human User') as { id: number } | undefined;
  if (row) return row.id;
  const anyRow = db.prepare('SELECT id FROM roles LIMIT 1').get() as { id: number } | undefined;
  return anyRow?.id ?? null;
}
