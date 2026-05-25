import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './integration-setup.js';
import { getApp, startServer, stopServer } from '../server.js';
import { getDb } from '../db/database.js';
import request from 'supertest';

describe('Kanban API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-kanban-api-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Kanban API Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/columns', () => {
    it('should return columns', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/columns');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:slug/columns', () => {
    it('should create a new column', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'custom-col', name: 'Custom Column', order: 10 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('slug', 'custom-col');
    });

    it('should reject missing slug', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ name: 'No Slug', order: 10 });
      expect(res.status).toBe(400);
    });

    it('should reject duplicate slug', async () => {
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'dup-slug', name: 'Duplicate', order: 10 });
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'dup-slug', name: 'Duplicate 2', order: 11 });
      expect(res.status).toBe(409);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/columns')
        .send({ slug: 'test', name: 'Test', order: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/projects/:slug/columns/:id', () => {
    it('should update column name', async () => {
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'updatable', name: 'Old Name', order: 10 });
      const colId = colRes.body.data.id;
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/columns/${colId}`)
        .send({ name: 'Updated Name' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('name', 'Updated Name');
    });

    it('should update column order', async () => {
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'order-test', name: 'Order Test', order: 10 });
      const colId = colRes.body.data.id;
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/columns/${colId}`)
        .send({ order: 50 });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('order', 50);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().patch('/api/v1/projects/nonexistent/columns/1').send({ name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/projects/:slug/columns/:id', () => {
    it('should delete an empty custom column', async () => {
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'deletable', name: 'Deletable', order: 10 });
      const colId = colRes.body.data.id;
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${colId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should move tickets to todo and succeed when deleting a column with tickets', async () => {
      // Create a custom column
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'review-col', name: 'Review Column', order: 20 });
      const colId = colRes.body.data.id;
      const todoCol = getDb().prepare('SELECT id FROM kanban_columns WHERE slug = ?').get('todo') as { id: number };
      // Insert a ticket directly into the custom column via SQL
      const project = getDb().prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug) as { id: number };
      getDb().prepare('INSERT INTO tickets (project_id, title, column_id, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?)').run(project.id, 'Ticket to move', colId, 2, 1);
      const ticketId = getDb().prepare('SELECT id FROM tickets WHERE project_id = ? AND column_id = ? ORDER BY id DESC LIMIT 1').get(project.id, colId) as { id: number };
      // Verify ticket is in review-col column via DB
      const ticketColBefore = getDb().prepare('SELECT kc.slug FROM tickets t JOIN kanban_columns kc ON t.column_id = kc.id WHERE t.id = ?').get(ticketId.id) as { slug: string };
      expect(ticketColBefore.slug).toBe('review-col');
      // Delete the custom column
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${colId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);
      // Verify ticket was moved to todo column
      const ticketColAfter = getDb().prepare('SELECT kc.slug FROM tickets t JOIN kanban_columns kc ON t.column_id = kc.id WHERE t.id = ?').get(ticketId.id) as { slug: string };
      expect(ticketColAfter.slug).toBe('todo');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().delete('/api/v1/projects/nonexistent/columns/1');
      expect(res.status).toBe(404);
    });

    it('should return 400 if deleting the "todo" column', async () => {
      const cols = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const todoColumn = cols.body.data.find((c: any) => c.slug === 'todo');
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${todoColumn.id}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain('Cannot delete reserved column');
    });

    it('should return 400 if deleting the "done" column', async () => {
      const cols = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const doneColumn = cols.body.data.find((c: any) => c.slug === 'done');
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${doneColumn.id}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain('Cannot delete reserved column');
    });

    it('should move multiple tickets to todo when deleting a column with multiple tickets', async () => {
      // Create a custom column
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'multi-tickets-col', name: 'Multi Tickets Column', order: 30 });
      const colId = colRes.body.data.id;

      // Get project ID for direct SQL inserts
      const project = getDb().prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug) as { id: number };

      // Create 3 tickets directly in the custom column via SQL
      const ticketIds: { id: number }[] = [];
      for (let i = 1; i <= 3; i++) {
        getDb().prepare('INSERT INTO tickets (project_id, title, column_id, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?)').run(project.id, `Ticket ${i}`, colId, 2, 1);
        const row = getDb().prepare('SELECT id FROM tickets WHERE project_id = ? AND column_id = ? ORDER BY id DESC LIMIT 1').get(project.id, colId) as { id: number };
        ticketIds.push(row);
      }

      // Verify all tickets are in the custom column via DB
      for (const t of ticketIds) {
        const colRow = getDb().prepare('SELECT kc.slug FROM tickets tk JOIN kanban_columns kc ON tk.column_id = kc.id WHERE tk.id = ?').get(t.id) as { slug: string };
        expect(colRow.slug).toBe('multi-tickets-col');
      }

      // Delete the custom column
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${colId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify all tickets were moved to todo
      for (const t of ticketIds) {
        const colRow = getDb().prepare('SELECT kc.slug FROM tickets tk JOIN kanban_columns kc ON tk.column_id = kc.id WHERE tk.id = ?').get(t.id) as { slug: string };
        expect(colRow.slug).toBe('todo');
      }
    });

    it('should allow deleting non-default column with tickets (ticket reassignment)', async () => {
      // Create a non-default custom column with tickets
      const colRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/columns`)
        .send({ slug: 'reassign-test', name: 'Reassign Test Column', order: 40, is_default: false });
      const colId = colRes.body.data.id;

      // Get project ID for direct SQL inserts
      const project = getDb().prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug) as { id: number };

      // Create a ticket directly in the custom column via SQL
      getDb().prepare('INSERT INTO tickets (project_id, title, column_id, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?)').run(project.id, 'Ticket for reassign test', colId, 3, 1);
      const ticketId = getDb().prepare('SELECT id FROM tickets WHERE project_id = ? AND column_id = ? ORDER BY id DESC LIMIT 1').get(project.id, colId) as { id: number };

      // Verify ticket is in custom column via DB
      const ticketColBefore = getDb().prepare('SELECT kc.slug FROM tickets tk JOIN kanban_columns kc ON tk.column_id = kc.id WHERE tk.id = ?').get(ticketId.id) as { slug: string };
      expect(ticketColBefore.slug).toBe('reassign-test');

      // Delete the custom column — should succeed with ticket reassignment
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${colId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify ticket was moved to todo column
      const ticketColAfter = getDb().prepare('SELECT kc.slug FROM tickets tk JOIN kanban_columns kc ON tk.column_id = kc.id WHERE tk.id = ?').get(ticketId.id) as { slug: string };
      expect(ticketColAfter.slug).toBe('todo');
    });

    it('should protect "todo" and "done" columns from deletion even when they have tickets', async () => {
      // Create a ticket in the todo column (some tickets start there)
      const cols = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const todoColumn = cols.body.data.find((c: any) => c.slug === 'todo');
      const doneColumn = cols.body.data.find((c: any) => c.slug === 'done');

      // Try to delete todo column — should fail
      const todoDelRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${todoColumn.id}`);
      expect(todoDelRes.status).toBe(400);
      expect(todoDelRes.body).toHaveProperty('success', false);
      expect(todoDelRes.body.code).toBe('VALIDATION_ERROR');
      expect(todoDelRes.body.error).toContain('Cannot delete reserved column');
      expect(todoDelRes.body.error).toContain('todo');

      // Try to delete done column — should fail
      const doneDelRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/columns/${doneColumn.id}`);
      expect(doneDelRes.status).toBe(400);
      expect(doneDelRes.body).toHaveProperty('success', false);
      expect(doneDelRes.body.code).toBe('VALIDATION_ERROR');
      expect(doneDelRes.body.error).toContain('Cannot delete reserved column');
      expect(doneDelRes.body.error).toContain('done');
    });
  });
});
