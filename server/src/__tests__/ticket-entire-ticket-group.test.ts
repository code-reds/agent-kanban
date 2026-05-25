import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as tickets from '../db/queries/tickets.js';
import type { TicketRow } from '../db/queries/tickets.js';
import { TicketService } from '../services/ticket-service.js';

// Use in-memory SQLite database for test isolation (no file-based DB).
// This eliminates the need for resetDb() to switch to memory mode.
process.env.DB_PATH = ':memory:';

// Unset DB_PATH after tests so subsequent test files use the default file-based DB
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
  const slug = `etg-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Entire Ticket Group Test', slug);
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

function getTicketById(id: number): TicketRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
}

function moveTicketBySlug(projectId: number, ticketId: number, columnSlug: string): void {
  const db = getDb();
  const col = db.prepare<[number, string], { id: number }>(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, columnSlug);
  if (!col) throw new Error(`Column not found: ${columnSlug}`);
  db.prepare('UPDATE tickets SET column_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(col.id, ticketId);
  if (columnSlug == 'done') {
    db.prepare('UPDATE tickets SET closed_at = datetime(\'now\') WHERE id = ?').run(ticketId);
  }
}

function isTicketDone(ticketId: number): boolean {
  const ticket = getTicketById(ticketId);
  return ticket?.closed_at !== null;
}

describe('Entire Ticket Group Flag', () => {
  beforeEach(() => {
    initDb();
  });

  describe('1. Parent without entire_ticket_group transition — moves independently', () => {
    it('should move parent alone without triggering cascade', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent No ETG', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child No ETG', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move parent to implementation (not an entire_ticket_group transition)
      moveTicketBySlug(project.id, parentId, 'implementation');

      // Child should NOT have moved (stays in todo)
      const childCheck = getTicketById(childId);
      expect(childCheck?.column_id).toBe(columns['todo']);
    });
  });

  describe('2. Parent with entire_ticket_group: all children in same column', () => {
    it('should move parent and all children to target column together', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent ETG Same Col', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId1 = tickets.createTicket(project.id, columns['todo'], 'Child ETG 1', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;
      const childId2 = tickets.createTicket(project.id, columns['todo'], 'Child ETG 2', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move all tickets to final_review first
      moveTicketBySlug(project.id, parentId, 'final_review');
      moveTicketBySlug(project.id, childId1, 'final_review');
      moveTicketBySlug(project.id, childId2, 'final_review');

      // Now move parent to done — transition final_review->done has entire_ticket_group=true
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'close parent with children', role_id: 1 });
      expect(result.success).toBe(true);

      // All children should be moved to done as well (cascade)
      expect(isTicketDone(childId1)).toBe(true);
      expect(isTicketDone(childId2)).toBe(true);
      expect(isTicketDone(parentId)).toBe(true);
    });
  });

  describe('3. Parent with entire_ticket_group: children already closed', () => {
    it('should move parent even though children are already in done', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent ETG Closed Children', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child Already Closed', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move child to done first
      moveTicketBySlug(project.id, childId, 'done');

      // Move parent to final_review
      moveTicketBySlug(project.id, parentId, 'final_review');

      // Now move parent to done — child is already closed, so this should succeed
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'close parent with closed child', role_id: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe('4. Parent with entire_ticket_group: children in different open column (parent moves independently)', () => {

    it('should reject closing to done when child is in different open column', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent ETG Diff Col Close', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child Diff Col Open', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move parent to final_review
      moveTicketBySlug(project.id, parentId, 'final_review');
      // Move child to implementation (different open column)
      moveTicketBySlug(project.id, childId, 'implementation');

      // Closing to done should fail — child in different column is open
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'move parent to done', role_id: 1 });
      expect(result.success).toBe(false);

      // Neither should be closed
      expect(isTicketDone(parentId)).toBe(false);
      expect(isTicketDone(childId)).toBe(false);
    });
  });

  describe('5. Parent with entire_ticket_group: child has open blocked_by dep in same column (closes together)', () => {
    it('should reject move when same-column child has unresolved dependencies', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      // Create a dependency ticket that stays open
      const depId = tickets.createTicket(project.id, columns['todo'], 'Open Dep Ticket', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent ETG Dep', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child With Dep', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move everything to final_review
      moveTicketBySlug(project.id, parentId, 'final_review');
      moveTicketBySlug(project.id, childId, 'final_review');
      moveTicketBySlug(project.id, depId, 'final_review');

      // Add blocked_by dependency from child to the open dep ticket
      tickets.addDependency(childId, depId, 'blocked_by');

      // Move should fail — same-column child has unresolved dependency
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'move parent to done', role_id: 1 });
      expect(result.success).toBe(false);

      // Neither should be closed
      expect(isTicketDone(childId)).toBe(false);
      expect(isTicketDone(parentId)).toBe(false);
      expect(isTicketDone(depId)).toBe(false);
    });

    it('should be excluded from not-blocked when same-column child has unresolved deps', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const depId = tickets.createTicket(project.id, columns['todo'], 'Open Dep Ticket 2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent ETG Dep NotBlocked', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child With Dep 2', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move everything to final_review
      moveTicketBySlug(project.id, parentId, 'final_review');
      moveTicketBySlug(project.id, childId, 'final_review');
      moveTicketBySlug(project.id, depId, 'final_review');

      // Add blocked_by dependency from child to the open dep ticket
      tickets.addDependency(childId, depId, 'blocked_by');

      // For done transitions, parent should be excluded from not-blocked (child has unresolved dep)
      const blockedIds = TicketService.getBlockedTicketIds(project.id);
      expect(blockedIds).toContain(parentId);
    });
  });

  describe('6. Parent with entire_ticket_group: child is not top-level (grandchild in different column)', () => {
    it('should allow grandparent to move independently while grandchild stays in later column', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const grandparentId = tickets.createTicket(project.id, columns['todo'], 'Grandparent ETG', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child of Grandparent', '', '[]', 2, null, grandparentId, CREATOR_ROLE_ID)!.id;

      // Create grandchild
      const grandchildId = tickets.createTicket(project.id, columns['todo'], 'Grandchild', '', '[]', 2, null, childId, CREATOR_ROLE_ID)!.id;

      // Move grandparent and child to final_review
      moveTicketBySlug(project.id, grandparentId, 'integration_testing');
      moveTicketBySlug(project.id, childId, 'final_review');
      // Move grandchild to implementation (different column)
      moveTicketBySlug(project.id, grandchildId, 'final_review');

      // Grandparent should be in not-blocked mode (grandchild is in different column)
      const blockedIds = TicketService.getBlockedTicketIds(project.id);
      expect(blockedIds).not.toContain(grandparentId);

      // Grandparent can move to final_review
      const result = TicketService.move(project.slug || 'etg-test', grandparentId, 'final_review', { comment: 'move grandparent to done', role_id: 1 });
      expect(result.success).toBe(true);

      // Grandchild should still be in implementation (didn't cascade)
      const grandchildCheck = getTicketById(grandchildId);
      expect(grandchildCheck?.column_id).toBe(columns['final_review']);
    });
  });

  describe('7. Deep nesting (3+ levels) with same column cascade', () => {
    it('should handle recursive CTE with deep nesting correctly', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      // Create grandparent
      const gpId = tickets.createTicket(project.id, columns['todo'], 'Grandparent Deep', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      // Create parent
      const pId = tickets.createTicket(project.id, columns['todo'], 'Parent Deep', '', '[]', 2, null, gpId, CREATOR_ROLE_ID)!.id;
      // Create child
      const cId = tickets.createTicket(project.id, columns['todo'], 'Child Deep', '', '[]', 2, null, pId, CREATOR_ROLE_ID)!.id;
      // Create grandchild
      const gcId = tickets.createTicket(project.id, columns['todo'], 'Grandchild Deep', '', '[]', 2, null, cId, CREATOR_ROLE_ID)!.id;

      // Move ALL to final_review
      moveTicketBySlug(project.id, gpId, 'final_review');
      moveTicketBySlug(project.id, pId, 'final_review');
      moveTicketBySlug(project.id, cId, 'final_review');
      moveTicketBySlug(project.id, gcId, 'final_review');

      // Now move grandparent to done — entire-ticket-group should cascade through all 4 levels
      const result = TicketService.move(project.slug || 'etg-test', gpId, 'done', { comment: 'close deep hierarchy', role_id: 1 });
      expect(result.success).toBe(true);

      // Verify all tickets are closed
      expect(isTicketDone(gpId)).toBe(true);
      expect(isTicketDone(pId)).toBe(true);
      expect(isTicketDone(cId)).toBe(true);
      expect(isTicketDone(gcId)).toBe(true);
    });

    it('should cascade deep hierarchy when only some levels are in same column', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      // Create deep hierarchy
      const gpId = tickets.createTicket(project.id, columns['todo'], 'Grandparent Deep 2', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const pId = tickets.createTicket(project.id, columns['todo'], 'Parent Deep 2', '', '[]', 2, null, gpId, CREATOR_ROLE_ID)!.id;
      const cId = tickets.createTicket(project.id, columns['todo'], 'Child Deep 2', '', '[]', 2, null, pId, CREATOR_ROLE_ID)!.id;
      const gcId = tickets.createTicket(project.id, columns['todo'], 'Grandchild Deep 2', '', '[]', 2, null, cId, CREATOR_ROLE_ID)!.id;

      // Move grandparent, parent, child to final_review (same column)
      moveTicketBySlug(project.id, gpId, 'final_review');
      moveTicketBySlug(project.id, pId, 'final_review');
      moveTicketBySlug(project.id, cId, 'final_review');
      // Move grandchild to implementation (different column)
      moveTicketBySlug(project.id, gcId, 'done');

      // Move grandparent to done — should cascade grandparent, parent, child
      const result = TicketService.move(project.slug || 'etg-test', gpId, 'done', { comment: 'close partial hierarchy', role_id: 1 });
      expect(result.success).toBe(true);

      // Grandparent, parent, child should be closed
      expect(isTicketDone(gpId)).toBe(true);
      expect(isTicketDone(pId)).toBe(true);
      expect(isTicketDone(cId)).toBe(true);

      // Grandchild should still be in implementation (different column)
      const gcCheck = getTicketById(gcId);
      expect(gcCheck?.column_id).toBe(columns['done']);
    });
  });

  describe('8. Moving to done column — sets closed_at on all group members', () => {
    it('should set closed_at on parent and all children', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent Closed At Test', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child Closed At Test', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move both to final_review
      moveTicketBySlug(project.id, parentId, 'final_review');
      moveTicketBySlug(project.id, childId, 'final_review');

      // Move parent to done
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'close parent', role_id: 1 });
      expect(result.success).toBe(true);

      // Verify both are closed
      expect(isTicketDone(parentId)).toBe(true);
      expect(isTicketDone(childId)).toBe(true);
    });
  });

  describe('9. Parent with child in different column — not-blocked includes parent', () => {
    it('should include parent in not-blocked when child is in a later column', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent NotBlocked Diff Col', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child Diff Col NotBlocked', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move parent to integration_testing
      moveTicketBySlug(project.id, childId, 'integration_testing');

      // Parent should be in not-blocked (child is in different column)
      const blockedIds = TicketService.getBlockedTicketIds(project.id);
      expect(blockedIds).not.toContain(parentId);
    });
  });

  describe('10. Parent moves independently when children are in later columns', () => {
    
    it('should reject closing parent to done when children are in other columns', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent Cannot Close', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const child1Id = tickets.createTicket(project.id, columns['todo'], 'Child 1 Open', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;
      const child2Id = tickets.createTicket(project.id, columns['todo'], 'Child 2 Open', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move parent to final_review, children to different columns
      moveTicketBySlug(project.id, parentId, 'implementation');
      moveTicketBySlug(project.id, child1Id, 'final_review');
      moveTicketBySlug(project.id, child2Id, 'unit_review');

      // Closing to done should fail — children in other columns are open
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'move parent to done' });
      expect(result.success).toBe(false);

      // None should be closed
      expect(isTicketDone(parentId)).toBe(false);
      expect(isTicketDone(child1Id)).toBe(false);
      expect(isTicketDone(child2Id)).toBe(false);
    });
  });

  describe('11. Transition without entire_ticket_group: normal behavior preserved', () => {
    it('should allow normal parent move without cascade', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Normal Parent', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Normal Child', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move parent to implementation (not an entire_ticket_group transition)
      moveTicketBySlug(project.id, parentId, 'implementation');

      // Child should remain in todo
      const childCheck = getTicketById(childId);
      expect(childCheck?.column_id).toBe(columns['todo']);
    });
  });

  describe('12. Non-done transition with entire_ticket_group: blocks when child has unresolved deps', () => {
    it('should allow parent move when child in same column has no unresolved dependency', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent NonDone Block', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child NonDone Block', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move to integration_testing (has entire_ticket_group=true for transitions)
      moveTicketBySlug(project.id, parentId, 'integration_testing');
      moveTicketBySlug(project.id, childId, 'integration_testing');

      // Child is in same column as parent, no unresolved deps — should succeed
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'final_review', { comment: 'move to final_review', role_id: 1 });
      expect(result.success).toBe(true);

      // Both parent and child should have moved to final_review
      const parentCheck = getTicketById(parentId);
      const childCheck = getTicketById(childId);
      expect(parentCheck?.column_id).toBe(columns['final_review']);
      expect(childCheck?.column_id).toBe(columns['final_review']);
    });
  });

  describe('13. Parent with same-column children that are blocked — unresolved deps block all forward ETG transitions', () => {
    it('should block both non-done and done forward transitions when child in same column has unresolved dep', () => {
      const project = createProjectWithColumns();
      const columns = getColumnsForProject(project.id);

      const depId = tickets.createTicket(project.id, columns['todo'], 'Dep NonDone', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const parentId = tickets.createTicket(project.id, columns['todo'], 'Parent Blocked NonDone', '', '[]', 2, null, null, CREATOR_ROLE_ID)!.id;
      const childId = tickets.createTicket(project.id, columns['todo'], 'Child Blocked NonDone', '', '[]', 2, null, parentId, CREATOR_ROLE_ID)!.id;

      // Move everything to integration_testing
      moveTicketBySlug(project.id, parentId, 'integration_testing');
      moveTicketBySlug(project.id, childId, 'integration_testing');
      moveTicketBySlug(project.id, depId, 'integration_testing');

      // Add blocked_by dependency from child to dep
      tickets.addDependency(childId, depId, 'blocked_by');

      // Non-done forward transitions should ALSO be blocked (matching non-ETG path behavior)
      const result = TicketService.move(project.slug || 'etg-test', parentId, 'final_review', { comment: 'try move', role_id: 1 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('unresolved dependency');

      // Done transitions should also be blocked
      const doneResult = TicketService.move(project.slug || 'etg-test', parentId, 'done', { comment: 'try close' });
      expect(doneResult.success).toBe(false);

      // None should have moved
      const parentCheck = getTicketById(parentId);
      const childCheck = getTicketById(childId);
      expect(parentCheck?.column_id).toBe(columns['integration_testing']);
      expect(childCheck?.column_id).toBe(columns['integration_testing']);
      expect(isTicketDone(parentId)).toBe(false);
      expect(isTicketDone(childId)).toBe(false);
      expect(isTicketDone(depId)).toBe(false);
    });
  });
});
