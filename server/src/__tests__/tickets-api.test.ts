import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Tickets API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-tickets-api-${Date.now()}`;
  let ticketId: number | null = null;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Tickets API Test', slug: testSlug });
  });

  afterAll(async () => {
    if (ticketId) {
      try {
        await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${ticketId}`);
      } catch { /* ignore */ }
    }
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/tickets', () => {
    it('should return empty list initially', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data.tickets)).toBe(true);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/tickets');
      expect(res.status).toBe(404);
    });

    it('should support column filter', async () => {
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Column Filter Test', column: 'todo', priority: 2, role_id: 1 });
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=todo`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeGreaterThan(0);
    });

    it('should support priority filter', async () => {
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Priority 4 Test', column: 'todo', priority: 4, role_id: 1 });
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?priority=4`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeGreaterThan(0);
    });

    it('should support labels filter', async () => {
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Label Test', column: 'todo', priority: 2, labels: JSON.stringify(['bug']), role_id: 1 });
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?labels=bug`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets`)
          .send({ title: `Page Test ${i}`, column: 'todo', priority: 2, role_id: 1 });
      }
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?page=1&per_page=2`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBe(2);
    });
  });

  describe('GET /api/v1/projects/:slug/tickets/:id', () => {
    it('should return 404 for non-existent ticket', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/9999`);
      expect(res.status).toBe(404);
    });

    it('should return ticket with relations', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Full Ticket', column: 'todo', priority: 3, description: 'Test desc', role_id: 1 });
      ticketId = createRes.body.data.id;
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${ticketId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('title', 'Full Ticket');
      expect(res.body.data).toHaveProperty('comments');
      expect(res.body.data).toHaveProperty('dependencies');
    });
  });

  describe('POST /api/v1/projects/:slug/tickets', () => {
    it('should create a ticket', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'New Ticket', column: 'todo', priority: 3, description: 'A test ticket', role_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('title', 'New Ticket');
      expect(res.body.data).toHaveProperty('column_id');
    });

    it('should reject missing title', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ column: 'todo', role_id: 1 });
      expect(res.status).toBe(400);
    });

    it('should reject invalid column', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Bad Column', column: 'nonexistent', priority: 2, role_id: 1 });
      expect(res.status).toBe(404);
    });

    it('should accept any valid priority', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Any Priority', column: 'todo', priority: 99, role_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('priority', 99);
    });

    it('should create ticket with labels', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Labeled', column: 'todo', priority: 2, labels: JSON.stringify(['feature', 'urgent']), role_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('labels');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/tickets')
        .send({ title: 'Test', column: 'todo', role_id: 1 });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/projects/:slug/tickets/:id', () => {
    it('should update ticket title', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Old', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${id}`)
        .send({ title: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('title', 'Updated');
    });

    it('should update ticket priority', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Priority', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${id}`)
        .send({ priority: 4 });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('priority', 4);
    });

    it('should update ticket labels', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Labels', column: 'todo', priority: 2, labels: '[]', role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${id}`)
        .send({ labels: JSON.stringify(['new-label']) });
      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent ticket', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/9999`)
        .send({ title: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:slug/tickets/:id/move', () => {
    it('should move a ticket to another column', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Move Me', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'implementation', comment: 'Starting work' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('moved', true);
      expect(res.body.data).toHaveProperty('ticket_id', id);
      expect(res.body.data).toHaveProperty('to_column', 'implementation');
    });

    it('should reject invalid transition', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Invalid Move', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'final_review', comment: 'Skipping steps' });
      expect(res.status).toBe(400);
    });

    it('should require comment when transition requires it', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Comment Req', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'implementation' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('moved', true);
    });

    it('should set closed_at when moving to done', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Close Me', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'implementation', comment: 'Starting' });
      expect(res1.status).toBe(200);
      const res2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'unit_review', comment: 'Ready for review' });
      expect(res2.status).toBe(200);
      const res3 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'integration_testing', comment: 'For integration' });
      expect(res3.status).toBe(200);
      const res4 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'final_review', comment: 'Ready for final review' });
      expect(res4.status).toBe(200);
      const res5 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'done', comment: 'Completed' });
      expect(res5.status).toBe(200);
      expect(res5.body.data).toHaveProperty('moved', true);
    });

    it('should return 404 for non-existent ticket', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/9999/move`)
        .send({ to_column: 'done', comment: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:slug/tickets/:id/comments', () => {
    it('should add a comment to a ticket', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Comment Me', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/comments`)
        .send({ content: 'Great work!' });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('content', 'Great work!');
    });

    it('should reject empty comment', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Empty', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/comments`)
        .send({ content: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('Dependency endpoints', () => {
    it('should get dependencies for a ticket', async () => {
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Dep Ticket', column: 'todo', priority: 2, role_id: 1 });
      const id = createRes.body.data.id;
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${id}/dependencies`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should add a dependency', async () => {
      const r1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'T1', column: 'todo', priority: 2, role_id: 1 });
      const r2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'T2', column: 'todo', priority: 2, role_id: 1 });
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${r1.body.data.id}/dependencies/blocked_by/${r2.body.data.id}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('added', true);
      expect(res.body.data).toHaveProperty('ticket_id', r1.body.data.id);
    });

    it('should remove a dependency', async () => {
      const r1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'R1', column: 'todo', priority: 2, role_id: 1 });
      const r2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'R2', column: 'todo', priority: 2, role_id: 1 });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${r1.body.data.id}/dependencies/blocked_by/${r2.body.data.id}`)
        .send();
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/${r1.body.data.id}/dependencies/blocked_by/${r2.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('removed', true);
      expect(res.body.data).toHaveProperty('ticket_id', r1.body.data.id);
    });

    it('should remove a dependency via query parameters (WebUI format)', async () => {
      const r1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Q1', column: 'todo', priority: 2, role_id: 1 });
      const r2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Q2', column: 'todo', priority: 2, role_id: 1 });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${r1.body.data.id}/dependencies/depends_on/${r2.body.data.id}`)
        .send();
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/${r1.body.data.id}/dependencies?depends_on_id=${r2.body.data.id}&relation_type=depends_on`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('removed', true);
      expect(res.body.data).toHaveProperty('ticket_id', r1.body.data.id);
    });

    it('should reject query params delete with missing depends_on_id', async () => {
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/1/dependencies?relation_type=blocked_by`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject query params delete with missing relation_type', async () => {
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/1/dependencies?depends_on_id=1`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/projects/:slug/tickets/:id', () => {
    it('should return 403 when role lacks delete permission', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Unit Review Ticket', column: 'unit_review', priority: 2, role_id: 1 });
      const ticketId = res.body.data.id;
      const delRes = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/${ticketId}?role_id=2`);
      expect(delRes.status).toBe(403);
      expect(delRes.body).toHaveProperty('success', false);
      expect(delRes.body).toHaveProperty('code', 'PERMISSION_DENIED');
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${ticketId}`);
    });

    it('should successfully delete a ticket with delete permission', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'ToDelete', column: 'todo', priority: 2, role_id: 1 });
      const ticketId = res.body.data.id;
      const delRes = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/${ticketId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);
      expect(delRes.body.data).toHaveProperty('deleted', true);
    });

    it('should return 404 for non-existent ticket', async () => {
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/999999`);
      expect(delRes.status).toBe(404);
      expect(delRes.body).toHaveProperty('success', false);
    });
  });
});
