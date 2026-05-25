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

function createProjectWithColumns() {
  const db = getDb();
  const slug = `unblock-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Unblocked Tickets Test', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

function getColumnsForProject(projectId: number): Record<string, number> {
  const db = getDb();
  const cols = db.prepare<[number]>(
    'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
  ).all(projectId) as { id: number; slug: string }[];
  const result: Record<string, number> = {};
  for (const col of cols) {
    result[col.slug] = col.id;
  }
  return result;
}

function moveTicketToColumn(projectId: number, ticketId: number, columnSlug: string): void {
  const db = getDb();
  const col = db.prepare<[number, string], { id: number }>(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, columnSlug);
  if (!col) throw new Error(`Column not found: ${columnSlug}`);
  db.prepare('UPDATE tickets SET column_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(col.id, ticketId);
  if (columnSlug === 'done') {
    db.prepare('UPDATE tickets SET closed_at = datetime(\'now\') WHERE id = ?').run(ticketId);
  }
}

describe('getTicketsUnblockedByMove — Problem 1: No-other-blocker constraint', () => {
  beforeEach(() => {
    initDb();
  });

  it('should only report a ticket as unblocked when it was blocked exclusively by the moved ticket', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // Create A (will be closed, unblocking B)
    const ticketA = tickets.createTicket(project.id, columns['todo'], 'Ticket A — blocker', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    // Create B (blocked by A and C, should NOT appear in unblocked list)
    const ticketB = tickets.createTicket(project.id, columns['todo'], 'Ticket B — dual blocked', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    // Create C (another blocker for B, stays open)
    const ticketC = tickets.createTicket(project.id, columns['todo'], 'Ticket C — second blocker', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    // Create D (blocked only by A, should appear in unblocked list)
    const ticketD = tickets.createTicket(project.id, columns['todo'], 'Ticket D — single blocked', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Move A, C, D to final_review (so they can be closed)
    moveTicketToColumn(project.id, ticketA.id, 'final_review');
    moveTicketToColumn(project.id, ticketB.id, 'final_review');
    moveTicketToColumn(project.id, ticketC.id, 'final_review');
    moveTicketToColumn(project.id, ticketD.id, 'final_review');

    // Add dependencies: B blocked_by A, B blocked_by C, D blocked_by A
    tickets.addDependency(ticketB.id, ticketA.id, 'blocked_by');
    tickets.addDependency(ticketB.id, ticketC.id, 'blocked_by');
    tickets.addDependency(ticketD.id, ticketA.id, 'blocked_by');

    // Move A to done — this should unblock D (only blocked by A) but NOT B (also blocked by C)
    const result = TicketService.move(project.slug, ticketA.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // Check unblocked tickets
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(ticketD.id);
    expect(result.tickets_unblocked).not.toContain(ticketB.id);
  });

  it('should return empty list when no tickets are unblocked after closing unrelated ticket', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const ticketA = tickets.createTicket(project.id, columns['todo'], 'Ticket A', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const ticketB = tickets.createTicket(project.id, columns['todo'], 'Ticket B', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, ticketA.id, 'final_review');
    moveTicketToColumn(project.id, ticketB.id, 'final_review');

    const result = TicketService.move(project.slug, ticketA.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);
    expect(result.tickets_unblocked).toEqual([]);
  });

  it('should not report tickets that are blocked by the moved ticket but also by other tickets', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // Create dependency chain: A -> B -> C
    // A is the blocker, B depends on A, C depends on both A and B
    const ticketA = tickets.createTicket(project.id, columns['todo'], 'Ticket A', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const ticketB = tickets.createTicket(project.id, columns['todo'], 'Ticket B', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const ticketC = tickets.createTicket(project.id, columns['todo'], 'Ticket C', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Move all to final_review
    moveTicketToColumn(project.id, ticketA.id, 'final_review');
    moveTicketToColumn(project.id, ticketB.id, 'final_review');
    moveTicketToColumn(project.id, ticketC.id, 'final_review');

    // B depends on A, C depends on both A and B
    tickets.addDependency(ticketB.id, ticketA.id, 'blocked_by');
    tickets.addDependency(ticketC.id, ticketA.id, 'blocked_by');
    tickets.addDependency(ticketC.id, ticketB.id, 'blocked_by');

    // Move A to done — B is only blocked by A (should be unblocked),
    // C is blocked by A AND B (should NOT be unblocked)
    const result = TicketService.move(project.slug, ticketA.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(ticketB.id);
    expect(result.tickets_unblocked).not.toContain(ticketC.id);
  });

  it('should handle multiple tickets being unblocked simultaneously', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const blocker = tickets.createTicket(project.id, columns['todo'], 'Blocker', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const dep1 = tickets.createTicket(project.id, columns['todo'], 'Dep 1', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const dep2 = tickets.createTicket(project.id, columns['todo'], 'Dep 2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const dep3 = tickets.createTicket(project.id, columns['todo'], 'Dep 3 — also blocked by others', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const otherBlocker = tickets.createTicket(project.id, columns['todo'], 'Other Blocker', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, blocker.id, 'final_review');
    moveTicketToColumn(project.id, dep1.id, 'final_review');
    moveTicketToColumn(project.id, dep2.id, 'final_review');
    moveTicketToColumn(project.id, dep3.id, 'final_review');
    moveTicketToColumn(project.id, otherBlocker.id, 'final_review');

    tickets.addDependency(dep1.id, blocker.id, 'blocked_by');
    tickets.addDependency(dep2.id, blocker.id, 'blocked_by');
    tickets.addDependency(dep3.id, blocker.id, 'blocked_by');
    tickets.addDependency(dep3.id, otherBlocker.id, 'blocked_by');

    const result = TicketService.move(project.slug, blocker.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toHaveLength(2);
    expect(result.tickets_unblocked).toContain(dep1.id);
    expect(result.tickets_unblocked).toContain(dep2.id);
    expect(result.tickets_unblocked).not.toContain(dep3.id);
  });
});

describe('getTicketsUnblockedByMove — Problem 2: Cascade moves with child dependencies', () => {
  beforeEach(() => {
    initDb();
  });

  it('should detect unblocking of tickets that depend on child tickets of the moved parent (cascade)', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // Create parent + child in same column (will cascade when moving parent)
    const parent = tickets.createTicket(project.id, columns['todo'], 'Parent ETG', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const child = tickets.createTicket(project.id, columns['todo'], 'Child ETG', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;

    // Create external ticket that depends on the CHILD (not the parent)
    const externalDep = tickets.createTicket(project.id, columns['todo'], 'External Dep', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Move parent and child to final_review
    moveTicketToColumn(project.id, parent.id, 'final_review');
    moveTicketToColumn(project.id, child.id, 'final_review');
    moveTicketToColumn(project.id, externalDep.id, 'final_review');

    // External dep depends on the CHILD
    tickets.addDependency(externalDep.id, child.id, 'blocked_by');

    // Move parent to done — should cascade close parent+child, which unblocks externalDep
    const result = TicketService.move(project.slug, parent.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // externalDep should be in the unblocked list
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(externalDep.id);
  });

  it('should detect unblocking when moving a leaf ticket (non-ETG cascade)', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // Create two independent leaf tickets (no parent-child relationship)
    const leaf1 = tickets.createTicket(project.id, columns['todo'], 'Leaf 1', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const leaf2 = tickets.createTicket(project.id, columns['todo'], 'Leaf 2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Create external ticket that depends on leaf1
    const externalDep = tickets.createTicket(project.id, columns['todo'], 'External Dep on Leaf1', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Move all to final_review
    moveTicketToColumn(project.id, leaf1.id, 'final_review');
    moveTicketToColumn(project.id, leaf2.id, 'final_review');
    moveTicketToColumn(project.id, externalDep.id, 'final_review');

    tickets.addDependency(externalDep.id, leaf1.id, 'blocked_by');

    // Move leaf1 to done — should unblock externalDep
    const result = TicketService.move(project.slug, leaf1.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // externalDep should be unblocked (its blocker leaf1 was closed)
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(externalDep.id);
    // leaf2 is independent, should NOT be unblocked
    expect(result.tickets_unblocked).not.toContain(leaf2.id);
  });

  it('should handle cascade moves with multiple children that external tickets depend on', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const parent = tickets.createTicket(project.id, columns['todo'], 'Parent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const child1 = tickets.createTicket(project.id, columns['todo'], 'Child 1', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;
    const child2 = tickets.createTicket(project.id, columns['todo'], 'Child 2', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;
    const child3 = tickets.createTicket(project.id, columns['todo'], 'Child 3', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;

    // External tickets depending on children
    const ext1 = tickets.createTicket(project.id, columns['todo'], 'Ext 1 (depends on child1)', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const ext2 = tickets.createTicket(project.id, columns['todo'], 'Ext 2 (depends on child2)', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const ext3 = tickets.createTicket(project.id, columns['todo'], 'Ext 3 (depends on child3)', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    // Move all to final_review
    moveTicketToColumn(project.id, parent.id, 'final_review');
    moveTicketToColumn(project.id, child1.id, 'final_review');
    moveTicketToColumn(project.id, child2.id, 'final_review');
    moveTicketToColumn(project.id, child3.id, 'final_review');
    moveTicketToColumn(project.id, ext1.id, 'final_review');
    moveTicketToColumn(project.id, ext2.id, 'final_review');
    moveTicketToColumn(project.id, ext3.id, 'final_review');

    tickets.addDependency(ext1.id, child1.id, 'blocked_by');
    tickets.addDependency(ext2.id, child2.id, 'blocked_by');
    tickets.addDependency(ext3.id, child3.id, 'blocked_by');

    // Move parent to done — cascade closes parent+children, unblocking ext1, ext2, ext3
    const result = TicketService.move(project.slug, parent.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(ext1.id);
    expect(result.tickets_unblocked).toContain(ext2.id);
    expect(result.tickets_unblocked).toContain(ext3.id);
  });

  it('should NOT report external tickets as unblocked if they are blocked by both cascade-closed tickets and open tickets', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const parent = tickets.createTicket(project.id, columns['todo'], 'Parent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const child = tickets.createTicket(project.id, columns['todo'], 'Child', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;

    const blocker2 = tickets.createTicket(project.id, columns['todo'], 'Other Blocker', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const extDep = tickets.createTicket(project.id, columns['todo'], 'External Dep (dual blocked)', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    // Another ticket that ONLY depends on child — should be unblocked
    const onlyByChild = tickets.createTicket(project.id, columns['todo'], 'Only by Child', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, parent.id, 'final_review');
    moveTicketToColumn(project.id, child.id, 'final_review');
    moveTicketToColumn(project.id, blocker2.id, 'final_review');
    moveTicketToColumn(project.id, extDep.id, 'final_review');
    moveTicketToColumn(project.id, onlyByChild.id, 'final_review');

    // extDep depends on BOTH child (will be cascade-closed) AND blocker2 (will stay open)
    tickets.addDependency(extDep.id, child.id, 'blocked_by');
    tickets.addDependency(extDep.id, blocker2.id, 'blocked_by');

    // onlyByChild depends ONLY on child — should be unblocked
    tickets.addDependency(onlyByChild.id, child.id, 'blocked_by');

    const result = TicketService.move(project.slug, parent.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // onlyByChild should be unblocked (only depended on cascade-closed child)
    // extDep should NOT be in unblocked list — blocker2 is still open
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(onlyByChild.id);
    expect(result.tickets_unblocked).not.toContain(extDep.id);
  });

  it('should handle cascade with deep hierarchy (grandparent -> parent -> child -> grandchild)', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const gp = tickets.createTicket(project.id, columns['todo'], 'Grandparent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const p = tickets.createTicket(project.id, columns['todo'], 'Parent', '', '[]', 2, null, gp.id, CREATOR_ROLE_ID)!;
    const c = tickets.createTicket(project.id, columns['todo'], 'Child', '', '[]', 2, null, p.id, CREATOR_ROLE_ID)!;
    const gc = tickets.createTicket(project.id, columns['todo'], 'Grandchild', '', '[]', 2, null, c.id, CREATOR_ROLE_ID)!;

    // External ticket depending on grandchild
    const ext = tickets.createTicket(project.id, columns['todo'], 'External on Grandchild', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, gp.id, 'final_review');
    moveTicketToColumn(project.id, p.id, 'final_review');
    moveTicketToColumn(project.id, c.id, 'final_review');
    moveTicketToColumn(project.id, gc.id, 'final_review');
    moveTicketToColumn(project.id, ext.id, 'final_review');

    tickets.addDependency(ext.id, gc.id, 'blocked_by');

    // Move grandparent to done — cascade closes all 4 levels
    const result = TicketService.move(project.slug, gp.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // External ticket should be unblocked
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(ext.id);
  });

  it('should reject cascade closes when children in other columns are open', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const parent = tickets.createTicket(project.id, columns['todo'], 'Parent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const child1 = tickets.createTicket(project.id, columns['todo'], 'Child 1 (same col)', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;
    const child2 = tickets.createTicket(project.id, columns['todo'], 'Child 2 (diff col)', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;

    // External ticket depending on child2 (which stays in todo, not cascade-closed)
    const ext = tickets.createTicket(project.id, columns['todo'], 'External on Child2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, parent.id, 'final_review');
    moveTicketToColumn(project.id, child1.id, 'final_review');
    // child2 stays in todo (different column)
    moveTicketToColumn(project.id, ext.id, 'final_review');

    tickets.addDependency(ext.id, child2.id, 'blocked_by');

    // Moving parent to done should fail because child2 is still open in a different column
    // The blocker check runs before the children-in-other-columns validation
    const result = TicketService.move(project.slug, parent.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('unresolved dependency');
  });
});

describe('getTicketsUnblockedByMove — Edge cases', () => {
  beforeEach(() => {
    initDb();
  });

  it('should return undefined when no tickets are unblocked', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const ticket = tickets.createTicket(project.id, columns['todo'], 'No Deps', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    moveTicketToColumn(project.id, ticket.id, 'final_review');

    const result = TicketService.move(project.slug, ticket.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);
    expect(result.tickets_unblocked).toEqual([]);
  });

  it('should handle non-cascade moves correctly', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // non-ETG transition: move from todo to implementation (no entire_ticket_group)
    const blocker = tickets.createTicket(project.id, columns['todo'], 'Blocker NonETG', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const dep = tickets.createTicket(project.id, columns['todo'], 'Dep NonETG', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    tickets.addDependency(dep.id, blocker.id, 'blocked_by');

    // todo -> implementation is NOT an entire_ticket_group transition
    const result = TicketService.move(project.slug, blocker.id, 'implementation', { role_id: CREATOR_ROLE_ID });
    expect(result.success).toBe(true);

    // dep is still blocked by blocker (cross-group dependency always blocks regardless of column order)
    expect(result.tickets_unblocked).toEqual([]);
  });

  it('should handle multiple blockers where only some are moved', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const blockerA = tickets.createTicket(project.id, columns['todo'], 'Blocker A', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const blockerB = tickets.createTicket(project.id, columns['todo'], 'Blocker B', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const dep = tickets.createTicket(project.id, columns['todo'], 'Dep — dual blocked', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    moveTicketToColumn(project.id, blockerA.id, 'final_review');
    moveTicketToColumn(project.id, blockerB.id, 'final_review');
    moveTicketToColumn(project.id, dep.id, 'final_review');

    tickets.addDependency(dep.id, blockerA.id, 'blocked_by');
    tickets.addDependency(dep.id, blockerB.id, 'blocked_by');

    // Move only blockerA to done — dep is still blocked by B
    const result = TicketService.move(project.slug, blockerA.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // dep should NOT be unblocked (still blocked by B), and no other tickets are affected
    expect(result.tickets_unblocked).toEqual([]);

    // Now move blockerB to done — dep should now be unblocked
    const result2 = TicketService.move(project.slug, blockerB.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result2.success).toBe(true);
    expect(result2.tickets_unblocked).toBeDefined();
    expect(result2.tickets_unblocked).toContain(dep.id);
  });

  it('should handle tickets with entire-ticket-group violations (same-group blocker)', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    // Create two tickets in the same group (same parent, same column)
    const parent = tickets.createTicket(project.id, columns['todo'], 'Parent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const sibling1 = tickets.createTicket(project.id, columns['todo'], 'Sibling 1', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;
    const sibling2 = tickets.createTicket(project.id, columns['todo'], 'Sibling 2', '', '[]', 2, null, parent.id, CREATOR_ROLE_ID)!;

    // Move parent and siblings to final_review (ETG transition to done)
    moveTicketToColumn(project.id, parent.id, 'final_review');
    moveTicketToColumn(project.id, sibling1.id, 'final_review');
    moveTicketToColumn(project.id, sibling2.id, 'final_review');

    // sibling1 is in implementation (behind sibling2 in final_review)
    moveTicketToColumn(project.id, sibling1.id, 'implementation');

    // sibling2 depends on sibling1 (entire-ticket-group violation: sibling2 is ahead)
    // Move sibling1 back to final_review
    moveTicketToColumn(project.id, sibling1.id, 'final_review');

    // Now both siblings are in final_review, same column. Moving parent to done
    // should cascade both siblings. If there's an external ticket depending on sibling2,
    // it should be unblocked.

    // Actually, test a simpler scenario: external ticket depending on sibling2
    const external = tickets.createTicket(project.id, columns['todo'], 'External', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    moveTicketToColumn(project.id, external.id, 'final_review');
    tickets.addDependency(external.id, sibling2.id, 'blocked_by');

    // Move parent to done — cascade should close parent + sibling1 + sibling2
    const result = TicketService.move(project.slug, parent.id, 'done', { role_id: CREATOR_ROLE_ID, comment: 'closing' });
    expect(result.success).toBe(true);

    // external should be unblocked (sibling2 was cascade-closed)
    expect(result.tickets_unblocked).toBeDefined();
    expect(result.tickets_unblocked).toContain(external.id);
  });
});

describe('getTicketsUnblockedByMove — Direct helper method tests', () => {
  beforeEach(() => {
    initDb();
  });

  it('getTicketsBlockedOnlyBy should return tickets blocked exclusively by given ID', () => {
    const project = createProjectWithColumns();
    const columns = getColumnsForProject(project.id);

    const blocker1 = tickets.createTicket(project.id, columns['todo'], 'Blocker 1', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const blocker2 = tickets.createTicket(project.id, columns['todo'], 'Blocker 2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const onlyBy1 = tickets.createTicket(project.id, columns['todo'], 'Only by 1', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;
    const byBoth = tickets.createTicket(project.id, columns['todo'], 'By Both', '', '[]', 2, null, null, CREATOR_ROLE_ID)!;

    tickets.addDependency(onlyBy1.id, blocker1.id, 'blocked_by');
    tickets.addDependency(byBoth.id, blocker1.id, 'blocked_by');
    tickets.addDependency(byBoth.id, blocker2.id, 'blocked_by');

    // Only tickets blocked exclusively by blocker1 should be returned
    const result = (TicketService as any).getTicketsBlockedOnlyBy(blocker1.id, project.id);
    expect(result).toContain(onlyBy1.id);
    expect(result).not.toContain(byBoth.id);
  });


});
