import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { TicketService } from '../services/ticket-service.js';
import * as tickets from '../db/queries/tickets.js';
import type { TicketRow } from '../db/queries/tickets.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-ats-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  return project;
}

describe('TicketService.list() with all_tickets and done_limit', () => {
  let project: { id: number; slug: string };
  let todoColId: number;
  let implColId: number;
  let doneColId: number;

  beforeEach(() => {
    initDb();
    project = createProjectWithColumns();
    const db = getDb();
    todoColId = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('todo', project.id)!.id;
    implColId = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('implementation', project.id)!.id;
    doneColId = db.prepare('SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?').get('done', project.id)!.id;
  });

  function createTicketsInColumn(colId: number, count: number, prefix: string): void {
    for (let i = 0; i < count; i++) {
      tickets.createTicket(project.id, colId, `${prefix} ${i}`, `Description ${i}`, '[]', 2, null, null, 1);
    }
  }

  describe('all_tickets = false (default behavior)', () => {
    it('should return paginated results (default per_page=20)', () => {
      createTicketsInColumn(todoColId, 25, 'Ticket');
      const result = TicketService.list(project.slug, {});
      expect(result.tickets).toHaveLength(20);
      expect(result.total).toBe(25);
    });
  });

  describe('all_tickets = true without column filter', () => {
    it('should return all matching tickets up to 1000', () => {
      createTicketsInColumn(todoColId, 50, 'AllTickets');
      const result = TicketService.list(project.slug, { all_tickets: true });
      expect(result.tickets).toHaveLength(50);
      expect(result.total).toBe(50);
    });

    it('should respect per_page cap of 1000', () => {
      createTicketsInColumn(todoColId, 1500, 'Large');
      const result = TicketService.list(project.slug, { all_tickets: true });
      expect(result.tickets).toHaveLength(1000);
      expect(result.total).toBe(1000);
    });

    it('should return all tickets when per_page is already capped at 1000', () => {
      createTicketsInColumn(todoColId, 50, 'All');
      const result = TicketService.list(project.slug, { all_tickets: true, per_page: 100 });
      expect(result.tickets).toHaveLength(50);
      expect(result.total).toBe(50);
    });
  });

  describe('all_tickets = true with column=done', () => {
    it('should return up to 8 done tickets sorted by updated_at DESC by default', () => {
      createTicketsInColumn(doneColId, 15, 'Done');
      const result = TicketService.list(project.slug, { column: 'done', all_tickets: true });
      expect(result.tickets.length).toBeLessThanOrEqual(8);
      expect(result.total).toBe(15);
      // Verify sorted by updated_at DESC
      if (result.tickets.length > 1) {
        for (let i = 0; i < result.tickets.length - 1; i++) {
          expect(result.tickets[i].updated_at >= result.tickets[i + 1].updated_at).toBe(true);
        }
      }
    });

    it('should respect done_limit parameter', () => {
      createTicketsInColumn(doneColId, 20, 'DoneLimited');
      const result = TicketService.list(project.slug, { column: 'done', all_tickets: true, done_limit: 5 });
      expect(result.tickets.length).toBe(5);
      expect(result.total).toBe(20);
    });

    it('should return fewer tickets than available when done_limit is smaller', () => {
      createTicketsInColumn(doneColId, 3, 'FewDone');
      const result = TicketService.list(project.slug, { column: 'done', all_tickets: true, done_limit: 10 });
      expect(result.tickets.length).toBe(3);
      expect(result.total).toBe(3);
    });
  });

  describe('all_tickets = true with other columns', () => {
    it('should return all tickets in implementation column', () => {
      createTicketsInColumn(implColId, 30, 'Impl');
      const result = TicketService.list(project.slug, { column: 'implementation', all_tickets: true });
      expect(result.tickets.length).toBe(30);
      expect(result.total).toBe(30);
    });
  });

  describe('per_page cap enforcement', () => {
    it('should cap per_page at 1000 even if a higher value is provided', () => {
      createTicketsInColumn(todoColId, 2000, 'CapTest');
      const result = TicketService.list(project.slug, { per_page: 5000 });
      expect(result.tickets.length).toBeLessThanOrEqual(1000);
      expect(result.total).toBe(2000);
    });

    it('should cap per_page at 1000 for all_tickets requests', () => {
      createTicketsInColumn(todoColId, 3000, 'CapAll');
      const result = TicketService.list(project.slug, { all_tickets: true, per_page: 5000 });
      expect(result.tickets.length).toBe(1000);
      expect(result.total).toBe(1000);
    });
  });

  describe('error handling', () => {
    it('should return 404 for non-existent project', () => {
      const result = TicketService.list('non-existent-project', {});
      expect(result.error).toBeDefined();
      expect(result.errorCode).toBe('NOT_FOUND');
      expect(result.statusCode).toBe(404);
    });

    it('should return empty results for non-existent project with all_tickets', () => {
      const result = TicketService.list('non-existent-project', { all_tickets: true });
      expect(result.error).toBeDefined();
      expect(result.errorCode).toBe('NOT_FOUND');
    });
  });

  describe('done_total field in response', () => {
    it('should return done_total when all_tickets=true without column filter', () => {
      createTicketsInColumn(todoColId, 10, 'Todo');
      createTicketsInColumn(doneColId, 15, 'Done');
      const result = TicketService.list(project.slug, { all_tickets: true });
      expect(result.done_total).toBe(15);
      expect(result.total).toBe(25);
    });

    it('should return done_total only when all_tickets=true without column filter', () => {
      createTicketsInColumn(todoColId, 10, 'Todo');
      createTicketsInColumn(doneColId, 15, 'Done');
      const result = TicketService.list(project.slug, { all_tickets: true });
      expect(result.done_total).toBe(15);
      expect(result.total).toBe(25);
    });

    it('should not return done_total when column=done is specified', () => {
      createTicketsInColumn(doneColId, 15, 'Done');
      const result = TicketService.list(project.slug, { column: 'done', all_tickets: true });
      expect(result.done_total).toBeUndefined();
      expect(result.total).toBe(15);
    });
  });

  describe('combined filters with all_tickets', () => {
    it('should apply priority filter with all_tickets', () => {
      createTicketsInColumn(todoColId, 10, 'Pri2');
      const db = getDb();
      for (let i = 0; i < 5; i++) {
        tickets.createTicket(project.id, todoColId, `Pri1 ${i}`, `Desc ${i}`, '[]', 1, null, null, 1);
      }
      const result = TicketService.list(project.slug, { priority: 2, all_tickets: true });
      expect(result.tickets.length).toBe(10);
      expect(result.total).toBe(10);
    });

    it('should apply labels filter with all_tickets', () => {
      const db = getDb();
      for (let i = 0; i < 10; i++) {
        tickets.createTicket(project.id, todoColId, `Labeled ${i}`, `Desc ${i}`, JSON.stringify(['bug']), 2, null, null, 1);
      }
      for (let i = 0; i < 5; i++) {
        tickets.createTicket(project.id, todoColId, `NotLabeled ${i}`, `Desc ${i}`, JSON.stringify(['feature']), 2, null, null, 1);
      }
      const result = TicketService.list(project.slug, { labels: 'bug', all_tickets: true });
      expect(result.tickets.length).toBe(10);
      expect(result.total).toBe(10);
    });
  });
});
