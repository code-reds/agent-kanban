import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { createTicket, addComment, getTicketById } from '../db/queries/tickets.js';
import { TicketService } from '../services/ticket-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-cmd-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  return project;
}

function getTodoColumnId(projectId: number) {
  const db = getDb();
  return db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, 'todo') as { id: number };
}

describe('TicketService.updateComment', () => {
  beforeEach(() => {
    initDb();
  });

  it('should return 404 when project not found', () => {
    const result = TicketService.updateComment('nonexistent', 1, 1, 'updated content', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
    expect(result.comment).toBeUndefined();
  });

  it('should return 404 when ticket not found', () => {
    const project = createProjectWithColumns();
    const result = TicketService.updateComment(project.slug, 99999, 1, 'updated content', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
    expect(result.comment).toBeUndefined();
  });

  it('should return 404 when comment not found', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const result = TicketService.updateComment(project.slug, ticket!.id, 99999, 'updated content', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
  });

  it('should return 404 when comment belongs to a different ticket', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket1 = createTicket(project.id, col.id, 'Ticket 1', 'Desc', '[]', 2, null, null, 1);
    const ticket2 = createTicket(project.id, col.id, 'Ticket 2', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket1!.id, 1, 'Original comment');

    const result = TicketService.updateComment(project.slug, ticket2!.id, comment!.id, 'updated content', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
  });

  it('should reject empty content', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, '', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.statusCode).toBe(400);
  });

  it('should reject whitespace-only content', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, '   ', { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.statusCode).toBe(400);
  });

  it('should allow comment author to update their comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original comment');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, 'Updated content', { role_id: 1 });
    expect(result.error).toBeUndefined();
    expect(result.comment).toBeDefined();
    expect(result.comment!.content).toBe('Updated content');
  });

  it('should allow Human User (role 1) to update any comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 2);
    const comment = addComment(ticket!.id, 2, 'Original comment');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, 'Updated by human', { role_id: 1 });
    expect(result.error).toBeUndefined();
    expect(result.comment).toBeDefined();
    expect(result.comment!.content).toBe('Updated by human');
  });

  it('should deny non-author role from updating a comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 2);
    const comment = addComment(ticket!.id, 2, 'Original comment');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, 'Hacked content', { role_id: 3 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('PERMISSION_DENIED');
    expect(result.statusCode).toBe(403);
  });

  it('should return enriched comment with author_role_name', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original');

    const result = TicketService.updateComment(project.slug, ticket!.id, comment!.id, 'Updated content', { role_id: 1 });
    expect(result.comment).toBeDefined();
    expect(result.comment).toHaveProperty('id');
    expect(result.comment).toHaveProperty('ticket_id');
    expect(result.comment).toHaveProperty('author_role_id');
    expect(result.comment).toHaveProperty('author_role_name');
    expect(result.comment).toHaveProperty('content', 'Updated content');
  });
});

describe('TicketService.deleteComment', () => {
  beforeEach(() => {
    initDb();
  });

  it('should return 404 when project not found', () => {
    const result = TicketService.deleteComment('nonexistent', 1, 1, { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
    expect(result.success).toBe(false);
  });

  it('should return 404 when ticket not found', () => {
    const project = createProjectWithColumns();
    const result = TicketService.deleteComment(project.slug, 99999, 1, { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
    expect(result.success).toBe(false);
  });

  it('should return 404 when comment not found', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const result = TicketService.deleteComment(project.slug, ticket!.id, 99999, { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
  });

  it('should return 404 when comment belongs to a different ticket', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket1 = createTicket(project.id, col.id, 'Ticket 1', 'Desc', '[]', 2, null, null, 1);
    const ticket2 = createTicket(project.id, col.id, 'Ticket 2', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket1!.id, 1, 'Original comment');

    const result = TicketService.deleteComment(project.slug, ticket2!.id, comment!.id, { role_id: 1 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
  });

  it('should allow comment author to delete their comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original comment');

    const result = TicketService.deleteComment(project.slug, ticket!.id, comment!.id, { role_id: 1 });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should allow Human User (role 1) to delete any comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 2);
    const comment = addComment(ticket!.id, 2, 'Original comment');

    const result = TicketService.deleteComment(project.slug, ticket!.id, comment!.id, { role_id: 1 });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should deny non-author role from deleting a comment', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 2);
    const comment = addComment(ticket!.id, 2, 'Original comment');

    const result = TicketService.deleteComment(project.slug, ticket!.id, comment!.id, { role_id: 3 });
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('PERMISSION_DENIED');
    expect(result.statusCode).toBe(403);
    expect(result.success).toBe(false);
  });

  it('should actually remove the comment from the database', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment = addComment(ticket!.id, 1, 'Original comment');

    const result = TicketService.deleteComment(project.slug, ticket!.id, comment!.id, { role_id: 1 });
    expect(result.success).toBe(true);

    // Verify comment is gone
    const updatedTicket = getTicketById(ticket!.id);
    expect(updatedTicket?.comments).toHaveLength(0);
  });

  it('should not affect other comments on the same ticket', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);
    const ticket = createTicket(project.id, col.id, 'Test Ticket', 'Desc', '[]', 2, null, null, 1);
    const comment1 = addComment(ticket!.id, 1, 'Comment 1');
    const comment2 = addComment(ticket!.id, 1, 'Comment 2');

    const result = TicketService.deleteComment(project.slug, ticket!.id, comment1!.id, { role_id: 1 });
    expect(result.success).toBe(true);

    const updatedTicket = getTicketById(ticket!.id);
    expect(updatedTicket?.comments).toHaveLength(1);
    expect(updatedTicket?.comments![0].id).toBe(comment2!.id);
  });
});

// Merged from get-ticket-comments.test.ts
describe('getTicketById — comment & relation fetching', () => {
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

  it('returns ticket with dependencies and status_history arrays', () => {
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
