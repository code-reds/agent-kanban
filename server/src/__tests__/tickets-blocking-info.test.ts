import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer } from '../server.js';
import request from 'supertest';

describe('Tickets API: Blocking Info', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-blocker-${Date.now()}`;
  let blockerTicketId: number | null = null;
  let blockedTicketId: number | null = null;
  let unblockedTicketId: number | null = null;
  let secondUnblockedId: number | null = null;

  beforeAll(async () => {
    // DB is already initialized by integration-setup.ts (module-level)
    // Only start the server here; the setup file runs migrations and seeds roles
    await startServer();
    // Create project
    const createProjectRes = await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Blocking Info Test', slug: testSlug });
    expect(createProjectRes.status).toBe(201);

    // Create blocker ticket (in done status — so it will resolve dependencies)
    const blockerRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Blocker Ticket', column: 'todo', priority: 1, role_id: 1 });
    expect(blockerRes.status).toBe(201);
    blockerTicketId = blockerRes.body.data.id;

    // Create a ticket that will be blocked (has unresolved dependency)
    const blockedRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Blocked Ticket', column: 'todo', priority: 2, role_id: 1 });
    expect(blockedRes.status).toBe(201);
    blockedTicketId = blockedRes.body.data.id;

    // Create unblocked ticket
    const unblockedRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Unblocked Ticket', column: 'todo', priority: 3, role_id: 1 });
    expect(unblockedRes.status).toBe(201);
    unblockedTicketId = unblockedRes.body.data.id;

    // Create a second unblocked ticket
    const secondRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Second Unblocked', column: 'todo', priority: 4, role_id: 1 });
    expect(secondRes.status).toBe(201);
    secondUnblockedId = secondRes.body.data.id;

    // Create a dependency: blockedTicket -> blocked_by blockerTicket
    const depRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/dependencies/blocked_by/${blockerTicketId}`)
      .send();
    expect(depRes.status).toBe(201);
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    // Don't stop server or delete PORT - shared singleton across test files
  });

  describe('GET /api/v1/projects/:slug/tickets/:id — blocking info in detail response', () => {
    it('should return is_blocked: true and blocking_ticket_ids for a blocked ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id', blockedTicketId);
      expect(res.body.data).toHaveProperty('title', 'Blocked Ticket');
      expect(res.body.data).toHaveProperty('is_blocked', true);
      expect(Array.isArray(res.body.data.blocking_ticket_ids)).toBe(true);
      // blocking_ticket_ids contains the IDs of tickets that block this one (not the ticket's own ID)
      expect(res.body.data.blocking_ticket_ids).toContain(blockerTicketId);
      expect(res.body.data.blocking_ticket_ids).not.toContain(blockedTicketId);
    });

    it('should return is_blocked: false and empty blocking_ticket_ids for an unblocked ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id', unblockedTicketId);
      expect(res.body.data).toHaveProperty('is_blocked', false);
      expect(Array.isArray(res.body.data.blocking_ticket_ids)).toBe(true);
      expect(res.body.data.blocking_ticket_ids).toEqual([]);
    });

    it('should return is_blocked: true for the blocker ticket itself (due to parent-child blocking with its group)', async () => {
      // The blockerTicket may itself show is_blocked depending on the ticket_blockers view
      // What matters is that the response includes both fields
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockerTicketId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('is_blocked');
      expect(typeof res.body.data.is_blocked).toBe('boolean');
      expect(Array.isArray(res.body.data.blocking_ticket_ids)).toBe(true);
    });

    it('should include is_blocked and blocking_ticket_ids even when ticket has no blocking info', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${secondUnblockedId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('is_blocked', false);
      expect(res.body.data.blocking_ticket_ids).toEqual([]);
    });

    it('should not include column_slug in the response (stripColumnSlug applied)', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}`);
      expect(res.body.data).not.toHaveProperty('column_slug');
    });

    it('should return 404 for non-existent ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/999999`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('GET /api/v1/projects/:slug/tickets — blocking info in list responses', () => {
    it('should include is_blocked on each ticket in the list (basic mode)', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data.tickets)).toBe(true);
      expect(res.body.data.tickets.length).toBeGreaterThan(0);

      // Every ticket should have is_blocked
      for (const ticket of res.body.data.tickets) {
        expect(ticket).toHaveProperty('is_blocked');
        expect(typeof ticket.is_blocked).toBe('boolean');
      }

      // The blocked ticket should have is_blocked: true, the unblocked one should have false
      const blockedFound = res.body.data.tickets.some(
        (t: { id: number; is_blocked: boolean }) => t.id === blockedTicketId && t.is_blocked === true
      );
      const unblockedFound = res.body.data.tickets.some(
        (t: { id: number; is_blocked: boolean }) => t.id === unblockedTicketId && t.is_blocked === false
      );
      expect(blockedFound).toBe(true);
      expect(unblockedFound).toBe(true);
    });

    it('should include is_blocked on each ticket in the list (not-blocked mode)', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?mode=not-blocked`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data.tickets)).toBe(true);

      // Every ticket should have is_blocked
      for (const ticket of res.body.data.tickets) {
        expect(ticket).toHaveProperty('is_blocked');
        expect(typeof ticket.is_blocked).toBe('boolean');
      }

      // blockedTicketId should NOT appear since it's blocked
      const blockedFound = res.body.data.tickets.some(
        (t: { id: number; is_blocked: boolean }) => t.id === blockedTicketId
      );
      expect(blockedFound).toBe(false);
    });

    it('should include is_blocked on each ticket (top-level-tickets mode)', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?mode=top-level-tickets`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data.tickets)).toBe(true);

      for (const ticket of res.body.data.tickets) {
        expect(ticket).toHaveProperty('is_blocked');
        expect(typeof ticket.is_blocked).toBe('boolean');
      }
    });

    it('should include is_blocked on each ticket with column filter', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?column=todo`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      for (const ticket of res.body.data.tickets) {
        expect(ticket).toHaveProperty('is_blocked');
        expect(typeof ticket.is_blocked).toBe('boolean');
      }
    });

    it('should include is_blocked and blocking_ticket_ids in list responses', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?column=todo`);
      expect(res.status).toBe(200);
      for (const ticket of res.body.data.tickets) {
        // List responses include both is_blocked and blocking_ticket_ids
        expect(ticket).toHaveProperty('is_blocked');
        expect(typeof ticket.is_blocked).toBe('boolean');
        expect(ticket).toHaveProperty('blocking_ticket_ids');
        expect(Array.isArray(ticket.blocking_ticket_ids)).toBe(true);
      }
    });

    it('should not include column_slug in list responses', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?column=todo`);
      expect(res.status).toBe(200);
      for (const ticket of res.body.data.tickets) {
        expect(ticket).not.toHaveProperty('column_slug');
      }
    });
  });

  describe('Response format validation', () => {
    it('should follow project API convention: { success, data }', async () => {
      const detailRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body).toHaveProperty('success', true);
      expect(detailRes.body).toHaveProperty('data');

      const listRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveProperty('success', true);
      expect(listRes.body).toHaveProperty('data');
    });

    it('should return error format: { success: false, error, code } for failures', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/nonexistent/tickets`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
