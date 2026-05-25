import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import {
  seedDefaultRoles,
  seedGlobalDefaults,
  seedProjectColumns,
  seedRoleColumnMappings,
  seedRoleColumnMappingsForAllProjects,
  seedGlobalRoleColumnMapping,
} from '../db/seed.js';
import {
  reassignTicketsToRole,
  revokeTokensByRole,
  removeAccessRulesByRole,
} from '../db/queries/projects.js';
import { checkOrphanedRoleReferences } from '../__tests__/utils/cleanup-helpers.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
  seedGlobalDefaults();
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-migration');
  const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-migration') as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
}

// =========================================================================
// Migration 008 — Idempotency Tests
// =========================================================================

describe('Migration 008 — Role Management', () => {
  beforeEach(() => {
    initDb();
  });

  it('should be idempotent — running migrations twice does not fail', () => {
    // Migration was already applied in initDb via runMigrations()
    // Running again should not error
    runMigrations();
    expect(true).toBe(true);
  });

  it('should create indexes for orphaned role reference checks', () => {
    const db = getDb();

    // Verify indexes exist by querying sqlite_master
    const indexes = [
      'idx_api_tokens_role_id',
      'idx_ticket_access_rules_role_id',
      'idx_tickets_created_by_role_id',
    ];

    for (const idx of indexes) {
      const exists = db.prepare<[string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get(idx);
      expect(exists).toBeDefined();
    }
  });
});

// =========================================================================
// reassignTicketsToRole Tests
// =========================================================================

describe('reassignTicketsToRole', () => {
  beforeEach(() => {
    initDb();
  });

  it('should update created_by_role_id on tickets', () => {
    const db = getDb();

    // Create tickets with different created_by_role_id values
    const todoCol = db.prepare<[number, string], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(1, 'todo')!;

    db.prepare(
      'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, todoCol.id, 'Ticket A', '[]', 2, 2);
    db.prepare(
      'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, todoCol.id, 'Ticket B', '[]', 3, 3);
    db.prepare(
      'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, todoCol.id, 'Ticket C', '[]', 4, 2);

    // Verify initial state
    let count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM tickets WHERE created_by_role_id = ?'
    ).get(2) as { c: number };
    expect(count.c).toBe(2);

    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM tickets WHERE created_by_role_id = ?'
    ).get(3) as { c: number };
    expect(count.c).toBe(1);

    // Reassign from role 2 to role 3
    const reassigned = reassignTicketsToRole(2, 3);

    expect(reassigned).toBe(2);

    // Verify after reassignment
    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM tickets WHERE created_by_role_id = ?'
    ).get(3) as { c: number };
    expect(count.c).toBe(3);

    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM tickets WHERE created_by_role_id = ?'
    ).get(2) as { c: number };
    expect(count.c).toBe(0);
  });

  it('should return 0 when no tickets match old role', () => {
    const result = reassignTicketsToRole(99, 1);
    expect(result).toBe(0);
  });

  it('should handle reassigning from non-existent role', () => {
    const result = reassignTicketsToRole(99, 1);
    expect(result).toBe(0);
  });
});

// =========================================================================
// revokeTokensByRole Tests
// =========================================================================

describe('revokeTokensByRole', () => {
  beforeEach(() => {
    initDb();
  });

  it('should delete all api_tokens for a given role', () => {
    const db = getDb();
    const todoCol = db.prepare<[number, string], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(1, 'todo')!;

    // Create some api_tokens for role 2 and role 3
    db.prepare(
      'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
    ).run('hash1', 1, 2, 'Token for role 2');
    db.prepare(
      'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
    ).run('hash2', 1, 2, 'Token 2 for role 2');
    db.prepare(
      'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
    ).run('hash3', 1, 3, 'Token for role 3');

    // Verify initial count
    let count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
    ).get(2) as { c: number };
    expect(count.c).toBe(2);

    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
    ).get(3) as { c: number };
    expect(count.c).toBe(1);

    // Revoke tokens for role 2
    const revoked = revokeTokensByRole(2);
    expect(revoked).toBe(2);

    // Verify
    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
    ).get(2) as { c: number };
    expect(count.c).toBe(0);

    // Role 3 tokens should remain
    count = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
    ).get(3) as { c: number };
    expect(count.c).toBe(1);
  });

  it('should return 0 when no tokens exist for role', () => {
    const result = revokeTokensByRole(99);
    expect(result).toBe(0);
  });
});

// =========================================================================
// removeAccessRulesByRole Tests
// =========================================================================

