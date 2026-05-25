import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('All Tickets and Done Limit Integration Tests', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-all-tickets-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    // Create test project
    const res = await requestAgent().post('/api/v1/projects').send({ name: 'All Tickets Test', slug: testSlug });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  async function moveToDone(ticketId: number): Promise<void> {
    await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
      .send({ to_column: 'implementation', comment: 'WIP' });
    await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
      .send({ to_column: 'unit_review', comment: 'Review' });
    await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
      .send({ to_column: 'integration_testing', comment: 'Integration' });
    await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
      .send({ to_column: 'final_review', comment: 'Final review' });
    await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
      .send({ to_column: 'done', comment: 'Completed' });
  }

  describe('GET /api/v1/projects/:slug/tickets?all_tickets=true', () => {
    it('should return all tickets (not just 20) when all_tickets=true', async () => {
      // Create 30 tickets
      for (let i = 0; i < 30; i++) {
        await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets`)
          .send({ title: `All Tickets Test ${i}`, column: 'todo', priority: 2, role_id: 1 });
      }

      // Without all_tickets, should get only 20
      const resDefault = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=todo`);
      expect(resDefault.status).toBe(200);
      expect(resDefault.body.data.tickets.length).toBe(20);

      // With all_tickets=true, should get all 30
      const resAll = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=todo&all_tickets=true`);
      expect(resAll.status).toBe(200);
      expect(resAll.body.data.tickets.length).toBe(30);
      expect(resAll.body.data.total).toBe(30);
    });

    it('should return up to 8 most recent done tickets when all_tickets=true&column=done', async () => {
      // Move 5 tickets to done
      for (let i = 0; i < 5; i++) {
        const createRes = await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets`)
          .send({ title: `Done Test ${i}`, column: 'todo', role_id: 1 });
        await moveToDone(createRes.body.data.id);
      }

      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=done&all_tickets=true`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeLessThanOrEqual(8);
      expect(res.body.data.total).toBe(5);
    });

    it('should return limited done tickets when done_limit is specified', async () => {
      // Create 10 more done tickets
      for (let i = 0; i < 10; i++) {
        const createRes = await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets`)
          .send({ title: `Done Limit Test ${i}`, column: 'todo', role_id: 1 });
        await moveToDone(createRes.body.data.id);
      }

      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=done&all_tickets=true&done_limit=5`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBe(5);
      // Total should reflect all done tickets, not just the limited ones
      expect(res.body.data.total).toBeGreaterThanOrEqual(5);
    });

    it('should return done tickets sorted by updated_at DESC (most recent first)', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=done&all_tickets=true&done_limit=50`);
      expect(res.status).toBe(200);
      // Verify sorting - tickets should be in descending order by updated_at
      const tickets = res.body.data.tickets;
      for (let i = 0; i < tickets.length - 1; i++) {
        expect(tickets[i].updated_at >= tickets[i + 1].updated_at).toBe(true);
      }
    });
  });

  describe('GET /api/v1/projects/:slug/tickets?per_page caps at 1000', () => {
    it('should cap per_page at 1000 even with very high value', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?per_page=5000`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeLessThanOrEqual(1000);
    });

    it('should cap per_page at 1000 for column=done requests', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?column=done&per_page=5000`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeLessThanOrEqual(1000);
    });

    it('should cap per_page at 1000 even when all_tickets=true', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true&per_page=5000`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('GET /api/v1/projects/:slug/tickets?all_tickets=true&column=done&done_limit=5', () => {
    it('should work with all parameters combined', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true&column=done&done_limit=5`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeLessThanOrEqual(5);
      expect(res.body.data.total).toBeGreaterThanOrEqual(res.body.data.tickets.length);
    });
  });

  describe('Response structure', () => {
    it('should return correct response structure with tickets and total', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('tickets');
      expect(res.body.data).toHaveProperty('total');
      expect(Array.isArray(res.body.data.tickets)).toBe(true);
    });
  });

  describe('all_tickets=true without column filter with done tickets', () => {
    it('should limit done tickets when all_tickets=true with no column filter', async () => {
      // Create 5 more todos and move them to done
      for (let i = 0; i < 5; i++) {
        const createRes = await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets`)
          .send({ title: `Done Limit Bug ${i}`, column: 'todo', role_id: 1 });
        await moveToDone(createRes.body.data.id);
      }

      // all_tickets=true without column filter should:
      // - Return all non-done tickets (unlimited, up to 1000)
      // - Return only 8 done tickets (default done_limit)
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true`);
      expect(res.status).toBe(200);

      const tickets = res.body.data.tickets;
      const total = res.body.data.total;

      // Count non-done vs done tickets in the response
      const nonDoneCount = tickets.filter((t: { column_slug: string }) => t.column_slug !== 'done').length;
      const doneCount = tickets.filter((t: { column_slug: string }) => t.column_slug === 'done').length;

      // Non-done tickets should be all of them (up to 1000)
      expect(nonDoneCount).toBeGreaterThan(0);

      // Done tickets should be limited to 8 (default done_limit)
      expect(doneCount).toBeLessThanOrEqual(8);

      // Total should reflect all tickets in the project
      expect(total).toBeGreaterThanOrEqual(nonDoneCount + doneCount);
    });

    it('should respect done_limit parameter with all_tickets and no column filter', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true&done_limit=3`);
      expect(res.status).toBe(200);

      const doneCount = res.body.data.tickets.filter((t: { column_slug: string }) => t.column_slug === 'done').length;
      expect(doneCount).toBeLessThanOrEqual(3);
    });

    it('done tickets should be sorted by updated_at DESC when all_tickets without column', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets?all_tickets=true`);
      expect(res.status).toBe(200);

      const doneTickets = res.body.data.tickets.filter((t: { column_slug: string }) => t.column_slug === 'done');
      // Verify done tickets are sorted by updated_at DESC
      for (let i = 0; i < doneTickets.length - 1; i++) {
        expect(doneTickets[i].updated_at >= doneTickets[i + 1].updated_at).toBe(true);
      }
    });
  });
});
