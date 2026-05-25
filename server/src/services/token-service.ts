import { getDb } from '../db/database.js';
import { ensureApiTokensTable as ensureApiTokensTableUtil, generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../utils/auth-utils.js';

/**
 * Ensure the api_tokens table exists with all required columns.
 * Idempotent — safe to call multiple times.
 */
function ensureApiTokensTable(): void {
  const db = getDb();
  ensureApiTokensTableUtil(db);
}

interface TokenRow {
  id: number;
  token_hash: string;
  project_id: number;
  role_id: number;
  role_name: string;
  description: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: number;
}

interface TokenWithSecret {
  id: number;
  project_id: number;
  role_id: number;
  token_value: string;
}

interface RoleRow {
  id: number;
  name: string;
}

export interface TokenListResult {
  id: number;
  project_id: number;
  role_id: number;
  role_name: string;
  description: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  token_prefix: string;
}

export interface TokenCreateResult {
  id: number;
  token: string;
  token_hash_prefix: string;
  project_id: number;
  role_id: number;
  role_name: string;
  description: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export interface TokenRevokeResult {
  revoked: boolean;
  id: number;
}

export interface TokenSecretResult {
  id: number;
  role_id: number;
  role_name: string;
  token: string;
  token_prefix: string;
}

/**
 * Shared token service that orchestrates token CRUD operations.
 * Used by both REST API and MCP tools.
 */
export class TokenService {
  /**
   * List all tokens for a project, enriched with role names.
   * Returns masked token prefixes.
   */
  static list(projectId: number): TokenListResult[] {
    const db = getDb();
    ensureApiTokensTable();

    const tokens = db.prepare<[number]>(`
      SELECT
        at.id,
        at.token_hash,
        at.project_id,
        at.role_id,
        r.name as role_name,
        at.description,
        at.created_at,
        at.expires_at,
        at.is_active
      FROM api_tokens at
      JOIN roles r ON at.role_id = r.id
      WHERE at.project_id = ?
      ORDER BY at.created_at DESC
    `).all(projectId) as TokenRow[];

    return tokens.map((t) => ({
      id: t.id,
      project_id: t.project_id,
      role_id: t.role_id,
      role_name: t.role_name,
      description: t.description,
      created_at: t.created_at,
      expires_at: t.expires_at,
      is_active: t.is_active === 1,
      token_prefix: t.token_hash.slice(0, 8),
    }));
  }

  /**
   * Create a new access token.
   * Returns the plaintext token only once.
   */
  static create(
    projectId: number,
    roleId: number,
    description?: string,
    expiresIn?: number
  ): TokenCreateResult {
    const db = getDb();
    ensureApiTokensTable();

    // Verify role exists
    const role = db.prepare<[number], RoleRow>(
      'SELECT id, name FROM roles WHERE id = ?'
    ).get(roleId);

    if (!role) {
      throw new Error(`Role with id '${roleId}' not found`);
    }

    // Generate token and compute hash
    const plaintextToken = generateTokenUtil();
    const tokenHash = hashTokenUtil(plaintextToken);

    // Calculate expires_at
    let expiresAt: string | null = null;
    if (expiresIn) {
      const expiresMs = Number(expiresIn);
      if (!isNaN(expiresMs) && expiresMs > 0) {
        const expiresDate = new Date(Date.now() + expiresMs);
        expiresAt = expiresDate.toISOString();
      }
    }

    const result = db.prepare<[string, string, number, number, string | null, string | null]>(`
      INSERT INTO api_tokens (token_hash, token_value, project_id, role_id, description, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, plaintextToken, projectId, roleId, description || null, expiresAt);

    const tokenId = Number(result.lastInsertRowid);

    return {
      id: tokenId,
      token: plaintextToken,
      token_hash_prefix: plaintextToken.slice(0, 8) + '...',
      project_id: projectId,
      role_id: roleId,
      role_name: role.name,
      description: description || null,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      is_active: true,
    };
  }

  /**
   * Revoke a token (soft delete).
   */
  static revoke(tokenId: number, projectId: number): TokenRevokeResult {
    const db = getDb();
    ensureApiTokensTable();

    // Verify token exists and belongs to this project
    const token = db.prepare<[number]>(
      'SELECT id, project_id FROM api_tokens WHERE id = ?'
    ).get(tokenId) as { id: number; project_id: number } | undefined;

    if (!token) {
      throw new Error(`Token with id '${tokenId}' not found`);
    }

    if (token.project_id !== projectId) {
      throw new Error('Token does not belong to this project');
    }

    // Revoke the token (soft delete)
    db.prepare('UPDATE api_tokens SET is_active = 0 WHERE id = ?').run(tokenId);

    return { revoked: true, id: tokenId };
  }

  /**
   * Get the plaintext token for a token ID.
   * Only returns tokens that were generated after token_value storage was enabled.
   */
  static getSecret(tokenId: number, projectId: number): TokenSecretResult {
    const db = getDb();
    ensureApiTokensTable();

    // Find the token with its stored plaintext value
    const token = db.prepare<[number]>(
      'SELECT id, project_id, role_id, token_value FROM api_tokens WHERE id = ?'
    ).get(tokenId) as TokenWithSecret | undefined;

    if (!token) {
      throw new Error(`Token with id '${tokenId}' not found`);
    }

    if (token.project_id !== projectId) {
      throw new Error('Token does not belong to this project');
    }

    if (!token.token_value) {
      throw new Error('Token value not available (was generated before token_value storage was enabled)');
    }

    const role = db.prepare<[number], RoleRow>(
      'SELECT id, name FROM roles WHERE id = ?'
    ).get(token.role_id);

    return {
      id: tokenId,
      role_id: token.role_id,
      role_name: role?.name || 'Unknown',
      token: token.token_value,
      token_prefix: token.token_value.slice(0, 8) + '...',
    };
  }

  /**
   * Get all active agent roles with their tokens (for opencode config generation).
   * Returns role names, token IDs, and actual token values.
   */
  static getAgentTokens(projectId: number, humanUserRoleName: string): {
    role_name: string;
    token_id: number;
    token: string;
  }[] {
    const db = getDb();
    ensureApiTokensTable();

    const tokens = db.prepare<[number, string]>(`
      SELECT
        r.name as role_name,
        at.id as token_id,
        at.token_value
      FROM api_tokens at
      JOIN roles r ON at.role_id = r.id
      WHERE at.project_id = ? AND r.name != ? AND at.is_active = 1 AND at.token_value IS NOT NULL
      ORDER BY r.id
    `).all(projectId, humanUserRoleName) as { role_name: string; token_id: number; token_value: string | null }[];

    return tokens
      .filter(t => t.token_value !== null)
      .map(t => ({
        role_name: t.role_name,
        token_id: t.token_id,
        token: t.token_value!,
      }));
  }
}
