import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import { createColumn, getColumnBySlug } from '../db/queries/kanban.js';
import type { TicketRow, CommentRow, DependencyRow, StatusHistoryRow } from '../db/queries/tickets.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-tq-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  return project;
}

describe('Tickets Query Functions', () => {
  beforeEach(() => {
    initDb();
  });

  function getTodoColumnId(projectId: number) {
    const db = getDb();
    return db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, 'todo') as { id: number };
  }

  describe('getTicketsByProject', () => {
    it('should return empty array when no tickets exist', () => {
      const project = createProjectWithColumns();
      const result = tickets.getTicketsByProject(project.id);
      expect(result.tickets).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should return tickets for a project', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Ticket 1', 'desc', '[]', 2, null, null, 1);
      tickets.createTicket(project.id, col.id, 'Ticket 2', 'desc2', '[]', 3, null, null, 1);
      const result = tickets.getTicketsByProject(project.id);
      expect(result.tickets).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by column slug', () => {
      const project = createProjectWithColumns();
      const db = getDb();
      const todoCol = getTodoColumnId(project.id);
      const implCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('implementation', project.id) as { id: number };
      tickets.createTicket(project.id, todoCol.id, 'Todo Ticket', '', '[]', 2, null, null, 1);
      tickets.createTicket(project.id, implCol.id, 'Impl Ticket', '', '[]', 2, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, 'todo');
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0].title).toBe('Todo Ticket');
    });

    it('should filter by priority', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Low', '', '[]', 1, null, null, 1);
      tickets.createTicket(project.id, col.id, 'High', '', '[]', 4, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, 4);
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0].title).toBe('High');
    });

    it('should filter by labels', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Labeled', '', JSON.stringify(['bug']), 2, null, null, 1);
      tickets.createTicket(project.id, col.id, 'Not Labeled', '', JSON.stringify(['feature']), 2, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, undefined, 'bug');
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0].title).toBe('Labeled');
    });

    it('should filter by parent_id', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col.id, 'Parent', '', '[]', 2, null, null, 1);
      tickets.createTicket(project.id, col.id, 'Child', '', '[]', 2, null, parent!.id, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, parent!.id);
      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0].title).toBe('Child');
    });

    it('should paginate results', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      for (let i = 0; i < 5; i++) {
        tickets.createTicket(project.id, col.id, `Ticket ${i}`, '', '[]', 2, null, null, 1);
      }
      const page1 = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, undefined, 1, 2);
      expect(page1.tickets).toHaveLength(2);
      expect(page1.total).toBe(5);
      const page2 = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, undefined, 2, 2);
      expect(page2.tickets).toHaveLength(2);
    });

    it('should sort by priority desc', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Low', '', '[]', 1, null, null, 1);
      tickets.createTicket(project.id, col.id, 'High', '', '[]', 4, null, null, 1);
      tickets.createTicket(project.id, col.id, 'Normal', '', '[]', 2, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, undefined, 1, 10, 'priority', 'desc');
      expect(result.tickets[0].priority).toBe(4);
      expect(result.tickets[1].priority).toBe(2);
      expect(result.tickets[2].priority).toBe(1);
    });

    it('should sort by priority asc', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Low', '', '[]', 1, null, null, 1);
      tickets.createTicket(project.id, col.id, 'High', '', '[]', 4, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, undefined, 1, 10, 'priority', 'asc');
      expect(result.tickets[0].priority).toBe(1);
      expect(result.tickets[1].priority).toBe(4);
    });

    it('should not allow SQL injection in sort field', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      tickets.createTicket(project.id, col.id, 'Safe', '', '[]', 2, null, null, 1);
      const result = tickets.getTicketsByProject(project.id, undefined, undefined, undefined, undefined, 1, 10, 'invalid_field; DROP TABLE tickets', 'desc');
      expect(result.tickets).toHaveLength(1);
    });
  });

  describe('getTicketById', () => {
    it('should return undefined for non-existent ticket', () => {
      const result = tickets.getTicketById(9999);
      expect(result).toBeUndefined();
    });

    it('should return ticket with comments and dependencies', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col.id, 'Ticket 1', 'desc', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col.id, 'Ticket 2', 'desc', '[]', 2, null, null, 1);
      tickets.addComment(t1!.id, 1, 'Comment 1');
      tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      const result = tickets.getTicketById(t1!.id);
      expect(result).toBeDefined();
      expect(result!.title).toBe('Ticket 1');
      expect(result!.comments).toHaveLength(1);
      expect(result!.dependencies).toHaveLength(1);
      expect(result!.comments![0].content).toBe('Comment 1');
      expect(result!.dependencies![0].depends_on_id).toBe(t2!.id);
    });

    it('should return ticket without optional relations when none exist', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t = tickets.createTicket(project.id, col.id, 'Standalone', '', '[]', 2, null, null, 1);
      const result = tickets.getTicketById(t!.id);
      expect(result).toBeDefined();
      expect(result!.comments).toHaveLength(0);
      expect(result!.dependencies).toHaveLength(0);
      expect(result!.status_history).toHaveLength(0);
    });
  });

  describe('createTicket', () => {
    it('should create a ticket with defaults', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'New Ticket', '', '[]', 2, null, null, 1);
      expect(ticket).toBeDefined();
      expect(ticket!.title).toBe('New Ticket');
      expect(ticket!.description).toBe('');
      expect(ticket!.labels).toBe('[]');
      expect(ticket!.priority).toBe(2);
      expect(ticket!.estimate).toBeNull();
    });

    it('should create a ticket with all fields', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Full Ticket', 'A description', JSON.stringify(['bug']), 4, '8.0', null, 1);
      expect(ticket!.title).toBe('Full Ticket');
      expect(ticket!.description).toBe('A description');
      expect(ticket!.labels).toBe(JSON.stringify(['bug']));
      expect(ticket!.priority).toBe(4);
      expect(ticket!.estimate).toBe('8.0');
    });

    it('should create a child ticket', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col.id, 'Parent', '', '[]', 2, null, null, 1);
      const child = tickets.createTicket(project.id, col.id, 'Child', '', '[]', 2, null, parent!.id, 1);
      expect(child!.parent_id).toBe(parent!.id);
    });
  });

  describe('updateTicket', () => {
    it('should update title', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Old Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, 'New Title');
      expect(updated!.title).toBe('New Title');
    });

    it('should update description', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, undefined, 'New description');
      expect(updated!.description).toBe('New description');
    });

    it('should update priority', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, undefined, undefined, undefined, 4);
      expect(updated!.priority).toBe(4);
    });

    it('should update labels', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, undefined, undefined, JSON.stringify(['feat']));
      expect(updated!.labels).toBe(JSON.stringify(['feat']));
    });

    it('should update estimate', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, undefined, undefined, undefined, undefined, '12.0');
      expect(updated!.estimate).toBe('12.0');
    });

    it('should update multiple fields at once', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const updated = tickets.updateTicket(ticket!.id, 'New Title', 'New desc', JSON.stringify(['bug']), 4, '8.0');
      expect(updated!.title).toBe('New Title');
      expect(updated!.description).toBe('New desc');
      expect(updated!.priority).toBe(4);
      expect(updated!.estimate).toBe('8.0');
    });

    it('should return undefined for non-existent ticket', () => {
      const result = tickets.updateTicket(9999, 'New Title');
      expect(result).toBeUndefined();
    });
  });

  describe('addComment', () => {
    it('should add a comment to a ticket', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const comment = tickets.addComment(ticket!.id, 1, 'Hello world');
      expect(comment).toBeDefined();
      expect(comment!.content).toBe('Hello world');
      expect(comment!.ticket_id).toBe(ticket!.id);
      expect(comment!.author_role_id).toBe(1);
    });

    it('should add a comment with action_type', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const comment = tickets.addComment(ticket!.id, 1, 'Moved to implementation', 'move', JSON.stringify({ from: 'todo', to: 'implementation' }));
      expect(comment!.action_type).toBe('move');
      expect(comment!.action_details).toBe(JSON.stringify({ from: 'todo', to: 'implementation' }));
    });
  });

  describe('getCommentsByTicket', () => {
    it('should return empty array when no comments', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const comments = tickets.getCommentsByTicket(ticket!.id);
      expect(comments).toHaveLength(0);
    });

    it('should return comments in chronological order', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      tickets.addComment(ticket!.id, 1, 'First comment');
      tickets.addComment(ticket!.id, 1, 'Second comment');
      const comments = tickets.getCommentsByTicket(ticket!.id);
      expect(comments).toHaveLength(2);
      expect(comments[0].content).toBe('First comment');
      expect(comments[1].content).toBe('Second comment');
    });
  });

  describe('addDependency', () => {
    it('should add a dependency', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col.id, 'T1', '', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col.id, 'T2', '', '[]', 2, null, null, 1);
      const result = tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      expect(result).toBe(true);
      const deps = tickets.getDependencies(t1!.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].depends_on_id).toBe(t2!.id);
      expect(deps[0].relation_type).toBe('blocked_by');
    });

    it('should return false on duplicate dependency', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col.id, 'T1', '', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col.id, 'T2', '', '[]', 2, null, null, 1);
      tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      const result = tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      expect(result).toBe(false);
    });
  });

  describe('removeDependency', () => {
    it('should remove a dependency', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col.id, 'T1', '', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col.id, 'T2', '', '[]', 2, null, null, 1);
      tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      const result = tickets.removeDependency(t1!.id, t2!.id, 'blocked_by');
      expect(result).toBe(true);
      const deps = tickets.getDependencies(t1!.id);
      expect(deps).toHaveLength(0);
    });
  });

  describe('getDependencies', () => {
    it('should return all dependencies for a ticket', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col.id, 'T1', '', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col.id, 'T2', '', '[]', 2, null, null, 1);
      const t3 = tickets.createTicket(project.id, col.id, 'T3', '', '[]', 2, null, null, 1);
      tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      tickets.addDependency(t1!.id, t3!.id, 'related');
      const deps = tickets.getDependencies(t1!.id);
      expect(deps).toHaveLength(2);
    });
  });

  describe('addStatusHistory', () => {
    it('should add a status history entry', () => {
      const project = createProjectWithColumns();
      const db = getDb();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const colImpl = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('implementation', project.id) as { id: number };
      const history = tickets.addStatusHistory(ticket!.id, col.id, colImpl.id, 1, null);
      expect(history).toBeDefined();
      expect(history!.ticket_id).toBe(ticket!.id);
      expect(history!.from_column_id).toBe(col.id);
      expect(history!.to_column_id).toBe(colImpl.id);
      expect(history!.actor_role_id).toBe(1);
    });

    it('should record with comment_id', () => {
      const project = createProjectWithColumns();
      const db = getDb();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col.id, 'Title', '', '[]', 2, null, null, 1);
      const colImpl = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('implementation', project.id) as { id: number };
      const comment = tickets.addComment(ticket!.id, 1, 'Moving to implementation', 'move', null);
      const history = tickets.addStatusHistory(ticket!.id, col.id, colImpl.id, 1, comment!.id);
      expect(history!.comment_id).toBe(comment!.id);
    });
  });

  describe('getColumnBySlug', () => {
    it('should find column by slug and project id', () => {
      const project = createProjectWithColumns();
      const result = getColumnBySlug('todo', project.id);
      expect(result).toBeDefined();
      expect(result!.id).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent column', () => {
      const project = createProjectWithColumns();
      const result = getColumnBySlug('nonexistent', project.id);
      expect(result).toBeUndefined();
    });
  });

  describe('workflow functions', () => {
    it('should return workflow for project with seeded columns', () => {
      const project = createProjectWithColumns();
      const workflow = tickets.getWorkflowForProject(project.id);
      expect(workflow).toHaveLength(19);
    });

    it('should create and retrieve a transition', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const customCol = createColumn(project.id, 'custom-col', 'Custom Column', 99, false);
      const result = tickets.createTransition(project.id, col.id, customCol!.id, false);
      expect(result).toBeDefined();
      const workflow = tickets.getWorkflowForProject(project.id);
      expect(workflow.length).toBe(20);
      expect(workflow.find(w => w.column_from === col.id && w.column_to === customCol!.id)).toBeDefined();
    });

    it('should delete a transition', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const customCol = createColumn(project.id, 'custom-col-2', 'Custom Column 2', 98, false);
      const result = tickets.createTransition(project.id, col.id, customCol!.id, false);
      const deleted = tickets.deleteTransition(result!.id);
      expect(deleted).toBe(true);
      const workflow = tickets.getWorkflowForProject(project.id);
      expect(workflow.length).toBe(19);
    });

    it('should add allowed role to transition', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const customCol = createColumn(project.id, 'custom-col-3', 'Custom Column 3', 97, false);
      const result = tickets.createTransition(project.id, col.id, customCol!.id, false);
      const added = tickets.addTransitionAllowedRole(result!.id, 1);
      expect(added).toBe(true);
    });

    it('should remove allowed role from transition', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const customCol = createColumn(project.id, 'custom-col-4', 'Custom Column 4', 96, false);
      const result = tickets.createTransition(project.id, col.id, customCol!.id, false);
      tickets.addTransitionAllowedRole(result!.id, 1);
      const removed = tickets.removeTransitionAllowedRole(result!.id, 1);
      expect(removed).toBe(true);
    });
  });

  describe('access rules', () => {
    it('should create and retrieve access rules', () => {
      const project = createProjectWithColumns();
      const customCol = createColumn(project.id, 'custom-col-ar', 'Custom Column AR', 95, false);
      tickets.createAccessRules([{ columnId: customCol!.id, roleId: 1, actionType: 'create' }], project.id);
      const rules = tickets.getAccessRulesByProject(project.id);
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe('deleteTicket', () => {
    it('should delete a ticket', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col!.id, 'ToDelete', '', '[]', 2, null, null, 1);
      const result = tickets.deleteTicket(ticket!.id);
      expect(result).toBe(true);
      const found = tickets.getTicketById(ticket!.id);
      expect(found).toBeUndefined();
    });

    it('should return false for non-existent ticket', () => {
      const result = tickets.deleteTicket(99999);
      expect(result).toBe(false);
    });

    it('should cascade delete comments when ticket is deleted', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col!.id, 'With Comments', '', '[]', 2, null, null, 1);
      tickets.addComment(ticket!.id, 1, 'Comment 1');
      tickets.addComment(ticket!.id, 1, 'Comment 2');
      tickets.addComment(ticket!.id, 1, 'Comment 3');

      const commentsBefore = tickets.getCommentsByTicket(ticket!.id);
      expect(commentsBefore).toHaveLength(3);

      tickets.deleteTicket(ticket!.id);
      const commentsAfter = tickets.getCommentsByTicket(ticket!.id);
      expect(commentsAfter).toHaveLength(0);
    });

    it('should cascade delete dependencies (both directions) when ticket is deleted', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const t1 = tickets.createTicket(project.id, col!.id, 'T1', '', '[]', 2, null, null, 1);
      const t2 = tickets.createTicket(project.id, col!.id, 'T2', '', '[]', 2, null, null, 1);
      const t3 = tickets.createTicket(project.id, col!.id, 'T3', '', '[]', 2, null, null, 1);

      // T1 depends on T2 (T1 -> T2)
      tickets.addDependency(t1!.id, t2!.id, 'blocked_by');
      // T3 depends on T1 (T3 -> T1)
      tickets.addDependency(t3!.id, t1!.id, 'blocked_by');

      expect(tickets.getDependencies(t1!.id)).toHaveLength(1);
      expect(tickets.getDependencies(t3!.id)).toHaveLength(1);

      tickets.deleteTicket(t1!.id);

      // Both dependency directions should be removed
      expect(tickets.getDependencies(t1!.id)).toHaveLength(0);
      expect(tickets.getDependencies(t3!.id)).toHaveLength(0);
    });

    it('should cascade delete status history when ticket is deleted', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const db = getDb();
      const ticket = tickets.createTicket(project.id, col!.id, 'With History', '', '[]', 2, null, null, 1);
      const doneCol = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('done', project.id)! as { id: number };

      tickets.addStatusHistory(ticket!.id, col!.id, doneCol.id, 1, null);
      tickets.addStatusHistory(ticket!.id, col!.id, doneCol.id, 1, null);

      // Verify status history exists before delete
      const before = tickets.getTicketById(ticket!.id);
      expect(before!.status_history).toHaveLength(2);

      tickets.deleteTicket(ticket!.id);
      expect(tickets.getTicketById(ticket!.id)).toBeUndefined();
      // Status history should be gone via ON DELETE CASCADE
         expect(db.prepare('SELECT COUNT(*) as c FROM ticket_status_history').get() as { c: number }).toEqual({ c: 0 });
    });

    it('should cascade delete sub-tickets when parent ticket is deleted', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col!.id, 'Parent', '', '[]', 2, null, null, 1);
      const child1 = tickets.createTicket(project.id, col!.id, 'Child 1', '', '[]', 2, null, parent!.id, 1);
      const child2 = tickets.createTicket(project.id, col!.id, 'Child 2', '', '[]', 2, null, parent!.id, 1);

      expect(tickets.getChildTickets(parent!.id)).toHaveLength(2);

      tickets.deleteTicket(parent!.id);

      // Parent is gone
      expect(tickets.getTicketById(parent!.id)).toBeUndefined();
      // Children should also be gone via ON DELETE CASCADE on parent_id FK
      expect(tickets.getTicketById(child1!.id)).toBeUndefined();
      expect(tickets.getTicketById(child2!.id)).toBeUndefined();
    });
  });

  describe('sub-ticket queries', () => {
    it('should find child tickets by parent_id', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const parent = tickets.createTicket(project.id, col!.id, 'Parent', '', '[]', 2, null, null, 1);
      tickets.createTicket(project.id, col!.id, 'Child 1', '', '[]', 2, null, parent!.id, 1);
      tickets.createTicket(project.id, col!.id, 'Child 2', '', '[]', 2, null, parent!.id, 1);
      tickets.createTicket(project.id, col!.id, 'Standalone', '', '[]', 2, null, null, 1);
      const children = tickets.getChildTickets(parent!.id);
      expect(children).toHaveLength(2);
      expect(children.map(c => c.title)).toContain('Child 1');
      expect(children.map(c => c.title)).toContain('Child 2');
    });

    it('should return empty array when no children exist', () => {
      const project = createProjectWithColumns();
      const col = getTodoColumnId(project.id);
      const ticket = tickets.createTicket(project.id, col!.id, 'No Children', '', '[]', 2, null, null, 1);
      const children = tickets.getChildTickets(ticket!.id);
      expect(children).toHaveLength(0);
    });
  });
});

const db = getDb();
