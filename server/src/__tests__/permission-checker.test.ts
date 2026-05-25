import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PermissionChecker } from '../permissions/permission-checker.js';
import { getDb, resetDb } from '../db/database.js';
import { startServer, stopServer } from '../server.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import { findFreePort } from './test-utils.js';

// Helper to set up test database with a project, columns, roles, workflow, and access rules
function setupTestDb(projectId: number) {
  const db = getDb();

  // Create project_roles if it doesn't exist (not in migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_roles (
      project_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (project_id, role_id)
    );
  `);

  // Insert project_roles entries (these are not in migrations)
  db.exec(`
    INSERT OR IGNORE INTO project_roles (project_id, role_id)
    SELECT ${projectId}, id FROM roles WHERE id BETWEEN 1 AND 7
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_access_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      column_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES kanban_columns(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      column_from INTEGER NOT NULL,
      column_to INTEGER NOT NULL,
      requires_comment INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (column_from) REFERENCES kanban_columns(id),
      FOREIGN KEY (column_to) REFERENCES kanban_columns(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transition_allowed_roles (
      transition_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (transition_id, role_id),
      FOREIGN KEY (transition_id) REFERENCES workflow_transitions(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
  `);

  // Insert roles (after removing 'AI code tester', IDs shift)
  const roleIds: Record<string, number> = {
    'Human User': 1,
    'AI teamleader': 2,
    'AI architect': 3,
    'AI code developer': 4,
    'AI code reviewer': 5,
    'AI integration tester': 6,
    'AI feature reviewer': 7,
  };

  for (const [name, id] of Object.entries(roleIds)) {
    db.prepare('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)').run(id, name);
    db.prepare('INSERT OR IGNORE INTO project_roles (project_id, role_id) VALUES (?, ?)').run(projectId, id);
  }

  // Insert columns
  const columns = [
    { slug: 'todo', name: 'To Do', order: 1 },
    { slug: 'implementation', name: 'Implementation', order: 2 },
    { slug: 'unit_review', name: 'Unit Review', order: 3 },
    { slug: 'integration_testing', name: 'Integration Testing', order: 4 },
    { slug: 'final_review', name: 'Final Review', order: 5 },
    { slug: 'done', name: 'Done', order: 6 },
  ];

  const columnIds: Record<string, number> = {};
  for (const col of columns) {
    const result = db.prepare(
      'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
    ).run(projectId, col.slug, col.name, col.order, 0);
    columnIds[col.slug] = result.lastInsertRowid as number;
  }

  // Insert access rules
  const rules = [
    // Human User (role 1) - full access
    { column_id: columnIds['todo'], role_id: 1, action_type: 'create' },
    { column_id: columnIds['todo'], role_id: 1, action_type: 'edit' },
    { column_id: columnIds['implementation'], role_id: 1, action_type: 'edit' },
    { column_id: columnIds['unit_review'], role_id: 1, action_type: 'edit' },
    { column_id: columnIds['integration_testing'], role_id: 1, action_type: 'edit' },
    { column_id: columnIds['final_review'], role_id: 1, action_type: 'edit' },
    { column_id: columnIds['todo'], role_id: 1, action_type: 'delete' },
    { column_id: columnIds['implementation'], role_id: 1, action_type: 'delete' },
    { column_id: columnIds['unit_review'], role_id: 1, action_type: 'delete' },
    { column_id: columnIds['integration_testing'], role_id: 1, action_type: 'delete' },
    { column_id: columnIds['final_review'], role_id: 1, action_type: 'delete' },
    { column_id: columnIds['todo'], role_id: 2, action_type: 'delete' },

    // AI teamleader (role 2) - can create in todo, edit all except integration
    { column_id: columnIds['todo'], role_id: 2, action_type: 'create' },
    { column_id: columnIds['todo'], role_id: 2, action_type: 'edit' },
    { column_id: columnIds['implementation'], role_id: 2, action_type: 'edit' },
    { column_id: columnIds['unit_review'], role_id: 2, action_type: 'edit' },
    { column_id: columnIds['final_review'], role_id: 2, action_type: 'edit' },

    // AI architect (role 3) - can create/edit in todo, edit implementation
    { column_id: columnIds['todo'], role_id: 3, action_type: 'create' },
    { column_id: columnIds['todo'], role_id: 3, action_type: 'edit' },
    { column_id: columnIds['implementation'], role_id: 3, action_type: 'edit' },

    // AI code developer (role 4) - can edit implementation
    { column_id: columnIds['implementation'], role_id: 4, action_type: 'edit' },

    // AI code reviewer (role 5) - can edit unit_review
    { column_id: columnIds['unit_review'], role_id: 5, action_type: 'edit' },

    // AI integration tester (role 6) - can edit unit_review AND integration_testing
    { column_id: columnIds['unit_review'], role_id: 6, action_type: 'edit' },
    { column_id: columnIds['integration_testing'], role_id: 6, action_type: 'edit' },

    // AI feature reviewer (role 7) - can edit final_review
    { column_id: columnIds['final_review'], role_id: 7, action_type: 'edit' },
  ];

  for (const rule of rules) {
    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
    ).run(projectId, rule.column_id, rule.role_id, rule.action_type);
  }

  // Insert workflow transitions
  const transitions = [
    { from_slug: 'todo', to_slug: 'implementation', requires_comment: 0, roles: [1, 2, 3] },
    { from_slug: 'implementation', to_slug: 'unit_review', requires_comment: 0, roles: [1, 4] },
    { from_slug: 'unit_review', to_slug: 'implementation', requires_comment: 1, roles: [1, 5, 6] },
    { from_slug: 'unit_review', to_slug: 'integration_testing', requires_comment: 1, roles: [1, 5, 6] },
    { from_slug: 'integration_testing', to_slug: 'final_review', requires_comment: 1, roles: [1, 7] },
    { from_slug: 'final_review', to_slug: 'done', requires_comment: 1, roles: [1, 7] },
  ];

  const transitionIds: Record<string, number> = {};
  for (const t of transitions) {
    const fromCol = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, t.from_slug) as { id: number };
    const toCol = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, t.to_slug) as { id: number };

    const result = db.prepare(
      'INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment) VALUES (?, ?, ?, ?)'
    ).run(projectId, fromCol.id, toCol.id, t.requires_comment);
    const transitionId = result.lastInsertRowid as number;
    transitionIds[`${t.from_slug}->${t.to_slug}`] = transitionId;

    for (const roleId of t.roles) {
      db.prepare(
        'INSERT INTO transition_allowed_roles (transition_id, role_id) VALUES (?, ?)'
      ).run(transitionId, roleId);
    }
  }

  return { columnIds, transitionIds, roleIds };
}

describe('PermissionChecker', () => {
  let projectId = 0;
  let testPort: number;

  beforeAll(async () => {
    testPort = await findFreePort();
    process.env.PORT = String(testPort);
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    await startServer();
    const projectResult = db.prepare(
      "INSERT INTO projects (name, slug) VALUES ('PermissionChecker Test', 'perm-checker-test')"
    ).run();
    projectId = projectResult.lastInsertRowid as number;
    setupTestDb(projectId);
  });

  afterAll(async () => {
    delete process.env.PORT;
    const db = getDb();
    try { db.exec(`DELETE FROM ticket_access_rules WHERE project_id = ${projectId}`); } catch {}
    try { db.exec(`DELETE FROM transition_allowed_roles WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE project_id = ${projectId})`); } catch {}
    try { db.exec(`DELETE FROM workflow_transitions WHERE project_id = ${projectId}`); } catch {}
    try { db.exec(`DELETE FROM kanban_columns WHERE project_id = ${projectId}`); } catch {}
    try { db.exec(`DELETE FROM project_roles WHERE project_id = ${projectId}`); } catch {}
    try { db.exec(`DELETE FROM projects WHERE id = ${projectId}`); } catch {}
    await stopServer();
  });

  describe('checkPermission', () => {
    it('allows read access (list_tickets) for all roles', () => {
      const pc = new PermissionChecker(projectId, 2); // AI teamleader
      expect(pc.checkPermission('list_tickets')).toEqual({ allowed: true });
    });

    it('allows read access (get_ticket) for all roles', () => {
      const pc = new PermissionChecker(projectId, 4); // AI code developer
      expect(pc.checkPermission('get_ticket')).toEqual({ allowed: true });
    });

    it('allows read access (list_dependencies) for all roles', () => {
      const pc = new PermissionChecker(projectId, 7); // AI feature reviewer
      expect(pc.checkPermission('list_dependencies')).toEqual({ allowed: true });
    });

    it('denies create permission when role lacks access rule', () => {
      const pc = new PermissionChecker(projectId, 4); // AI code developer - no todo create
      const result = pc.checkPermission('create_ticket', 'todo');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have create permission');
    });

    it('allows create permission for role with access rule', () => {
      const pc = new PermissionChecker(projectId, 2); // AI teamleader - has todo create
      const result = pc.checkPermission('create_ticket', 'todo');
      expect(result.allowed).toBe(true);
    });

    it('denies edit permission when role lacks access rule', () => {
      const pc = new PermissionChecker(projectId, 4); // AI code developer - no unit_review edit
      const result = pc.checkPermission('update_ticket', 'unit_review');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have edit permission');
    });

    it('allows edit permission for role with access rule', () => {
      const pc = new PermissionChecker(projectId, 4); // AI code developer - has implementation edit
      const result = pc.checkPermission('update_ticket', 'implementation');
      expect(result.allowed).toBe(true);
    });

    it('denies move permission when role lacks edit access', () => {
      const pc = new PermissionChecker(projectId, 7); // AI feature reviewer - no todo edit
      const result = pc.checkPermission('move_ticket', 'todo');
      expect(result.allowed).toBe(false);
    });

    it('allows move permission for role with edit access', () => {
      const pc = new PermissionChecker(projectId, 2); // AI teamleader - has todo edit
      const result = pc.checkPermission('move_ticket', 'todo');
      expect(result.allowed).toBe(true);
    });

    it('denies add_comment when role lacks edit access', () => {
      const pc = new PermissionChecker(projectId, 7); // AI feature reviewer - no todo edit
      const result = pc.checkPermission('add_comment', 'todo');
      expect(result.allowed).toBe(false);
    });

    it('allows add_comment for role with edit access', () => {
      const pc = new PermissionChecker(projectId, 2); // AI teamleader - has todo edit
      const result = pc.checkPermission('add_comment', 'todo');
      expect(result.allowed).toBe(true);
    });

    it('denies add_dependency when role lacks edit access', () => {
      const pc = new PermissionChecker(projectId, 7); // AI integration tester - no todo edit
      const result = pc.checkPermission('add_dependency', 'todo');
      expect(result.allowed).toBe(false);
    });

    it('denies remove_dependency when role lacks edit access', () => {
      const pc = new PermissionChecker(projectId, 7); // AI integration tester - no todo edit
      const result = pc.checkPermission('remove_dependency', 'todo');
      expect(result.allowed).toBe(false);
    });

    it('returns error for invalid column', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.checkPermission('create_ticket', 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('returns error when column context is missing for write actions', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.checkPermission('create_ticket'); // no column
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Column context required');
    });

    it('denies delete permission when role lacks delete access rule', () => {
      // Role 2 has edit permission for unit_review but no delete permission
      const pc = new PermissionChecker(projectId, 2);
      const result = pc.checkPermission('delete_ticket', 'unit_review');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have delete permission');
    });

    it('allows delete permission for role with delete access rule', () => {
      // Role 1 (Human User) has delete permission for todo
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.checkPermission('delete_ticket', 'todo');
      expect(result.allowed).toBe(true);
    });
  });

  describe('canTransition', () => {
    it('allows valid transition for Human User (role 1)', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.canTransition('todo', 'implementation');
      expect(result.allowed).toBe(true);
    });

    it('allows valid transition for AI code developer (role 4)', () => {
      const pc = new PermissionChecker(projectId, 4);
      const result = pc.canTransition('implementation', 'unit_review');
      expect(result.allowed).toBe(true);
    });

    it('denies transition when role is not allowed', () => {
      const pc = new PermissionChecker(projectId, 7); // AI feature reviewer
      const result = pc.canTransition('implementation', 'unit_review');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('denies non-existent transition', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.canTransition('todo', 'done'); // no direct transition
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No transition defined");
    });

    it('denies invalid source column', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.canTransition('invalid', 'todo');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('denies invalid target column', () => {
      const pc = new PermissionChecker(projectId, 1);
      const result = pc.canTransition('todo', 'invalid');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('isCommentRequired', () => {
    it('returns true for transitions requiring comment', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.isCommentRequired('unit_review', 'integration_testing')).toBe(true);
    });

    it('returns false for transitions not requiring comment', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.isCommentRequired('todo', 'implementation')).toBe(false);
    });

    it('returns false for invalid columns', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.isCommentRequired('invalid', 'todo')).toBe(false);
    });
  });

  describe('validateColumn', () => {
    it('returns true for existing column', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.validateColumn('todo')).toBe(true);
    });

    it('returns false for non-existing column', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.validateColumn('nonexistent')).toBe(false);
    });
  });

  describe('getColumnSlug', () => {
    it('returns slug for valid column ID', () => {
      const pc = new PermissionChecker(projectId, 1);
      const columnId = pc.getColumnId('implementation');
      expect(columnId).toBeDefined();
      expect(pc.getColumnSlug(columnId!)).toBe('implementation');
    });

    it('returns null for invalid column ID', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.getColumnSlug(999999)).toBeNull();
    });
  });

  describe('getColumnId', () => {
    it('returns ID for valid column slug', () => {
      const pc = new PermissionChecker(projectId, 1);
      const id = pc.getColumnId('implementation');
      expect(id).toBeGreaterThan(0);
    });

    it('returns null for invalid column slug', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.getColumnId('nonexistent')).toBeNull();
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns allowed transitions for Human User from todo', () => {
      const pc = new PermissionChecker(projectId, 1);
      const transitions = pc.getAllowedTransitions('todo');
      expect(transitions.some((t) => t.toColumnSlug === 'implementation')).toBe(true);
    });

    it('returns allowed transitions for AI code developer from implementation', () => {
      const pc = new PermissionChecker(projectId, 4);
      const transitions = pc.getAllowedTransitions('implementation');
      expect(transitions.some((t) => t.toColumnSlug === 'unit_review')).toBe(true);
      expect(transitions.some((t) => t.toColumnSlug === 'todo')).toBe(false); // not allowed
    });

    it('returns empty array for invalid column', () => {
      const pc = new PermissionChecker(projectId, 1);
      expect(pc.getAllowedTransitions('nonexistent')).toEqual([]);
    });
  });

  describe('getAllRolePermissions', () => {
    it('AI teamleader (role 2) can create in todo', () => {
      const pc = new PermissionChecker(projectId, 2);
      expect(pc.checkPermission('create_ticket', 'todo').allowed).toBe(true);
    });

    it('AI teamleader (role 2) cannot create in implementation', () => {
      const pc = new PermissionChecker(projectId, 2);
      const result = pc.checkPermission('create_ticket', 'implementation');
      expect(result.allowed).toBe(false);
    });

    it('AI architect (role 3) can create in todo', () => {
      const pc = new PermissionChecker(projectId, 3);
      expect(pc.checkPermission('create_ticket', 'todo').allowed).toBe(true);
    });

    it('AI code developer (role 4) can edit implementation', () => {
      const pc = new PermissionChecker(projectId, 4);
      expect(pc.checkPermission('update_ticket', 'implementation').allowed).toBe(true);
    });

    it('AI code developer (role 4) cannot edit unit_review', () => {
      const pc = new PermissionChecker(projectId, 4);
      const result = pc.checkPermission('update_ticket', 'unit_review');
      expect(result.allowed).toBe(false);
    });

    it('AI code reviewer (role 5) can edit unit_review', () => {
      const pc = new PermissionChecker(projectId, 5);
      expect(pc.checkPermission('update_ticket', 'unit_review').allowed).toBe(true);
    });

    it('AI integration tester (role 6) can edit unit_review', () => {
      const pc = new PermissionChecker(projectId, 6);
      expect(pc.checkPermission('update_ticket', 'unit_review').allowed).toBe(true);
    });

    it('AI integration tester (role 6) can edit integration_testing', () => {
      const pc = new PermissionChecker(projectId, 6);
      expect(pc.checkPermission('update_ticket', 'integration_testing').allowed).toBe(true);
    });

    it('AI feature reviewer (role 7) can edit final_review', () => {
      const pc = new PermissionChecker(projectId, 7);
      expect(pc.checkPermission('update_ticket', 'final_review').allowed).toBe(true);
    });

    it('AI feature reviewer (role 7) cannot edit todo', () => {
      const pc = new PermissionChecker(projectId, 7);
      const result = pc.checkPermission('update_ticket', 'todo');
      expect(result.allowed).toBe(false);
    });
  });

  describe('isRoleAllowedForTransition', () => {
    it('AI code developer (role 4) is allowed implementation→unit_review', () => {
      const pc = new PermissionChecker(projectId, 4);
      expect(pc.isRoleAllowedForTransition('implementation', 'unit_review')).toBe(true);
    });

    it('AI feature reviewer (role 7) is NOT allowed implementation→unit_review', () => {
      const pc = new PermissionChecker(projectId, 7);
      expect(pc.isRoleAllowedForTransition('implementation', 'unit_review')).toBe(false);
    });

    it('AI code reviewer (role 5) is allowed unit_review→implementation', () => {
      const pc = new PermissionChecker(projectId, 5);
      expect(pc.isRoleAllowedForTransition('unit_review', 'implementation')).toBe(true);
    });
  });
});
