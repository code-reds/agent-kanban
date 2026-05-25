import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import { WorkflowService } from '../services/workflow-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = OFF");
  try { db.exec("DROP TABLE IF EXISTS schema_migrations"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS projects"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS roles"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS kanban_columns"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS workflow_transitions"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS transition_allowed_roles"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_access_rules"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS tickets"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_dependencies"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_comments"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_status_history"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS conversations"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS messages"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS api_tokens"); } catch { }
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations();
  seedDefaultRoles();
}

function createProject(db: any, slug: string, name: string): { id: number } {
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run(name, slug);
  return db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug)!;
}

function setupTestProject(db: any, slug: string) {
  const project = createProject(db, slug, slug);
  // Create columns for this project
  db.prepare(
    'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
  ).run(project.id, 'todo', 'Todo', 0, 0);
  db.prepare(
    'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
  ).run(project.id, 'done', 'Done', 2, 0);

  // Get the actual column IDs
  const todoCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('todo', project.id)!;
  const doneCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('done', project.id)!;

  // Create a transition
  db.prepare(
    'INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment, entire_ticket_group) VALUES (?, ?, ?, ?, ?)'
  ).run(project.id, todoCol.id, doneCol.id, 0, 0);
  const transition = db.prepare('SELECT id FROM workflow_transitions ORDER BY id DESC').get()!;

  return { projectId: project.id, columnFrom: todoCol.id, columnTo: doneCol.id, transitionId: transition.id };
}

function addTransitionRole(db: any, transitionId: number, roleId: number) {
  db.prepare(
    'INSERT INTO transition_allowed_roles (transition_id, role_id) VALUES (?, ?)'
  ).run(transitionId, roleId);
}

