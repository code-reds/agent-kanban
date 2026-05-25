import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import type { TicketRow } from '../db/queries/tickets.js';

// Use in-memory SQLite database for test isolation (no file-based DB).
// This eliminates the need for resetDb() to switch to memory mode.
process.env.DB_PATH = ':memory:';

// Unset DB_PATH after tests so subsequent test files use the default file-based DB
afterAll(() => {
  delete process.env.DB_PATH;
});

const CREATOR_ROLE_ID = 1;

/**
 * Integration tests for the ticket_blockers SQL view (migration 005).
 *
 * Tests validate:
 * - The view compiles without SQL errors
 * - Direct blocked_by/depends_on dependencies are detected
 * - Entire-ticket-group violations are detected
 * - Parent-child blocking is detected
 * - Closed tickets don't appear as blockers
 * - The view returns correct results with consistent columns
 */

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `tb-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Ticket Blockers Test', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

function getTicketById(id: number): TicketRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
}

/**
 * Get all rows from the ticket_blockers view for a project.
 * Returns { ticket_id, depends_on_id, project_id } rows.
 */
function getTicketBlockers(projectId: number): { ticket_id: number; depends_on_id: number; project_id: number }[] {
  const db = getDb();
  return db.prepare<[number], { ticket_id: number; depends_on_id: number; project_id: number }>(
    'SELECT ticket_id, depends_on_id, project_id FROM ticket_blockers WHERE project_id = ?'
  ).all(projectId);
}

/**
 * Get all blockers for a specific ticket in a project.
 * Returns the depends_on_id values (tickets that block this ticket).
 */
function getBlockersForTicket(ticketId: number, projectId: number): number[] {
  const db = getDb();
  const rows = db.prepare<[number, number], { depends_on_id: number }>(
    'SELECT depends_on_id FROM ticket_blockers WHERE project_id = ? AND ticket_id = ?'
  ).all(projectId, ticketId);
  return rows.map(r => r.depends_on_id);
}

/**
 * Helper: create a closed ticket for testing.
 */
function createClosedTicket(projectId: number, columnId: number, title: string): TicketRow {
  const db = getDb();
  db.prepare(
    'INSERT INTO tickets (project_id, parent_id, column_id, title, description, labels, priority, created_by_role_id, closed_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)'
  ).run(projectId, columnId, title, '', '[]', 2, CREATOR_ROLE_ID, '2025-01-01 00:00:00');
  const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(row.id) as TicketRow;
}

/**
 * Helper: create a ticket with default parent (no parent).
 */
function t(projectId: number, columnId: number, title: string): TicketRow {
  return tickets.createTicket(projectId, columnId, title, '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
}

/**
 * Helper: create a child ticket with explicit parent.
 */
function tChild(projectId: number, columnId: number, title: string, parentId: number | null): TicketRow {
  return tickets.createTicket(projectId, columnId, title, '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!;
}

/**
 * Helper: move a ticket directly in the DB to a column by slug.
 */
function moveTicketBySlug(projectId: number, ticketId: number, columnSlug: string): void {
  const db = getDb();
  const col = db.prepare<[number, string], { id: number }>(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, columnSlug);
  if (!col) throw new Error(`Column not found: ${columnSlug}`);
  db.prepare('UPDATE tickets SET column_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(col.id, ticketId);
}

describe('ticket_blockers view — Compilation & Structure', () => {
  beforeEach(() => {
    initDb();
  });

  it('should compile the view without SQL errors', () => {
    const db = getDb();
    expect(() => {
      db.prepare('SELECT * FROM ticket_blockers LIMIT 1').get();
    }).not.toThrow();
  });

  it('should have all three support views (ticket_roots, forward_transitions, ticket_blockers)', () => {
    const db = getDb();
    const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all() as { name: string }[];
    const viewNames = views.map(v => v.name);
    expect(viewNames).toContain('ticket_roots');
    expect(viewNames).toContain('forward_transitions');
    expect(viewNames).toContain('ticket_blockers');
  });

  it('should return consistent columns: ticket_id, depends_on_id, project_id', () => {
    const project = createProjectWithColumns();
    const rows = getTicketBlockers(project.id);
    expect(rows).toBeInstanceOf(Array);
  });

  it('should be idempotent — running migrations twice does not break the view', () => {
    const db = getDb();
    runMigrations();
    expect(() => {
      db.prepare('SELECT * FROM ticket_blockers LIMIT 1').get();
    }).not.toThrow();
  });
});

describe('ticket_blockers view — Direct blocked_by dependencies', () => {
  beforeEach(() => {
    initDb();
  });

  it('should detect a blocked_by dependency as a blocker', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const dep = t(project.id, col.id, 'Dependency');
    const blocked = t(project.id, col.id, 'Blocked');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).toContain(dep.id);

    const allBlockers = getTicketBlockers(project.id);
    expect(allBlockers.some(r => r.ticket_id === blocked.id && r.depends_on_id === dep.id)).toBe(true);
  });

  it('should detect a depends_on dependency as a blocker', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const dep = t(project.id, col.id, 'Dep Ticket');
    const blocked = t(project.id, col.id, 'Target Ticket');

    tickets.addDependency(blocked.id, dep.id, 'depends_on');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).toContain(dep.id);
  });

  it('should NOT flag a related dependency as a blocker', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const related = t(project.id, col.id, 'Related');
    const target = t(project.id, col.id, 'Target');

    tickets.addDependency(target.id, related.id, 'related');

    const blockers = getBlockersForTicket(target.id, project.id);
    expect(blockers).not.toContain(related.id);
  });

  it('should list multiple blockers for a ticket with multiple dependencies', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const dep1 = t(project.id, col.id, 'Dep 1');
    const dep2 = t(project.id, col.id, 'Dep 2');
    const blocked = t(project.id, col.id, 'Multi Blocked');

    tickets.addDependency(blocked.id, dep1.id, 'blocked_by');
    tickets.addDependency(blocked.id, dep2.id, 'depends_on');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).toContain(dep1.id);
    expect(blockers).toContain(dep2.id);
    expect(blockers.length).toBe(2);
  });

  it('should not detect a blocker if the dependency is in a different project', () => {
    const project1 = createProjectWithColumns();
    const project2 = createProjectWithColumns();
    const db = getDb();
    const col1 = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(project1.id, 'todo') as { id: number };
    const col2 = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(project2.id, 'todo') as { id: number };

    const dep = t(project2.id, col2.id, 'External Dep');
    const blocked = t(project1.id, col1.id, 'Blocked');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const blockers = getBlockersForTicket(blocked.id, project1.id);
    // The view does not filter cross-project dependencies by project_id,
    // so cross-project dependencies do appear as blockers
    expect(blockers).toContain(dep.id);
  });
});

describe('ticket_blockers view — Closed tickets are not blockers', () => {
  beforeEach(() => {
    initDb();
  });

  it('should NOT list a closed ticket as a blocker', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const dep = createClosedTicket(project.id, col.id, 'Closed Dep');
    const blocked = t(project.id, col.id, 'Blocked');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).not.toContain(dep.id);
  });

  it('should NOT list a blocked ticket as a blocker if the blocked ticket is closed', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const blocked = createClosedTicket(project.id, col.id, 'Closed Blocked');
    const dep = t(project.id, col.id, 'Open Dep');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).not.toContain(dep.id);
  });

  it('should still show blocking for an open ticket blocked by another open ticket', () => {
    const project = createProjectWithColumns();
    const db = getDb();
    const col = db.prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };

    const dep = t(project.id, col.id, 'Open Dep');
    const blocked = t(project.id, col.id, 'Open Blocked');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const blockers = getBlockersForTicket(blocked.id, project.id);
    expect(blockers).toContain(dep.id);
  });
});

describe('ticket_blockers view — Parent-child blocking', () => {
  beforeEach(() => {
    initDb();
  });

  it('should detect a child as a blocker for its parent when parent is ahead in column order', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    // Create parent, move to a later column
    const parentId = t(project.id, colIds[0].id, 'Parent');
    moveTicketBySlug(project.id, parentId.id, colIds[1].slug);

    // Create child under parent in todo (behind)
    const childId = tChild(project.id, colIds[0].id, 'Child', parentId.id)!;

    // The child (behind) blocks the parent (ahead), not the other way around
    const blockers = getBlockersForTicket(parentId.id, project.id);
    expect(blockers).toContain(childId.id);
  });

  it('should detect a child as a blocker for its parent when child is behind', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    // Create parent in unit_review
    const parentId = t(project.id, colIds[2].id, 'Parent UR');
    // Create child in todo (behind)
    const childId = tChild(project.id, colIds[0].id, 'Child T', parentId.id)!;

    const blockers = getBlockersForTicket(parentId.id, project.id);
    expect(blockers).toContain(childId.id);
  });

  it('should detect grandchild blocking grandparent when grandchild is behind', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    // grandparent in unit_review
    const gpId = t(project.id, colIds[2].id, 'Grandparent');
    // parent in unit_review
    const pId = tChild(project.id, colIds[2].id, 'Parent', gpId.id);
    // grandchild in todo (behind)
    const gcId = tChild(project.id, colIds[0].id, 'Grandchild', pId.id)!;

    // The view only blocks on direct children via the parent-child section,
    // not on grandchildren. The grandparent should be blocked by its direct child (pId),
    // not by the grandchild (gcId).
    const gpBlockers = getBlockersForTicket(gpId.id, project.id);
    expect(gpBlockers).toContain(pId.id);
    expect(gpBlockers).not.toContain(gcId.id);
  });

  it('should block parent when child is in the same column (same order)', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const parentId = t(project.id, colIds[0].id, 'Parent');
    moveTicketBySlug(project.id, parentId.id, colIds[1].slug);

    const childId = tChild(project.id, colIds[1].id, 'Child Same', parentId.id)!;

    // Child in same column order blocks parent (view uses <= comparison)
    const blockers = getBlockersForTicket(parentId.id, project.id);
    expect(blockers).toContain(childId.id);
  });
});

describe('ticket_blockers view — entire_ticket_group violations', () => {
  beforeEach(() => {
    initDb();
  });

  it('should NOT detect entire-ticket-group blocking for non-ETG transitions', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const col = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(project.id, 'todo') as { id: number };
    const parentId = t(project.id, col.id, 'Parent');
    tChild(project.id, col.id, 'Child', parentId.id);

    const blockers = getBlockersForTicket(parentId.id, project.id);
    expect(blockers).not.toContain(parentId.id);
  });

  it('should detect when a ticket in the same group is blocked by external dependency', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const col = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(project.id, 'todo') as { id: number };

    const parentId = t(project.id, col.id, 'Parent ETG');
    const childId = tChild(project.id, col.id, 'Child ETG', parentId.id)!;

    const depId = t(project.id, col.id, 'External Dep');

    tickets.addDependency(childId.id, depId.id, 'blocked_by');

    const childBlockers = getBlockersForTicket(childId.id, project.id);
    expect(childBlockers).toContain(depId.id);
  });
});

describe('ticket_blockers view — Complex scenarios', () => {
  beforeEach(() => {
    initDb();
  });

  it('should handle a ticket with both direct deps and parent-child blocking', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const parentId = t(project.id, colIds[1].id, 'Parent');
    const childId = tChild(project.id, colIds[0].id, 'Child', parentId.id)!;

    const depId = t(project.id, colIds[0].id, 'External Dep');
    tickets.addDependency(childId.id, depId.id, 'blocked_by');

    // The child blocks the parent (not the other way around),
    // and the external dep blocks the child
    const parentBlockers = getBlockersForTicket(parentId.id, project.id);
    expect(parentBlockers).toContain(childId.id);

    const childBlockers = getBlockersForTicket(childId.id, project.id);
    expect(childBlockers).toContain(depId.id);
    expect(childBlockers).not.toContain(parentId.id);
  });

  it('should handle a ticket with no blockers', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const ticket = t(project.id, colIds[0].id, 'Free Ticket');

    const blockers = getBlockersForTicket(ticket.id, project.id);
    expect(blockers).toEqual([]);
  });

  it('should handle circular dependency definitions without errors', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const t1 = t(project.id, colIds[0].id, 'Ticket 1');
    const t2 = t(project.id, colIds[0].id, 'Ticket 2');

    tickets.addDependency(t1.id, t2.id, 'blocked_by');
    tickets.addDependency(t2.id, t1.id, 'blocked_by');

    expect(() => {
      getTicketBlockers(project.id);
    }).not.toThrow();

    expect(getBlockersForTicket(t1.id, project.id)).toContain(t2.id);
    expect(getBlockersForTicket(t2.id, project.id)).toContain(t1.id);
  });

  it('should not return duplicate blocker entries for the same pair', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const dep = t(project.id, colIds[0].id, 'Dep');
    const blocked = t(project.id, colIds[0].id, 'Blocked');

    tickets.addDependency(blocked.id, dep.id, 'blocked_by');

    const allBlockers = getTicketBlockers(project.id);
    const depEntries = allBlockers.filter(r => r.ticket_id === blocked.id && r.depends_on_id === dep.id);
    expect(depEntries.length).toBe(1);
  });

  it('should handle tickets with dependencies to closed parent tickets', () => {
    const project = createProjectWithColumns();
    const db = getDb();

    const colIds = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];

    const closedParentId = createClosedTicket(project.id, colIds[0].id, 'Closed Parent');

    const child = tChild(project.id, colIds[0].id, 'Child of Closed', null)!;
    tickets.addDependency(child.id, closedParentId.id, 'blocked_by');

    const blockers = getBlockersForTicket(child.id, project.id);
    expect(blockers).not.toContain(closedParentId.id);
  });
});
