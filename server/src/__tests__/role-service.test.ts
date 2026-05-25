import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { RoleService } from '../services/role-service.js';
import * as projectsModule from '../db/queries/projects.js';
import * as seedModule from '../db/seed.js';

describe('Role Service', () => {
  beforeAll(() => {
    // Reset DB for clean state
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();

    // Create a test project so we can insert tickets
    db.prepare(
      'INSERT OR IGNORE INTO projects (name, slug, description) VALUES (?, ?, ?)'
    ).run('Test Project', 'test-project', 'A test project');

    // Seed global columns so the service can create access rules for new roles
    const globalColumns = [
      { slug: 'todo', name: 'To Do', order: 0 },
      { slug: 'implementation', name: 'Implementation', order: 1 },
      { slug: 'unit_review', name: 'Unit Review', order: 2 },
      { slug: 'integration_testing', name: 'Integration Testing', order: 3 },
      { slug: 'final_review', name: 'Final Review', order: 4 },
      { slug: 'done', name: 'Done', order: 5 },
      { slug: 'human_feedback', name: 'Human Feedback', order: 6 },
    ];
    for (const col of globalColumns) {
      db.prepare(
        'INSERT OR IGNORE INTO kanban_columns (slug, name, "order", project_id, is_default) VALUES (?, ?, ?, NULL, 0)'
      ).run(col.slug, col.name, col.order);
    }
  });

  describe('create', () => {
    it('creates a new role with valid params', () => {
      const result = RoleService.create({
        name: 'Test Role',
        description: 'A test role',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe('Test Role');
      expect(result.error).toBeUndefined();
    });

    it('returns error on duplicate role name', () => {
      RoleService.create({
        name: 'Duplicate Role',
        description: 'First creation',
      });

      const result = RoleService.create({
        name: 'Duplicate Role',
        description: 'Second creation',
      });

      expect(result.error).toBeDefined();
      expect(result.errorCode).toBe('CONFLICT');
      expect(result.statusCode).toBe(409);
    });

    it('accepts role creation without access_level', () => {
      const result = RoleService.create({
        name: 'No Access Level Role',
      });

      // Role should be created successfully without access_level field
      expect(result.data).toBeDefined();
      expect(result.data!.name).toBe('No Access Level Role');
    });

    it('creates access rules when accessLevel is admin', () => {
      const result = RoleService.create({
        name: 'Admin Access Role',
        accessLevel: 'admin',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      // Should have access rules for create, edit, delete on global columns
      const ruleCount = db.prepare<[number]>(
        'SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE role_id = ? AND project_id IS NULL'
      ).get(result.data!.id) as { cnt: number };
      expect(ruleCount.cnt).toBeGreaterThan(0);

      // All three actions should be present
      const actions = db.prepare<[number]>(
        'SELECT DISTINCT action_type FROM ticket_access_rules WHERE role_id = ? AND project_id IS NULL ORDER BY action_type'
      ).all(result.data!.id) as { action_type: string }[];
      const actionTypes = actions.map(a => a.action_type);
      expect(actionTypes).toContain('create');
      expect(actionTypes).toContain('edit');
      expect(actionTypes).toContain('delete');
    });

    it('creates access rules when accessLevel is edit', () => {
      const result = RoleService.create({
        name: 'Edit Access Role',
        accessLevel: 'edit',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      const actions = db.prepare<[number]>(
        'SELECT DISTINCT action_type FROM ticket_access_rules WHERE role_id = ? AND project_id IS NULL ORDER BY action_type'
      ).all(result.data!.id) as { action_type: string }[];
      const actionTypes = actions.map(a => a.action_type);
      expect(actionTypes).toContain('create');
      expect(actionTypes).toContain('edit');
      expect(actionTypes).not.toContain('delete');
    });

    it('creates access rules when accessLevel is report', () => {
      const result = RoleService.create({
        name: 'Report Access Role',
        accessLevel: 'report',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      const actions = db.prepare<[number]>(
        'SELECT DISTINCT action_type FROM ticket_access_rules WHERE role_id = ? AND project_id IS NULL ORDER BY action_type'
      ).all(result.data!.id) as { action_type: string }[];
      const actionTypes = actions.map(a => a.action_type);
      expect(actionTypes).toContain('create');
      expect(actionTypes).not.toContain('edit');
      expect(actionTypes).not.toContain('delete');
    });

    it('creates no access rules when accessLevel is read only', () => {
      const result = RoleService.create({
        name: 'ReadOnly Access Role',
        accessLevel: 'read only',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      const ruleCount = db.prepare<[number]>(
        'SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE role_id = ?'
      ).get(result.data!.id) as { cnt: number };
      expect(ruleCount.cnt).toBe(0);
    });

    it('creates global roles_columns entry on success', () => {
      const result = RoleService.create({
        name: 'Column Test Role',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      const globalEntry = db.prepare(
        'SELECT COUNT(*) as count FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
      ).get(result.data!.id) as { count: number };
      expect(globalEntry.count).toBe(1);
    });

    it('creates project-level roles_columns for existing projects', () => {
      // First, ensure there's at least one project
      const db = getDb();
      const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
      
      const result = RoleService.create({
        name: 'Project Test Role',
      });

      expect(result.data).toBeDefined();
      const projectEntries = db.prepare(
        'SELECT COUNT(*) as count FROM roles_columns WHERE role_id = ? AND project_id IS NOT NULL'
      ).get(result.data!.id) as { count: number };
      
      // Should have created entries for existing projects
      if (projectCount.count > 0) {
        expect(projectEntries.count).toBe(projectCount.count);
      }
    });

    it('creates role without default access rules', () => {
      const result = RoleService.create({
        name: 'No Access Rules Role',
      });

      expect(result.data).toBeDefined();
      const db = getDb();
      const accessRules = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ? AND is_global = 1'
      ).get(result.data!.id) as { count: number };
      
      // No default access rules should be created (let admins configure per-column)
      expect(accessRules.count).toBe(0);
    });

    it('rolls back all changes on failure (transaction)', () => {
      // Simulate a failure during seedRoleColumnMappingsForAllProjects
      // by mocking it to throw after the role is created.
      // This verifies that the role + global roles_columns + access rules
      // are all rolled back when a downstream step fails.

      const mockError = new Error('Seed failed');
      const restore = vi.spyOn(seedModule, 'seedRoleColumnMappingsForAllProjects')
        .mockImplementation(() => { throw mockError; });

      const result = RoleService.create({
        name: 'Transaction Rollback Test',
      });

      restore.mockRestore();

      // Should get an error, not a successful result
      expect(result.error).toBeDefined();
      expect(result.errorCode).toBe('INTERNAL_ERROR');

      // Verify the role was rolled back (not in the database)
      const db = getDb();
      const role = db.prepare('SELECT COUNT(*) as count FROM roles WHERE name = ?').get('Transaction Rollback Test') as { count: number };
      expect(role.count).toBe(0);

      // Verify global roles_columns was rolled back
      const globalEntry = db.prepare(
        'SELECT COUNT(*) as count FROM roles_columns WHERE role_id IN (SELECT id FROM roles WHERE name = ?) AND project_id IS NULL'
      ).get('Transaction Rollback Test') as { count: number };
      expect(globalEntry.count).toBe(0);
    });
  });

  describe('delete', () => {
    it('returns error when deleting Human User (id=1)', () => {
      const result = RoleService.delete(1);

      expect(result.error).toBeDefined();
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(result.statusCode).toBe(400);
    });

    it('returns error when role has active tickets', () => {
      // Create a role
      const createResult = RoleService.create({
        name: 'Ticket Holder Role',
      });

      expect(createResult.data).toBeDefined();
      
      // Create a ticket with this role as creator
      const db = getDb();
      db.prepare(
        'INSERT INTO tickets (title, description, column_id, project_id, created_by_role_id) VALUES (?, ?, ?, ?, ?)'
      ).run(
        'Test Ticket',
        'Description',
        1, // column_id
        1, // project_id
        createResult.data!.id
      );

      // Try to delete the role
      const deleteResult = RoleService.delete(createResult.data!.id);

      expect(deleteResult.error).toBeDefined();
      expect(deleteResult.errorCode).toBe('CONFLICT');
      expect(deleteResult.statusCode).toBe(409);
    });

    it('successfully deletes role with no dependencies', () => {
      const createResult = RoleService.create({
        name: 'Deletable Role',
      });

      expect(createResult.data).toBeDefined();

      const deleteResult = RoleService.delete(createResult.data!.id);

      expect(deleteResult.data).toBeDefined();
      expect(deleteResult.data?.deleted).toBe(createResult.data!.id);
      expect(deleteResult.error).toBeUndefined();

      // Verify role is deleted
      const db = getDb();
      const role = db.prepare('SELECT COUNT(*) as count FROM roles WHERE id = ?').get(createResult.data!.id) as { count: number };
      expect(role.count).toBe(0);
    });

    it('revokes API tokens for deleted role', () => {
      const createResult = RoleService.create({
        name: 'Token Role',
      });

      expect(createResult.data).toBeDefined();

      // Create an API token for this role
      const db = getDb();
      db.prepare(
        'INSERT INTO api_tokens (project_id, role_id, description, token_hash) VALUES (?, ?, ?, ?)'
      ).run(
        1, // project_id
        createResult.data!.id,
        'Test token',
        'hash123'
      );

      // Delete the role
      RoleService.delete(createResult.data!.id);

      // Verify token is deleted
      const tokenCount = db.prepare(
        'SELECT COUNT(*) as count FROM api_tokens WHERE role_id = ?'
      ).get(createResult.data!.id) as { count: number };
      expect(tokenCount.count).toBe(0);
    });

    it('removes access rules for deleted role', () => {
      const createResult = RoleService.create({
        name: 'Access Rules Delete Role',
      });

      expect(createResult.data).toBeDefined();

      // Verify access rules exist (manually inserted for this test)
      const db = getDb();
      db.prepare(
        'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type, is_global) VALUES (NULL, 1, ?, 1, 1)'
      ).run(createResult.data!.id);
      db.prepare(
        'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type, is_global) VALUES (NULL, 2, ?, 2, 1)'
      ).run(createResult.data!.id);

      const ruleCountBefore = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(createResult.data!.id) as { count: number };
      expect(ruleCountBefore.count).toBeGreaterThan(0);

      // Delete the role
      RoleService.delete(createResult.data!.id);

      // Verify access rules are deleted
      const ruleCountAfter = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(createResult.data!.id) as { count: number };
      expect(ruleCountAfter.count).toBe(0);
    });

    it('cascades through roles_columns (ON DELETE CASCADE)', () => {
      const createResult = RoleService.create({
        name: 'Cascade Role',
      });

      expect(createResult.data).toBeDefined();

      // Verify roles_columns entries exist
      const db = getDb();
      const columnCountBefore = db.prepare(
        'SELECT COUNT(*) as count FROM roles_columns WHERE role_id = ?'
      ).get(createResult.data!.id) as { count: number };
      expect(columnCountBefore.count).toBeGreaterThan(0);

      // Delete the role
      RoleService.delete(createResult.data!.id);

      // Verify roles_columns entries are deleted (via ON DELETE CASCADE)
      const columnCountAfter = db.prepare(
        'SELECT COUNT(*) as count FROM roles_columns WHERE role_id = ?'
      ).get(createResult.data!.id) as { count: number };
      expect(columnCountAfter.count).toBe(0);
    });

    it('rolls back on failure during cleanup', () => {
      // Simulate a failure during delete cleanup by mocking
      // reassignTicketsToRole to throw after tokens are revoked.
      // This verifies that the role is not deleted when cleanup fails mid-transaction.

      const createResult = RoleService.create({
        name: 'Cleanup Rollback Test',
      });
      expect(createResult.data).toBeDefined();

      const mockError = new Error('Cleanup failed');
      const restore = vi.spyOn(projectsModule, 'reassignTicketsToRole')
        .mockImplementation(() => { throw mockError; });

      const deleteResult = RoleService.delete(createResult.data!.id);

      restore.mockRestore();

      // Should get an error
      expect(deleteResult.error).toBeDefined();
      expect(deleteResult.errorCode).toBe('INTERNAL_ERROR');

      // Verify the role was rolled back (not deleted from the database)
      const db = getDb();
      const role = db.prepare('SELECT COUNT(*) as count FROM roles WHERE name = ?').get('Cleanup Rollback Test') as { count: number };
      expect(role.count).toBe(1);
    });
  });
});
