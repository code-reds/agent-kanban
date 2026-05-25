import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { validateToken } from '../mcp/auth.js';
import { getDb } from '../db/database.js';

// Helper to set up test database with api_tokens table
function setupTestDb() {
  const db = getDb();

  // Ensure projects table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Ensure roles table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT ''
    );
  `);

  // Ensure project_roles table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_roles (
      project_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (project_id, role_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
  `);

  // Create api_tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_project ON api_tokens(project_id);
  `);
}

// Helper to create a test project and tokens
function createTestProject(
  slug: string,
  roleId: number,
  expiresAt: string | null = null,
  isActive: number = 1
) {
  const db = getDb();
  
  // Get the next project ID
  const nextId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
  const projectId = nextId.next_id;
  
  // Insert project
  db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(projectId, slug, slug);
  
  // Insert role
  db.prepare('INSERT INTO roles (id, name) VALUES (?, ?)').run(roleId, `test-role-${roleId}`);
  
  // Link role to project
  db.prepare('INSERT INTO project_roles (project_id, role_id) VALUES (?, ?)').run(projectId, roleId);
  
  // Insert token (use SHA-256 of the token string)
  const tokenHash = crypto.createHash('sha256').update(slug).digest('hex');
  
  db.prepare(`
    INSERT INTO api_tokens (token_hash, project_id, role_id, description, expires_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tokenHash, projectId, roleId, 'test token', expiresAt, isActive);
  
  return { projectId, roleId, token: slug };
}

describe('MCP Auth', () => {
  beforeAll(() => {
    setupTestDb();
  });

  it('validates a valid token', () => {
    const { projectId, roleId, token } = createTestProject('mcp-test-project', 10);
    
    const result = validateToken(token);
    
    expect(result.projectId).toBe(projectId);
    expect(result.roleId).toBe(roleId);
    expect(result.projectSlug).toBe('mcp-test-project');
  });

  it('throws for an invalid token', () => {
    const db = getDb();
    const hash = crypto.createHash('sha256').update('invalid-token').digest('hex');
    db.prepare('DELETE FROM api_tokens WHERE token_hash = ?').run(hash);
    
    expect(() => validateToken('invalid-token')).toThrow('Invalid or expired access token');
  });

  it('throws for an expired token', () => {
    createTestProject('expired-token', 11, '2020-01-01 00:00:00');
    
    expect(() => validateToken('expired-token')).toThrow('Invalid or expired access token');
  });

  it('throws for an inactive token', () => {
    createTestProject('inactive-token', 12, null, 0);
    
    expect(() => validateToken('inactive-token')).toThrow('Invalid or expired access token');
  });

  it('throws for a non-existent project', () => {
    const db = getDb();
    
    // Create token with non-existent project ID (enable foreign keys check)
    db.exec('PRAGMA foreign_keys = ON');
    
    // This should fail due to foreign key constraint
    expect(() => {
      const tokenHash = crypto.createHash('sha256').update('orphan-token').digest('hex');
      db.prepare('INSERT INTO roles (id, name) VALUES (?, ?)').run(99, 'orphan-role');
      db.prepare(`
        INSERT INTO api_tokens (token_hash, project_id, role_id, is_active)
        VALUES (?, 9999, 99, 1)
      `).run(tokenHash);
    }).toThrow();
  });
});

describe('MCP Session', () => {
  it('creates a session with all required properties', async () => {
    const { McpSession } = await import('../mcp/session.js');
    const session = new McpSession(1, 1, 'test-project', { id: 1, name: 'test-role' });
    
    expect(session.projectId).toBe(1);
    expect(session.roleId).toBe(1);
    expect(session.projectSlug).toBe('test-project');
    expect(session.role.id).toBe(1);
    expect(session.role.name).toBe('test-role');
    expect(session.sessionId).toBeDefined();
    expect(session.permissionChecker).toBeDefined();
  });

  it('generates a unique session ID for each session', async () => {
    const { McpSession } = await import('../mcp/session.js');
    const session1 = new McpSession(1, 1, 'test-project', { id: 1, name: 'test-role' });
    const session2 = new McpSession(1, 1, 'test-project', { id: 1, name: 'test-role' });
    
    expect(session1.sessionId).not.toBe(session2.sessionId);
  });

  it('creates a permission checker for the project and role', async () => {
    const { McpSession } = await import('../mcp/session.js');
    const session = new McpSession(1, 1, 'test-project', { id: 1, name: 'test-role' });
    
    const pc = session.permissionChecker;
    expect(pc).toBeDefined();
    expect(pc.checkPermission('list_tickets')).toEqual({ allowed: true });
  });
});
