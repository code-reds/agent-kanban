import { getDb } from '../db/database.js';
import { ensureApiTokensTable as ensureApiTokensTableUtil, generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../utils/auth-utils.js';

export interface TokenValidation {
  projectId: number;
  roleId: number;
  projectSlug: string;
}

/**
 * Ensure the api_tokens table exists with all required columns.
 * Idempotent — safe to call multiple times.
 */
function ensureApiTokensTable(): void {
  const db = getDb();
  ensureApiTokensTableUtil(db);
}

/**
 * Validate an access token against the api_tokens table.
 * Returns project/role info if valid, throws on failure.
 */
function validateTokenInternal(token: string): TokenValidation {
  ensureApiTokensTable();

  const tokenHash = hashTokenUtil(token);

  const db = getDb();
  const row = db.prepare(`
    SELECT at.project_id, at.role_id, p.slug as project_slug
    FROM api_tokens at
    JOIN projects p ON at.project_id = p.id
    WHERE at.token_hash = ?
      AND at.is_active = 1
      AND (at.expires_at IS NULL OR at.expires_at > datetime('now'))
  `).get(tokenHash) as { project_id: number; role_id: number; project_slug: string } | undefined;

  if (!row) {
    throw new Error('Invalid or expired access token');
  }

  return {
    projectId: row.project_id,
    roleId: row.role_id,
    projectSlug: row.project_slug,
  };
}

/**
 * Hash a token using SHA-256.
 * Re-exported from utils/auth-utils for backward compatibility.
 */
export function hashToken(token: string): string {
  return hashTokenUtil(token);
}

/**
 * Generate a random token.
 * Re-exported from utils/auth-utils for backward compatibility.
 */
export function generateToken(): string {
  return generateTokenUtil();
}

/**
 * Validate an access token against the api_tokens table.
 * Returns project/role info if valid, throws on failure.
 */
export const AuthService = {
  validateToken: validateTokenInternal,
  hashToken,
  generateToken,
};
