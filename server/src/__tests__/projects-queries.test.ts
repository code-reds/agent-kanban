import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import {
  createRole,
  deleteRole,
  reassignTicketsToRole,
  revokeTokensByRole,
  removeAccessRulesByRole,
  getAllProjects,
  getProjectBySlug,
  createProject,
  updateProject,
  deleteProject,
} from '../db/queries/projects.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

/* ─── Project CRUD queries ─────────────────────────────────────────────────── */

describe('Projects Query Functions', () => {
  beforeEach(() => {
    initDb();
  });

  describe('getAllProjects', () => {
    it('should return all projects', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Project 1', 'project-1');
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Project 2', 'project-2');
      const result = getAllProjects();
      expect(result.length).toBe(2);
    });

    it('should return empty array when no projects', () => {
      const result = getAllProjects();
      expect(result).toHaveLength(0);
    });

    it('should search by name', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Agent Kanban', 'agent-kanban');
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Other Project', 'other');
      const result = getAllProjects('agent');
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Agent Kanban');
    });

    it('should search by slug', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-project');
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Other', 'other');
      const result = getAllProjects('test');
      expect(result.length).toBe(1);
    });

    it('should return empty when no match', () => {
      const result = getAllProjects('nonexistent');
      expect(result).toHaveLength(0);
    });
  });

  describe('getProjectBySlug', () => {
    it('should find project by slug', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'find-me');
      const result = getProjectBySlug('find-me');
      expect(result).toBeDefined();
      expect(result!.slug).toBe('find-me');
      expect(result!.name).toBe('Test');
    });

    it('should return undefined for non-existent slug', () => {
      const result = getProjectBySlug('does-not-exist');
      expect(result).toBeUndefined();
    });
  });

  describe('createProject', () => {
    it('should create a project', () => {
      const result = createProject('Full Project', 'full-project');
      expect(result).toBeDefined();
      expect(result!.name).toBe('Full Project');
      expect(result!.slug).toBe('full-project');
    });
  });

  describe('updateProject', () => {
    it('should update project name', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Old', 'update-test');
      const updated = updateProject('update-test', 'New');
      expect(updated!.name).toBe('New');
    });

    it('should update project description', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Old', 'update-test');
      const updated = updateProject('update-test', undefined, 'New desc');
      expect(updated!.description).toBe('New desc');
    });

    it('should return undefined for non-existent project', () => {
      const result = updateProject('nonexistent', 'New');
      expect(result).toBeUndefined();
    });

    it('should update both name and description', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Old', 'update-test');
      const updated = updateProject('update-test', 'New', 'New desc');
      expect(updated!.name).toBe('New');
      expect(updated!.description).toBe('New desc');
    });
  });

  describe('deleteProject', () => {
    it('should delete a project', () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('ToDelete', 'delete-me');
      const result = deleteProject('delete-me');
      expect(result).toBe(true);
      const remaining = getProjectBySlug('delete-me');
      expect(remaining).toBeUndefined();
    });

    it('should return false for non-existent project', () => {
      const result = deleteProject('nonexistent');
      expect(result).toBe(false);
    });

    it('should cascade delete all child rows (columns, tickets, comments, dependencies, status history, access rules, workflow transitions, conversations)', () => {
      const db = getDb();
      const projectSlug = 'cascade-delete-test';
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Cascade Test', projectSlug);
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(projectSlug)! as { id: number };

      // Create columns
      db.prepare('INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)').run(project.id, 'todo', 'Todo', 1, 1);
      db.prepare('INSERT INTO kanban_columns (project_id, slug, name, "order", is_default) VALUES (?, ?, ?, ?, ?)').run(project.id, 'done', 'Done', 4, 0);

      // Create workflow transitions
      const todoCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('todo', project.id) as { id: number };
      const doneCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('done', project.id) as { id: number };
      db.prepare('INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment) VALUES (?, ?, ?, 0)').run(project.id, todoCol.id, doneCol.id);

      // Create access rules
      db.prepare('INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, 1, \'create\')').run(project.id, todoCol.id);

      // Create tickets
      const ticket1 = db.prepare('INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').get(project.id, todoCol.id, 'Ticket 1', '[]', 2, 1) as { id: number };
      db.prepare('INSERT INTO tickets (project_id, column_id, title, labels, priority, parent_id, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(project.id, todoCol.id, 'Child', '[]', 3, ticket1.id, 1);

      // Get the child ticket id
      const ticket2 = db.prepare('SELECT id FROM tickets WHERE project_id = ? AND title = ?').get(project.id, 'Child') as { id: number };

      // Create comments
      db.prepare('INSERT INTO ticket_comments (ticket_id, author_role_id, content) VALUES (?, ?, ?)').run(ticket1.id, 1, 'Comment on T1');
      db.prepare('INSERT INTO ticket_comments (ticket_id, author_role_id, content) VALUES (?, ?, ?)').run(ticket2.id, 1, 'Comment on T2');

      // Create dependencies
      db.prepare('INSERT INTO ticket_dependencies (ticket_id, depends_on_id, relation_type) VALUES (?, ?, ?)').run(ticket1.id, ticket2.id, 'blocked_by');

      // Create status history
      db.prepare('INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id) VALUES (?, ?, ?, 1)').run(ticket1.id, todoCol.id, doneCol.id);

      // Create conversations
      db.prepare('INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, 1, 2)').run(project.id);
      db.prepare('INSERT INTO messages (conversation_id, sender_role_id, content, fetched_until_id) VALUES (1, 1, \'Hello\', 1)');

      // Delete the project
      const result = deleteProject(projectSlug);
      expect(result).toBe(true);

      // Verify project is deleted
      expect(getProjectBySlug(projectSlug)).toBeUndefined();

      // Verify all child rows are cascaded/deleted
      expect(db.prepare('SELECT COUNT(*) as c FROM kanban_columns WHERE project_id = ?').get(project.id) as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM tickets WHERE project_id = ?').get(project.id) as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM ticket_comments').get() as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM ticket_dependencies').get() as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM ticket_status_history').get() as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM ticket_access_rules WHERE project_id = ?').get(project.id) as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM workflow_transitions WHERE project_id = ?').get(project.id) as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM conversations WHERE project_id = ?').get(project.id) as { c: number }).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).toEqual({ c: 0 });
    });
  });
});