describe('removeAccessRulesByRole', () => {
  beforeEach(() => {
    initDb();
  });

  it('should delete all access rules for a given role', () => {
    const db = getDb();

    // Verify initial state
    const countRole2 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
    ).get(2) as { c: number };

    const countRole3 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
    ).get(3) as { c: number };

    // Remove access rules for role 2
    const removed = removeAccessRulesByRole(2);
    expect(removed).toBe(countRole2.c);

    // Verify
    const remainingRole2 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
    ).get(2) as { c: number };
    expect(remainingRole2.c).toBe(0);

    // Role 3 rules should remain
    const remainingRole3 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
    ).get(3) as { c: number };
    expect(remainingRole3.c).toBe(countRole3.c);
  });

  it('should return 0 when no access rules exist for role', () => {
    const result = removeAccessRulesByRole(99);
    expect(result).toBe(0);
  });
});

// =========================================================================
// checkOrphanedRoleReferences Tests
// =========================================================================

describe('checkOrphanedRoleReferences', () => {
  beforeEach(() => {
    initDb();
  });

  it('should return zero orphans in a clean database', () => {
    const orphans = checkOrphanedRoleReferences();
    expect(orphans.api_tokens).toBe(0);
    expect(orphans.ticket_access_rules).toBe(0);
    expect(orphans.tickets).toBe(0);
  });

  it('should detect orphaned api_tokens', () => {
    const db = getDb();
    // Disable FK for this test to insert orphan records
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(
      'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
    ).run('orphan-hash', 1, 999, 'Orphaned token');
    db.exec('PRAGMA foreign_keys = ON');

    const orphans = checkOrphanedRoleReferences();
    expect(orphans.api_tokens).toBe(1);
  });

  it('should detect orphaned ticket_access_rules', () => {
    const db = getDb();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
    ).run(1, 1, 999, 'create');
    db.exec('PRAGMA foreign_keys = ON');

    const orphans = checkOrphanedRoleReferences();
    expect(orphans.ticket_access_rules).toBe(1);
  });

  it('should detect orphaned tickets.created_by_role_id', () => {
    const db = getDb();
    const todoCol = db.prepare<[number, string], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(1, 'todo')!;
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(
      'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, todoCol.id, 'Orphan ticket', '[]', 2, 999);
    db.exec('PRAGMA foreign_keys = ON');

    const orphans = checkOrphanedRoleReferences();
    expect(orphans.tickets).toBe(1);
  });

  it('should detect multiple types of orphans at once', () => {
    const db = getDb();
    const todoCol = db.prepare<[number, string], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(1, 'todo')!;

    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(
      'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
    ).run('orphan-1', 1, 999, 'Orphan token');

    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
    ).run(1, 1, 998, 'create');

    db.prepare(
      'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, todoCol.id, 'Orphan ticket', '[]', 2, 997);
    db.exec('PRAGMA foreign_keys = ON');

    const orphans = checkOrphanedRoleReferences();
    expect(orphans.api_tokens).toBe(1);
    expect(orphans.ticket_access_rules).toBe(1);
    expect(orphans.tickets).toBe(1);
  });
});

// =========================================================================
// seedRoleColumnMappings Tests
// =========================================================================

describe('seedRoleColumnMappings', () => {
  beforeEach(() => {
    initDb();
  });

  it('should create a roles_columns entry for a role in a project', () => {
    const db = getDb();

    // Get a role that doesn't have explicit mappings yet
    const existingMappings = db.prepare<[number]>(
      'SELECT role_id FROM roles_columns WHERE project_id = ?'
    ).all(1) as { role_id: number }[];
    const existingRoleIds = new Set(existingMappings.map((m) => m.role_id));

    // Find a role without a mapping
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();
    const roleToTest = allRoles.find((r) => !existingRoleIds.has(r.id));

    if (roleToTest) {
      seedRoleColumnMappings(roleToTest.id, 1, 2);

      const entry = db.prepare<[number, number], { column_id: number | null }>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roleToTest.id, 1);
      expect(entry).toBeDefined();
      expect(entry!.column_id).toBe(2);
    }
  });

  it('should be idempotent — calling twice does not create duplicates', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    // Pick the first role
    const roleId = allRoles[0].id;

    seedRoleColumnMappings(roleId, 1, 2);

    const count1 = db.prepare<[number, number]>(
      'SELECT COUNT(*) as c FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(roleId, 1) as { c: number };

    seedRoleColumnMappings(roleId, 1, 2);

    const count2 = db.prepare<[number, number]>(
      'SELECT COUNT(*) as c FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(roleId, 1) as { c: number };

    expect(count1.c).toBe(1);
    expect(count2.c).toBe(1);
  });

  it('should update column_id if it differs from existing mapping', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    const roleId = allRoles[0].id;

    // Set initial column_id — use prepared statement since exec doesn't support params
    db.prepare<[number, number, number]>(
      'INSERT OR REPLACE INTO roles_columns (role_id, project_id, column_id) VALUES (?, ?, ?)'
    ).run(roleId, 1, 2);

    seedRoleColumnMappings(roleId, 1, 3);

    const entry = db.prepare<[number, number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(roleId, 1);
    expect(entry!.column_id).toBe(3);
  });

  it('should handle NULL column_id for unrestricted access', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    // Pick a role without a mapping
    const existingMappings = db.prepare<[number]>(
      'SELECT role_id FROM roles_columns WHERE project_id = ?'
    ).all(1) as { role_id: number }[];
    const existingRoleIds = new Set(existingMappings.map((m) => m.role_id));

    const roleToTest = allRoles.find((r) => !existingRoleIds.has(r.id));

    if (roleToTest) {
      seedRoleColumnMappings(roleToTest.id, 1, null);

      const entry = db.prepare<[number, number], { column_id: number | null }>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roleToTest.id, 1);
      expect(entry!.column_id).toBeNull();
    }
  });
});

