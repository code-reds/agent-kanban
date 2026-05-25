import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import type { TicketRow } from '../db/queries/tickets.js';
import { TicketService } from '../services/ticket-service.js';

// Use in-memory SQLite database for test isolation.
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

let currentProjectSlug: string | undefined;

function createProjectWithColumns() {
  const db = getDb();
  const slug = `dep-test-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Dependency Test', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  currentProjectSlug = project.slug;
  return project;
}

function t(projectId: number, columnId: number, title: string): TicketRow {
  return tickets.createTicket(projectId, columnId, title, '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
}

function tChild(projectId: number, columnId: number, title: string, parentId: number | null): TicketRow {
  return tickets.createTicket(projectId, columnId, title, '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!;
}

function getTodoColumnId(projectId: number): number {
  const db = getDb();
  return db.prepare<[number, string], { id: number }>(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, 'todo')!.id;
}

describe('addDependency — Cycle Detection (Tarjan\'s SCC)', () => {
  beforeEach(() => {
    initDb();
  });

  it('should allow a simple linear dependency (A depends_on B)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');

    const result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);
  });

  it('should detect and reject a direct cycle (A -> B -> A)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');

    // Add A -> B (A depends_on B)
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now add B -> A (B depends_on A) — should be rejected
    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketA.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
    expect(result.error).toBeDefined();
    expect(result.statusCode).toBe(409);
  });

  it('should detect and reject a 3-node cycle (A -> B -> C -> A)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');
    const ticketC = t(project.id, colId, 'Ticket C');

    // Build chain: A -> B, B -> C
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketC.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now add C -> A — should create a cycle
    result = TicketService.addDependency(
      project.slug as string,
      ticketC.id,
      ticketA.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should detect and reject a 4-node cycle (A -> B -> C -> D -> A)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const tickets_arr = [
      t(project.id, colId, 'Ticket A'),
      t(project.id, colId, 'Ticket B'),
      t(project.id, colId, 'Ticket C'),
      t(project.id, colId, 'Ticket D'),
    ];

    // Build chain: A -> B, B -> C, C -> D
    for (let i = 0; i < 3; i++) {
      const result = TicketService.addDependency(
        project.slug as string,
        tickets_arr[i].id,
        tickets_arr[i + 1].id,
        'blocked_by'
      );
      expect(result.success).toBe(true);
    }

    // Now add D -> A — should create a cycle
    const result = TicketService.addDependency(
      project.slug as string,
      tickets_arr[3].id,
      tickets_arr[0].id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should allow adding a non-cyclic dependency after existing linear deps', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');
    const ticketC = t(project.id, colId, 'Ticket C');

    // Build chain: A -> B, B -> C
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketC.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now add A -> C — should NOT create a cycle (A already transitively depends on C)
    // This is a redundant dependency, but not a cycle
    result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketC.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);
  });

  it('should detect cycle with indirect path (A -> B, A -> C, then B -> C creates cycle)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');
    const ticketC = t(project.id, colId, 'Ticket C');

    // A -> B
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // A -> C (both depend on B and C)
    result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketC.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now B -> C — should NOT create a cycle (no path from C back to B)
    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketC.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now C -> B — should create a cycle
    result = TicketService.addDependency(
      project.slug as string,
      ticketC.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should detect cycle via depends_on relation type', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');

    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'depends_on'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketA.id,
      'depends_on'
    );
    expect(result.success).toBe(false);
  });

  it('should reject parent depending on child (parent-child hierarchy)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    // Create a parent ticket and child ticket
    const parent = t(project.id, colId, 'Parent');
    const child = tChild(project.id, colId, 'Child', parent.id)!;

    // Parent depending on child — rejected by parent-child check (child is descendant)
    const result = TicketService.addDependency(
      project.slug as string,
      parent.id,
      child.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should reject child depending on parent (parent-child hierarchy)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    // Create a parent ticket and child ticket
    const parent = t(project.id, colId, 'Parent');
    const child = tChild(project.id, colId, 'Child', parent.id)!;

    // Child depending on parent — rejected by parent-child check (parent is ancestor)
    const result = TicketService.addDependency(
      project.slug as string,
      child.id,
      parent.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should reject self-dependency (ticket depends on itself)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const ticket = t(project.id, colId, 'Self Dep');

    const result = TicketService.addDependency(
      project.slug as string,
      ticket.id,
      ticket.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('itself');
  });

  it('should reject dependency between parent and child (parent-child hierarchy)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    const parent = t(project.id, colId, 'Parent');
    const child = tChild(project.id, colId, 'Child', parent.id)!;

    // Child depending on parent — parent is ancestor of child
    const result = TicketService.addDependency(
      project.slug as string,
      child.id,
      parent.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should reject dependency between child and parent (parent-child hierarchy)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    const parent = t(project.id, colId, 'Parent');
    const child = tChild(project.id, colId, 'Child', parent.id)!;

    // Parent depending on child — child is descendant of parent
    const result = TicketService.addDependency(
      project.slug as string,
      parent.id,
      child.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should reject dependency between grandparent and grandchild', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    const grandparent = t(project.id, colId, 'Grandparent');
    const parent = tChild(project.id, colId, 'Parent', grandparent.id)!;
    const grandchild = tChild(project.id, colId, 'Grandchild', parent.id)!;

    // Grandchild depending on grandparent — grandparent is ancestor
    let result = TicketService.addDependency(
      project.slug as string,
      grandchild.id,
      grandparent.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);

    // Grandparent depending on grandchild — grandchild is descendant
    result = TicketService.addDependency(
      project.slug as string,
      grandparent.id,
      grandchild.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
  });

  it('should allow sibling tickets to depend on each other (no hierarchy)', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    const parent = t(project.id, colId, 'Parent');
    const childA = tChild(project.id, colId, 'Child A', parent.id)!;
    const childB = tChild(project.id, colId, 'Child B', parent.id)!;

    // Both children depend on each other (siblings, no hierarchy between them)
    let result = TicketService.addDependency(
      project.slug as string,
      childA.id,
      childB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      childB.id,
      childA.id,
      'blocked_by'
    );
    expect(result.success).toBe(false); // This should be rejected as a cycle
  });

  it('should handle complex graph: A->B, A->C, B->D, C->D, then D->A creates cycle', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);
    const tickets_arr = [
      t(project.id, colId, 'Ticket A'),
      t(project.id, colId, 'Ticket B'),
      t(project.id, colId, 'Ticket C'),
      t(project.id, colId, 'Ticket D'),
    ];

    // A -> B, A -> C, B -> D, C -> D (diamond dependency graph)
    const edges = [
      [0, 1], [0, 2], [1, 3], [2, 3],
    ];
    for (const [from, to] of edges) {
      const result = TicketService.addDependency(
        project.slug as string,
        tickets_arr[from].id,
        tickets_arr[to].id,
        'blocked_by'
      );
      expect(result.success).toBe(true);
    }

    // D -> A — should create a cycle
    const result = TicketService.addDependency(
      project.slug as string,
      tickets_arr[3].id,
      tickets_arr[0].id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
  });

 it('should reject adding dependency that creates cycle through unrelated tickets', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    // Create tickets: A, B, C, D
    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');
    const ticketC = t(project.id, colId, 'Ticket C');
    const ticketD = t(project.id, colId, 'Ticket D');

    // Build: A depends on B, C depends on D, A depends on D
    // Graph: A→B, A→D, C→D
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      ticketC.id,
      ticketD.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketD.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // Now B -> A creates a cycle: A→B→A (B depends on A, A already depends on B)
    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketA.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CONFLICT');
  });

  it('should not affect unrelated tickets when a cycle is detected', () => {
    const project = createProjectWithColumns();
    const colId = getTodoColumnId(project.id);

    const ticketA = t(project.id, colId, 'Ticket A');
    const ticketB = t(project.id, colId, 'Ticket B');
    const ticketC = t(project.id, colId, 'Ticket C');

    // A -> B
    let result = TicketService.addDependency(
      project.slug as string,
      ticketA.id,
      ticketB.id,
      'blocked_by'
    );
    expect(result.success).toBe(true);

    // B -> A (cycle) — should fail
    result = TicketService.addDependency(
      project.slug as string,
      ticketB.id,
      ticketA.id,
      'blocked_by'
    );
    expect(result.success).toBe(false);

    // ticketC should be unaffected
    const deps = tickets.getDependencies(ticketC.id);
    expect(deps).toEqual([]);
  });
});