/* ─── Role management queries ───────────────────────────────────────────────── */

describe('Role Management Queries', () => {
  beforeEach(() => {
    initDb();

    // Create a test project and global columns for role-related tests
    const db = getDb();
    db.prepare('INSERT INTO projects (name, slug, description) VALUES (?, ?, ?)').run('Test Project', 'test-project', 'A test project');

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

  describe('createRole', () => {
    it('inserts role and returns the created row', () => {
      const result = createRole('Test Role', 'A test role', 'write');
      expect(result).toBeDefined();
      expect(result!.name).toBe('Test Role');

      const db = getDb();
      const row = db.prepare('SELECT * FROM roles WHERE name = ?').get('Test Role') as { id: number; name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('Test Role');
    });
  });

  describe('deleteRole', () => {
    it('returns error for Human User', () => {
      const result = deleteRole(1);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when tickets exist', () => {
      const role = createRole('Ticket Role', 'Role with tickets', 'read');
      expect(role).toBeDefined();

      const db = getDb();
      const projectId = 1;
      const columnId = 1;
      db.prepare(
        'INSERT INTO tickets (title, description, column_id, project_id, created_by_role_id) VALUES (?, ?, ?, ?, ?)'
      ).run('Test', 'Desc', columnId, projectId, role!.id);

      const result = deleteRole(role!.id);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('deletes all related records', () => {
      const role = createRole('Delete Test Role', 'Role to delete', 'admin');
      expect(role).toBeDefined();

      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-project') as { id: number };
      const columns = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL'
      ).all() as { id: number }[];

      // Manually create access rules for the role.
      // Note: deleteRole is a raw query that only deletes the role row.
      // It does NOT clean up related records — RoleService.delete
      // handles cascading cleanup before calling deleteRole.
      // FK-constrained tables like api_tokens, transition_allowed_roles,
      // ticket_access_rules, etc. have RESTRICT constraints, so the
      // caller must clean them up first. This test verifies that
      // after cleanup, deleteRole succeeds.
      for (const col of columns.slice(0, 2)) {
        db.prepare(
          'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
        ).run(project.id, col.id, role!.id, 'create');
      }

      // Verify access rules exist BEFORE cleanup
      const ruleCountBefore = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(role!.id) as { count: number };
      expect(ruleCountBefore.count).toBeGreaterThan(0);

      // Clean up FK-constrained records (caller's responsibility)
      db.prepare('DELETE FROM ticket_access_rules WHERE role_id = ?').run(role!.id);

      // Delete the role — succeeds because all FK-constrained records are cleaned up
      const result = deleteRole(role!.id);
      expect(result.success).toBe(true);

      // Verify the role is deleted
      const roleAfter = db.prepare('SELECT COUNT(*) as count FROM roles WHERE id = ?').get(role!.id) as { count: number };
      expect(roleAfter.count).toBe(0);

      // Verify access rules are gone
      const ruleCountAfter = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(role!.id) as { count: number };
      expect(ruleCountAfter.count).toBe(0);
    });
  });

  describe('reassignTicketsToRole', () => {
    it('updates created_by_role_id', () => {
      const oldRole = createRole('Old Role', 'Old role', 'read');
      const newRole = createRole('New Role', 'New role', 'write');
      expect(oldRole).toBeDefined();
      expect(newRole).toBeDefined();
      const oldRoleId = oldRole!.id;
      const newRoleId = newRole!.id;

      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-project') as { id: number };

      db.prepare(
        'INSERT INTO tickets (title, description, column_id, project_id, created_by_role_id) VALUES (?, ?, ?, ?, ?)'
      ).run('Reassign Test', 'Desc', 1, project.id, oldRoleId);

      const ticketBefore = db.prepare('SELECT created_by_role_id FROM tickets WHERE title = ?').get('Reassign Test') as { created_by_role_id: number } | undefined;
      expect(ticketBefore!.created_by_role_id).toBe(oldRoleId);

      const count = reassignTicketsToRole(oldRoleId, newRoleId);
      expect(count).toBe(1);

      const ticketAfter = db.prepare('SELECT created_by_role_id FROM tickets WHERE title = ?').get('Reassign Test') as { created_by_role_id: number } | undefined;
      expect(ticketAfter!.created_by_role_id).toBe(newRoleId);
      expect(ticketAfter!.created_by_role_id).not.toBe(oldRoleId);
    });
  });

  describe('revokeTokensByRole', () => {
    it('deletes all tokens for role', () => {
      const role = createRole('Token Role', 'Role with tokens', 'read');
      expect(role).toBeDefined();

      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-project') as { id: number };

      db.prepare(
        'INSERT INTO api_tokens (project_id, role_id, description, token_hash) VALUES (?, ?, ?, ?)'
      ).run(project.id, role!.id, 'Token 1', 'hash1');
      db.prepare(
        'INSERT INTO api_tokens (project_id, role_id, description, token_hash) VALUES (?, ?, ?, ?)'
      ).run(project.id, role!.id, 'Token 2', 'hash2');

      const count = revokeTokensByRole(role!.id);
      expect(count).toBe(2);

      const tokenCount = db.prepare(
        'SELECT COUNT(*) as count FROM api_tokens WHERE role_id = ?'
      ).get(role!.id) as { count: number };
      expect(tokenCount.count).toBe(0);
    });
  });

  describe('removeAccessRulesByRole', () => {
    it('deletes all rules for role', () => {
      const role = createRole('Access Rules Role', 'Role with rules', 'admin');
      expect(role).toBeDefined();

      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-project') as { id: number };
      const columns = db.prepare('SELECT id FROM kanban_columns WHERE project_id IS NULL').all() as { id: number }[];

      for (const col of columns.slice(0, 3)) {
        db.prepare(
          'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type, is_global) VALUES (?, ?, ?, ?, ?)'
        ).run(project.id, col.id, role!.id, 'create', 1);
      }

      const ruleCountBefore = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(role!.id) as { count: number };
      expect(ruleCountBefore.count).toBeGreaterThan(0);

      const count = removeAccessRulesByRole(role!.id);
      expect(count).toBe(ruleCountBefore.count);

      const ruleCountAfter = db.prepare(
        'SELECT COUNT(*) as count FROM ticket_access_rules WHERE role_id = ?'
      ).get(role!.id) as { count: number };
      expect(ruleCountAfter.count).toBe(0);
    });
  });
});
