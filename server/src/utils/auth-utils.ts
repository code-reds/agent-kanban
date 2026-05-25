import crypto from 'crypto';

/**
 * Ensure the api_tokens table exists with all required columns.
 * Idempotent — safe to call multiple times.
 */
export function ensureApiTokensTable(db: unknown): void {
  const dbConn = db as {
    exec: (sql: string) => { changes: number };
    prepare: (sql: string) => { run: () => { changes: number } };
  };

  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      token_value TEXT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`);
  dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_project ON api_tokens(project_id)`);

  // Migrate: add token_value column if missing
  try {
    dbConn.prepare('ALTER TABLE api_tokens ADD COLUMN token_value TEXT').run();
  } catch {
    // Column already exists
  }
}

/**
 * Generate a random token (32 bytes, hex string).
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a token using SHA-256.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
