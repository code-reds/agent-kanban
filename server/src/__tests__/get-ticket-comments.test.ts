import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { createTicket, getTicketById, addComment } from '../db/queries/tickets.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-gtc-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  return project;
}

function getTodoColumnId(projectId: number) {
  const db = getDb();
  return db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, 'todo') as { id: number };
}

describe('getTicketById', () => {
  beforeEach(() => {
    initDb();
  });

  it('returns ticket with comments', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Description', '[]', 2, null, null, 1);
    expect(ticket).toBeDefined();

    addComment(ticket!.id, 1, 'First comment');
    addComment(ticket!.id, 1, 'Second comment');

    const result = getTicketById(ticket!.id);
    expect(result).toBeDefined();
    expect(result?.comments).toHaveLength(2);
    expect(result?.comments![0].content).toBe('First comment');
    expect(result?.comments![1].content).toBe('Second comment');
  });

  it('returns ticket with empty comments array when no comments exist', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'No Comments Ticket', 'No comments here', '[]', 2, null, null, 1);

    const result = getTicketById(ticket!.id);
    expect(result).toBeDefined();
    expect(result?.comments).toHaveLength(0);
  });

  it('returns ticket with dependencies and status history arrays', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Ticket With Relations', 'Has relations', '[]', 2, null, null, 1);

    const result = getTicketById(ticket!.id);
    expect(result).toBeDefined();
    expect(result?.comments).toBeDefined();
    expect(result?.dependencies).toBeDefined();
    expect(result?.status_history).toBeDefined();
  });

  it('includes column slug and name', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Column Test', '', '[]', 2, null, null, 1);

    const result = getTicketById(ticket!.id);
    expect(result?.column_slug).toBe('todo');
    expect(result?.column_name).toBe('To Do');
  });
});
