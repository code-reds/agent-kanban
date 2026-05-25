import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import { TicketService } from '../services/ticket-service.js';
import type { TicketRow } from '../db/queries/tickets.js';

// Use in-memory SQLite database for test isolation
process.env.DB_PATH = ':memory:';

afterAll(() => {
  delete process.env.DB_PATH;
});

const CREATOR_ROLE_ID = 1;

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `opt-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Optimization Test', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

function t(projectId: number, columnId: number, title: string): TicketRow {
  return tickets.createTicket(projectId, columnId, title, '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
}

function createClosedTicket(projectId: number, columnId: number, title: string): TicketRow {
  const db = getDb();
  db.prepare(
    'INSERT INTO tickets (project_id, parent_id, column_id, title, description, labels, priority, created_by_role_id, closed_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)'
  ).run(projectId, columnId, title, '', '[]', 2, CREATOR_ROLE_ID, '2025-01-01 00:00:00');
  const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(row.id) as TicketRow;
}

function getColId(projectId: number, slug: string): number {
  const db = getDb();
  return (db.prepare<[number, string], { id: number }>(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, slug) as { id: number })?.id!;
}

describe('listByMode not-blocked — Optimized EXISTS query', () => {
  beforeEach(() => {
    initDb();
  });

  it('should return only unblocked tickets (not-blocked mode)', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const dep = t(project.id, colId, 'Dependency');
    const blocked = t(project.id, colId, 'Blocked Ticket');
    const free = t(project.id, colId, 'Free Ticket');

    // Create dependency: blocked depends on dep
    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    // Should not include the blocked ticket
    const blockedFound = result.tickets.some((t) => t.id === blocked.id);
    expect(blockedFound).toBe(false);

    // Should include the free ticket
    const freeFound = result.tickets.some((t) => t.id === free.id);
    expect(freeFound).toBe(true);

    // Should include the dependency itself (it's not blocked)
    const depFound = result.tickets.some((t) => t.id === dep.id);
    expect(depFound).toBe(true);

    expect(result.total).toBe(2);
  });

  it('should exclude closed tickets from not-blocked mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const open = t(project.id, colId, 'Open Ticket');
    createClosedTicket(project.id, colId, 'Closed Ticket');

    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    const closedFound = result.tickets.some((t) => t.title === 'Closed Ticket');
    expect(closedFound).toBe(false);

    const openFound = result.tickets.some((t) => t.id === open.id);
    expect(openFound).toBe(true);
  });

  it('should exclude human_feedback column from not-blocked mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');
    const feedbackColId = getColId(project.id, 'human_feedback');

    const todoTicket = t(project.id, colId, 'Todo Ticket');
    const feedbackTicket = t(project.id, feedbackColId, 'Feedback Ticket');

    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    const feedbackFound = result.tickets.some((t) => t.id === feedbackTicket.id);
    expect(feedbackFound).toBe(false);

    const todoFound = result.tickets.some((t) => t.id === todoTicket.id);
    expect(todoFound).toBe(true);
  });

  it('should exclude done column from not-blocked mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');
    const doneColId = getColId(project.id, 'done');

    const todoTicket = t(project.id, colId, 'Todo Ticket');
    const doneTicket = t(project.id, doneColId, 'Done Ticket');

    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    const doneFound = result.tickets.some((t) => t.id === doneTicket.id);
    expect(doneFound).toBe(false);

    const todoFound = result.tickets.some((t) => t.id === todoTicket.id);
    expect(todoFound).toBe(true);
  });

  it('should respect column filter in not-blocked mode with EXISTS query', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');
    const implColId = getColId(project.id, 'implementation');

    const todoTicket = t(project.id, colId, 'Todo Ticket');
    const implTicket = t(project.id, implColId, 'Impl Ticket');

    const result = TicketService.listByMode(project.id, 'not-blocked', {
      column: 'todo',
    });

    expect(result.tickets.length).toBe(1);
    expect(result.tickets[0].id).toBe(todoTicket.id);
  });

  it('should respect priority filter in not-blocked mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    // Create tickets with different priorities
    tickets.createTicket(project.id, colId, 'Priority 1 Ticket', '', '[]', 1, null, null, CREATOR_ROLE_ID);
    tickets.createTicket(project.id, colId, 'Priority 3 Ticket', '', '[]', 3, null, null, CREATOR_ROLE_ID);

    const result = TicketService.listByMode(project.id, 'not-blocked', {
      priority: 1,
    });

    expect(result.total).toBe(1);
  });

  it('should handle pagination correctly with EXISTS query', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    for (let i = 0; i < 5; i++) {
      t(project.id, colId, `Ticket ${i}`);
    }

    const result1 = TicketService.listByMode(project.id, 'not-blocked', {
      page: 1,
      per_page: 2,
    });

    expect(result1.tickets.length).toBe(2);
    expect(result1.total).toBe(5);

    const result2 = TicketService.listByMode(project.id, 'not-blocked', {
      page: 2,
      per_page: 2,
    });

    expect(result2.tickets.length).toBe(2);
    expect(result2.total).toBe(5);
  });

  it('should handle multiple blocked tickets correctly', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const blocker = t(project.id, colId, 'Blocker');
    const blocked1 = t(project.id, colId, 'Blocked 1');
    const blocked2 = t(project.id, colId, 'Blocked 2');
    const free = t(project.id, colId, 'Free Ticket');

    tickets.addDependency(blocked1.id, blocker.id, 'blocked_by');
    tickets.addDependency(blocked2.id, blocker.id, 'blocked_by');

    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    expect(result.total).toBe(2); // blocker + free
    expect(result.tickets.some((t) => t.id === blocked1.id)).toBe(false);
    expect(result.tickets.some((t) => t.id === blocked2.id)).toBe(false);
  });

  it('should handle closed tickets that are blockers correctly', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const closedDep = createClosedTicket(project.id, colId, 'Closed Dependency');
    const ticketBlockedByClosed = t(project.id, colId, 'Depends on Closed');
    const free = t(project.id, colId, 'Free');

    // blockedByClosed depends on closedDep via blocked_by
    tickets.addDependency(ticketBlockedByClosed.id, closedDep.id, 'blocked_by');

    // The closed dependency should NOT block the ticket (closed deps don't block)
    const result = TicketService.listByMode(project.id, 'not-blocked', {});

    // ticketBlockedByClosed should be included because the blocker is closed
    const included = result.tickets.some((t) => t.id === ticketBlockedByClosed.id);
    expect(included).toBe(true);

    expect(result.total).toBe(2); // ticketBlockedByClosed + free
  });
});

describe('listByMode todo-list with ticket_ids — Excludes closed and human_feedback', () => {
  beforeEach(() => {
    initDb();
  });

  it('should exclude closed tickets from todo-list mode even when ticket_ids includes them', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const open = t(project.id, colId, 'Open Ticket');
    const closed = createClosedTicket(project.id, colId, 'Closed Ticket');

    const result = TicketService.listByMode(project.id, 'todo-list', {
      ticket_ids: [open.id, closed.id],
    });

    const closedFound = result.tickets.some((t) => t.id === closed.id);
    expect(closedFound).toBe(false);

    const openFound = result.tickets.some((t) => t.id === open.id);
    expect(openFound).toBe(true);
    expect(result.total).toBe(1);
  });

  it('should exclude human_feedback column from todo-list mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');
    const feedbackColId = getColId(project.id, 'human_feedback');

    const todoTicket = t(project.id, colId, 'Todo Ticket');
    const feedbackTicket = t(project.id, feedbackColId, 'Feedback Ticket');

    const result = TicketService.listByMode(project.id, 'todo-list', {
      ticket_ids: [todoTicket.id, feedbackTicket.id],
    });

    const feedbackFound = result.tickets.some((t) => t.id === feedbackTicket.id);
    expect(feedbackFound).toBe(false);

    const todoFound = result.tickets.some((t) => t.id === todoTicket.id);
    expect(todoFound).toBe(true);
  });

  it('should apply priority and labels filters in todo-list with ticket_ids', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const t1 = t(project.id, colId, 'P1 Bug'); // labels: []
    const t2 = t(project.id, colId, 'P2 Feature');
    const t3 = t(project.id, colId, 'P1 Feature');

    // Update labels for t1
    tickets.updateTicket(t1.id, undefined, undefined, JSON.stringify(['bug']), 1, null, null);
    tickets.updateTicket(t2.id, undefined, undefined, JSON.stringify(['feature']), 2, null, null);
    tickets.updateTicket(t3.id, undefined, undefined, JSON.stringify(['feature']), 1, null, null);

    const result = TicketService.listByMode(project.id, 'todo-list', {
      ticket_ids: [t1.id, t2.id, t3.id],
      priority: 1,
    });

    expect(result.total).toBe(2);
    expect(result.tickets.some((t) => t.id === t1.id)).toBe(true);
    expect(result.tickets.some((t) => t.id === t3.id)).toBe(true);
  });

  it('should apply labels filter with ticket_ids in todo-list mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const t1 = t(project.id, colId, 'Bug Ticket');
    const t2 = t(project.id, colId, 'Feature Ticket');

    tickets.updateTicket(t1.id, undefined, undefined, JSON.stringify(['bug']), 2, null, null);
    tickets.updateTicket(t2.id, undefined, undefined, JSON.stringify(['feature']), 2, null, null);

    const result = TicketService.listByMode(project.id, 'todo-list', {
      ticket_ids: [t1.id, t2.id],
      labels: 'bug',
    });

    expect(result.total).toBe(1);
    expect(result.tickets[0].id).toBe(t1.id);
  });

  it('should paginate correctly in todo-list mode', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ticket = t(project.id, colId, `Ticket ${i}`);
      ids.push(ticket.id);
    }

    const result = TicketService.listByMode(project.id, 'todo-list', {
      ticket_ids: ids,
      page: 1,
      per_page: 2,
    });

    expect(result.tickets.length).toBe(2);
    expect(result.total).toBe(5);
  });
});

describe('list() with filterBlocked — Excludes closed, human_feedback, and blocked', () => {
  beforeEach(() => {
    initDb();
  });

  it('should exclude closed tickets when filterBlocked is true', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    const open = t(project.id, colId, 'Open Ticket');
    createClosedTicket(project.id, colId, 'Closed Ticket');

    const result = TicketService.list(project.slug!, {
      filterBlocked: true,
    });

    const closedFound = result.tickets.some((t) => t.title === 'Closed Ticket');
    expect(closedFound).toBe(false);

    const openFound = result.tickets.some((t) => t.id === open.id);
    expect(openFound).toBe(true);
  });

  it('should include all tickets when filterBlocked is false', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');

    t(project.id, colId, 'Open Ticket');
    createClosedTicket(project.id, colId, 'Closed Ticket');

    const result = TicketService.list(project.slug!, {
      filterBlocked: false,
    });

    expect(result.tickets.length).toBe(2);
  });

  it('should exclude human_feedback column when filterBlocked is true', () => {
    const project = createProjectWithColumns();
    const colId = getColId(project.id, 'todo');
    const feedbackColId = getColId(project.id, 'human_feedback');

    const todoTicket = t(project.id, colId, 'Todo Ticket');
    const feedbackTicket = t(project.id, feedbackColId, 'Feedback Ticket');

    const result = TicketService.list(project.slug!, {
      filterBlocked: true,
    });

    const feedbackFound = result.tickets.some((t) => t.id === feedbackTicket.id);
    expect(feedbackFound).toBe(false);

    const todoFound = result.tickets.some((t) => t.id === todoTicket.id);
    expect(todoFound).toBe(true);
  });
});