describe('WorkflowService.update', () => {
  beforeEach(() => {
    initDb();
  });

  describe('validation', () => {
    it('returns 404 for non-existent project', () => {
      const result = WorkflowService.update('nonexistent', 1, { requires_comment: true });
      expect(result.error).toContain('not found');
      expect(result.errorCode).toBe('NOT_FOUND');
      expect((result as { statusCode: number }).statusCode).toBe(404);
    });

    it('returns 404 for non-existent transition', () => {
      const db = getDb();
      createProject(db, 'test-notfound', 'NotFound');
      const result = WorkflowService.update('test-notfound', 99999, { requires_comment: true });
      expect(result.error).toContain('not found');
      expect(result.errorCode).toBe('NOT_FOUND');
      expect((result as { statusCode: number }).statusCode).toBe(404);
    });

    it('returns 404 for transition belonging to different project', () => {
      const db = getDb();
      const proj1 = createProject(db, 'test-proj1', 'Proj1');
      const proj2 = createProject(db, 'test-proj2', 'Proj2');

      // Create columns for proj1 and a transition
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
      ).run(proj1.id, 'todo', 'Todo', 0, 0);
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)'
      ).run(proj1.id, 'done', 'Done', 2, 0);
      const col1 = db.prepare<[string, number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
      ).get('todo', proj1.id)!;
      const col2 = db.prepare<[string, number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
      ).get('done', proj1.id)!;
      db.prepare(
        'INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment, entire_ticket_group) VALUES (?, ?, ?, ?, ?)'
      ).run(proj1.id, col1.id, col2.id, 0, 0);
      const trans = db.prepare('SELECT id FROM workflow_transitions ORDER BY id DESC').get() as { id: number };

      const result = WorkflowService.update('test-proj2', trans.id, { requires_comment: true });
      expect(result.error).toContain('does not belong to project');
      expect(result.errorCode).toBe('NOT_FOUND');
      expect((result as { statusCode: number }).statusCode).toBe(404);
    });

    it('returns 400 when no update fields are provided', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-nofields');
      const result = WorkflowService.update('test-nofields', setup.transitionId, {});
      expect(result.error).toContain('No update fields provided');
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect((result as { statusCode: number }).statusCode).toBe(400);
    });
  });

  describe('requires_comment updates', () => {
    it('updates requires_comment to true', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-rc');
      const result = WorkflowService.update('test-rc', setup.transitionId, { requires_comment: true });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(true);
      expect(result!.transition!.entire_ticket_group).toBe(false);
    });

    it('updates requires_comment to false', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-rc2');
      // Update to set requires_comment true first
      addTransitionRole(db, setup.transitionId, 1);
      db.prepare(
        'UPDATE workflow_transitions SET requires_comment = 1 WHERE id = ?'
      ).run(setup.transitionId);
      const result = WorkflowService.update('test-rc2', setup.transitionId, { requires_comment: false });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(false);
    });

    it('does not change requires_comment when not provided', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-partial');
      // Set entire_ticket_group to true first
      db.prepare(
        'UPDATE workflow_transitions SET entire_ticket_group = 1 WHERE id = ?'
      ).run(setup.transitionId);
      const result = WorkflowService.update('test-partial', setup.transitionId, { entire_ticket_group: true });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(false);
      expect(result!.transition!.entire_ticket_group).toBe(true);
    });
  });

  describe('entire_ticket_group updates', () => {
    it('updates entire_ticket_group to true', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-etg');
      const result = WorkflowService.update('test-etg', setup.transitionId, { entire_ticket_group: true });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.entire_ticket_group).toBe(true);
    });

    it('updates entire_ticket_group to false', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-etg2');
      // Set entire_ticket_group to true first
      db.prepare(
        'UPDATE workflow_transitions SET entire_ticket_group = 1 WHERE id = ?'
      ).run(setup.transitionId);
      const result = WorkflowService.update('test-etg2', setup.transitionId, { entire_ticket_group: false });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.entire_ticket_group).toBe(false);
    });
  });

  describe('allowed_roles updates (diff-based sync)', () => {
    it('adds new roles to a transition', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-ar1');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      addTransitionRole(db, setup.transitionId, roles[1].id);

      const result = WorkflowService.update('test-ar1', setup.transitionId, {
        allowed_roles: [roles[1].id, roles[2].id],
      });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.allowed_roles).toEqual([roles[1].id, roles[2].id]);
    });

    it('replaces all roles when different set is provided', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-ar2');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      addTransitionRole(db, setup.transitionId, roles[1].id);

      const result = WorkflowService.update('test-ar2', setup.transitionId, {
        allowed_roles: [roles[2].id, roles[3].id],
      });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.allowed_roles).toEqual([roles[2].id, roles[3].id]);
    });

    it('empties allowed_roles when empty array is provided', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-ar3');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      addTransitionRole(db, setup.transitionId, roles[1].id);

      const result = WorkflowService.update('test-ar3', setup.transitionId, { allowed_roles: [] });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.allowed_roles).toEqual([]);
    });

    it('preserves existing roles when same set is provided', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-ar4');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      addTransitionRole(db, setup.transitionId, roles[1].id);

      const result = WorkflowService.update('test-ar4', setup.transitionId, {
        allowed_roles: [roles[0].id, roles[1].id],
      });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.allowed_roles.length).toBe(2);
    });
  });

  describe('combined updates', () => {
    it('updates all fields at once', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-all');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);

      const result = WorkflowService.update('test-all', setup.transitionId, {
        requires_comment: true,
        entire_ticket_group: true,
        allowed_roles: [roles[1].id, roles[2].id],
      });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(true);
      expect(result!.transition!.entire_ticket_group).toBe(true);
      expect(result!.transition!.allowed_roles).toEqual([roles[1].id, roles[2].id]);
    });
  });

  describe('partial updates', () => {
    it('updates only requires_comment, leaves other fields unchanged', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-partial1');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      addTransitionRole(db, setup.transitionId, roles[1].id);
      // Set entire_ticket_group to true
      db.prepare(
        'UPDATE workflow_transitions SET entire_ticket_group = 1 WHERE id = ?'
      ).run(setup.transitionId);

      const result = WorkflowService.update('test-partial1', setup.transitionId, { requires_comment: true });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(true);
      expect(result!.transition!.entire_ticket_group).toBe(true);
      expect(result!.transition!.allowed_roles).toEqual([roles[0].id, roles[1].id]);
    });

    it('updates only allowed_roles, leaves other fields unchanged', () => {
      const db = getDb();
      const setup = setupTestProject(db, 'test-partial2');
      const roles = db.prepare<[], { id: number }>('SELECT id FROM roles ORDER BY id').all();
      addTransitionRole(db, setup.transitionId, roles[0].id);
      // Set both booleans to true
      db.prepare(
        'UPDATE workflow_transitions SET requires_comment = 1, entire_ticket_group = 1 WHERE id = ?'
      ).run(setup.transitionId);

      const result = WorkflowService.update('test-partial2', setup.transitionId, {
        allowed_roles: [roles[1].id],
      });
      expect(result.error).toBeUndefined();
      expect(result!.transition!.requires_comment).toBe(true);
      expect(result!.transition!.entire_ticket_group).toBe(true);
      expect(result!.transition!.allowed_roles).toEqual([roles[1].id]);
    });
  });
});