// =========================================================================
// seedRoleColumnMappingsForAllProjects Tests
// =========================================================================

describe('seedRoleColumnMappingsForAllProjects', () => {
  beforeEach(() => {
    initDb();
  });

  it('should create mappings for a role across all projects', () => {
    const db = getDb();

    // Create a second project
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test2', 'test2');

    // Create columns for the second project
    const columns = [
      { slug: 'todo', name: 'To Do', order: 0 },
      { slug: 'implementation', name: 'Implementation', order: 1 },
      { slug: 'unit_review', name: 'Unit Review', order: 2 },
      { slug: 'integration_testing', name: 'Integration Testing', order: 3 },
      { slug: 'final_review', name: 'Final Review', order: 4 },
      { slug: 'done', name: 'Done', order: 5 },
      { slug: 'human_feedback', name: 'Human Feedback', order: 6 },
    ];
    for (const col of columns) {
      const existing = db.prepare<[number, string]>(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(2, col.slug);
      if (!existing) {
        db.prepare(
          'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
        ).run(2, col.slug, col.name, col.order, 1);
      }
    }

    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    const roleId = allRoles[0].id;

    seedRoleColumnMappingsForAllProjects(roleId, 2);

    // Verify mappings exist in both projects
    for (const projectId of [1, 2]) {
      const entry = db.prepare<[number, number], { column_id: number | null }>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roleId, projectId);
      expect(entry).toBeDefined();
      expect(entry!.column_id).toBe(2);
    }
  });
});

// =========================================================================
// seedGlobalRoleColumnMapping Tests
// =========================================================================

describe('seedGlobalRoleColumnMapping', () => {
  beforeEach(() => {
    initDb();
  });

  it('should create a global roles_columns entry', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    const roleId = allRoles[0].id;

    seedGlobalRoleColumnMapping(roleId, 2);

    const entry = db.prepare<[number]>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
    ).get(roleId) as { column_id: number | null } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.column_id).toBe(2);
  });

  it('should be idempotent — calling twice does not duplicate', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    const roleId = allRoles[0].id;

    seedGlobalRoleColumnMapping(roleId, 2);

    const count1 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
    ).get(roleId) as { c: number };

    seedGlobalRoleColumnMapping(roleId, 2);

    const count2 = db.prepare<[number]>(
      'SELECT COUNT(*) as c FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
    ).get(roleId) as { c: number };

    expect(count1.c).toBe(1);
    expect(count2.c).toBe(1);
  });

  it('should handle NULL column_id for unrestricted access', () => {
    const db = getDb();
    const allRoles = db.prepare<[], { id: number }>(
      'SELECT id FROM roles'
    ).all();

    // Pick a role that doesn't have a global mapping yet
    const existingGlobal = db.prepare<[], { role_id: number }>(
      'SELECT role_id FROM roles_columns WHERE project_id IS NULL'
    ).all();
    const existingRoleIds = new Set(existingGlobal.map((r) => r.role_id));

    const roleToTest = allRoles.find((r) => !existingRoleIds.has(r.id));

    if (roleToTest) {
      seedGlobalRoleColumnMapping(roleToTest.id, null);

      const entry = db.prepare<[number]>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
      ).get(roleToTest.id) as { column_id: number | null } | undefined;
      expect(entry!.column_id).toBeNull();
    }
  });
});
