import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import { TicketService } from '../services/ticket-service.js';

function initDb() {
  process.env.DB_PATH = ':memory:';
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-closure-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

function getTodoColumnId(projectId: number) {
  const db = getDb();
  return db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, 'todo') as { id: number };
}

describe('TicketService closure validation helpers', () => {
  beforeEach(() => {
    initDb();
  });

  describe('getOpenChildTicketIds', () => {
    it('should return empty array when no children exist', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col.id, 'Parent', '', '[]', 2, null, null, 1)!;

      const openChildren = TicketService.getOpenChildTicketIds(parent.id);
      expect(openChildren).toEqual([]);
    });

    it('should return IDs of open children only', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col.id, 'Parent', '', '[]', 2, null, null, 1)!;

      // Create two open children
      tickets.createTicket(project.id, col.id, 'Child 1', '', '[]', 2, null, parent.id, 1)!;
      tickets.createTicket(project.id, col.id, 'Child 2', '', '[]', 2, null, parent.id, 1)!;

      // Create a closed child
      const db = getDb();
      db.prepare(
        'INSERT INTO tickets (project_id, parent_id, column_id, title, description, labels, priority, created_by_role_id, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(project.id, parent.id, col.id, 'Child Closed', '', '[]', 2, 1, '2025-01-01 00:00:00');

      const openChildren = TicketService.getOpenChildTicketIds(parent.id);
      expect(openChildren.length).toBe(2);
    });
  });

  describe('getUnresolvedDependencyIds', () => {
    it('should return empty array when no deps exist', () => {
      const unresolved = TicketService.getUnresolvedDependencyIds(999999);
      expect(unresolved).toEqual([]);
    });

    it('should return IDs of unresolved deps with blocked_by relation', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);

      // Create dependency ticket (open)
      const dep = tickets.createTicket(project.id, col.id, 'Dep Ticket', '', '[]', 2, null, null, 1)!;

      // Create target ticket
      const target = tickets.createTicket(project.id, col.id, 'Target', '', '[]', 2, null, null, 1)!;

      // Add blocked_by dependency
      tickets.addDependency(target.id, dep.id, 'blocked_by');

      const unresolved = TicketService.getUnresolvedDependencyIds(target.id);
      expect(unresolved).toContain(dep.id);
    });

    it('should return IDs of unresolved deps with depends_on relation', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);

      // Create dependency ticket (open)
      const dep = tickets.createTicket(project.id, col.id, 'Dep Ticket 2', '', '[]', 2, null, null, 1)!;

      // Create target ticket
      const target = tickets.createTicket(project.id, col.id, 'Target 2', '', '[]', 2, null, null, 1)!;

      // Add depends_on dependency
      tickets.addDependency(target.id, dep.id, 'depends_on');

      const unresolved = TicketService.getUnresolvedDependencyIds(target.id);
      expect(unresolved).toContain(dep.id);
    });

    it('should NOT return related dependency IDs', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);

      // Create related ticket (open)
      const related = tickets.createTicket(project.id, col.id, 'Related', '', '[]', 2, null, null, 1)!;

      // Create target ticket
      const target = tickets.createTicket(project.id, col.id, 'Target Related', '', '[]', 2, null, null, 1)!;

      // Add related dependency (should NOT block closure)
      tickets.addDependency(target.id, related.id, 'related');

      const unresolved = TicketService.getUnresolvedDependencyIds(target.id);
      expect(unresolved).not.toContain(related.id);
    });

    it('should NOT return IDs of closed dependency tickets', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);

      // Create a closed dependency ticket
      const db = getDb();
      db.prepare(
        'INSERT INTO tickets (project_id, parent_id, column_id, title, description, labels, priority, created_by_role_id, closed_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)'
      ).run(project.id, col.id, 'Closed Dep', '', '[]', 2, 1, '2025-01-01 00:00:00');
      const closedDep = db.prepare('SELECT id FROM tickets WHERE title = ?').get('Closed Dep') as { id: number };

      // Create target ticket
      const target = tickets.createTicket(project.id, col.id, 'Target Closed', '', '[]', 2, null, null, 1)!;

      // Add blocked_by dependency to closed ticket
      tickets.addDependency(target.id, closedDep.id, 'blocked_by');

      const unresolved = TicketService.getUnresolvedDependencyIds(target.id);
      expect(unresolved).not.toContain(closedDep.id);
    });
  });
});
