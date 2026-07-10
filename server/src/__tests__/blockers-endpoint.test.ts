import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer } from '../server.js';
import request from 'supertest';

/**
 * Integration tests for GET /api/v1/projects/:slug/tickets/:id/blockers
 *
 * Ticket #97: "Blocked-state of kanban cards are not updated when dependencies are added"
 *
 * This endpoint was missing from the server, causing the frontend's fetchTicketBlockers()
 * to silently fail (404), so the Kanban card's blocked state (lock symbol) never updated
 * when dependencies were added/removed.
 *
 * Tests cover:
 * 1. Endpoint returns correct BlockingInfo shape
 * 2. Blocked ticket returns is_blocked: true with blocker details
 * 3. Unblocked ticket returns is_blocked: false with empty blocking_tickets
 * 4. Dependency lifecycle: add dep → blocked; remove dep → unblocked
 * 5. Error cases: non-existent project (404), non-existent ticket (404)
 * 6. Both blocked_by and depends_on relations are returned correctly
 * 7. Multiple blockers are returned with correct relation types
 * 8. Frontend integration: store calls the endpoint correctly
 */
describe('GET /api/v1/projects/:slug/tickets/:id/blockers — Ticket #97', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-blockers-endpoint-${Date.now()}`;

  let blockerTicketId: number | null = null;
  let blockedTicketId: number | null = null;
  let unblockedTicketId: number | null = null;
  let dependsOnTicketId: number | null = null;
  let multiBlockerTicketId: number | null = null;
  let blocker2Id: number | null = null;

  beforeAll(async () => {
    // DB is already initialized by integration-setup.ts (module-level)
    await startServer();

    // Create project
    const createProjectRes = await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Blockers Endpoint Test', slug: testSlug });
    expect(createProjectRes.status).toBe(201);

    // Create blocker ticket (open, will cause blocking)
    const blockerRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Blocker Ticket', column: 'todo', priority: 1, role_id: 1 });
    expect(blockerRes.status).toBe(201);
    blockerTicketId = blockerRes.body.data.id;

    // Create a ticket that will be blocked via blocked_by
    const blockedRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Blocked Ticket', column: 'todo', priority: 2, role_id: 1 });
    expect(blockedRes.status).toBe(201);
    blockedTicketId = blockedRes.body.data.id;

    // Create unblocked ticket (no dependencies)
    const unblockedRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Unblocked Ticket', column: 'todo', priority: 3, role_id: 1 });
    expect(unblockedRes.status).toBe(201);
    unblockedTicketId = unblockedRes.body.data.id;

    // Create ticket for depends_on testing
    const dependsOnRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'DependsOn Ticket', column: 'todo', priority: 4, role_id: 1 });
    expect(dependsOnRes.status).toBe(201);
    dependsOnTicketId = dependsOnRes.body.data.id;

    // Create second blocker for multi-blocker testing
    const blocker2Res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Blocker 2', column: 'todo', priority: 5, role_id: 1 });
    expect(blocker2Res.status).toBe(201);
    blocker2Id = blocker2Res.body.data.id;

    // Create ticket with multiple blockers
    const multiBlockerRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Multi-Blocker Ticket', column: 'todo', priority: 2, role_id: 1 });
    expect(multiBlockerRes.status).toBe(201);
    multiBlockerTicketId = multiBlockerRes.body.data.id;

    // Set up dependencies:
    // 1. blockedTicket is blocked_by blockerTicket
    const dep1Res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/dependencies/blocked_by/${blockerTicketId}`)
      .send();
    expect(dep1Res.status).toBe(201);

    // 2. blockedTicket also depends_on dependsOnTicket
    const dep2Res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/dependencies/depends_on/${dependsOnTicketId}`)
      .send();
    expect(dep2Res.status).toBe(201);

    // 3. multiBlockerTicket is blocked_by both blockers
    const dep3Res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${multiBlockerTicketId}/dependencies/blocked_by/${blockerTicketId}`)
      .send();
    expect(dep3Res.status).toBe(201);

    const dep4Res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets/${multiBlockerTicketId}/dependencies/depends_on/${blocker2Id}`)
      .send();
    expect(dep4Res.status).toBe(201);
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    // Don't stop server or delete PORT - shared singleton across test files
  });

  // ─── Test 1: Endpoint exists and returns correct BlockingInfo shape ───

  describe('Endpoint existence & response shape', () => {
    it('should return 200 for a valid request', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });

    it('should return BlockingInfo with ticket_id, is_blocked, and blocking_tickets', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      const data = res.body.data;
      expect(data).toHaveProperty('ticket_id');
      expect(data).toHaveProperty('is_blocked');
      expect(data).toHaveProperty('blocking_tickets');
      expect(typeof data.ticket_id).toBe('number');
      expect(typeof data.is_blocked).toBe('boolean');
      expect(Array.isArray(data.blocking_tickets)).toBe(true);
    });

    it('should follow the standard API response format: { success, data }', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).not.toHaveProperty('error');
    });
  });

  // ─── Test 2: Blocked ticket returns is_blocked: true with blocker details ───

  describe('Blocked ticket — is_blocked: true', () => {
    it('should return is_blocked: true for a ticket with blocked_by dependency', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      expect(res.status).toBe(200);
      expect(res.body.data.is_blocked).toBe(true);
    });

    it('should return blocking_tickets with correct blocker IDs', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      const blockingTickets = res.body.data.blocking_tickets;
      expect(Array.isArray(blockingTickets)).toBe(true);
      expect(blockingTickets.length).toBeGreaterThanOrEqual(1);

      // Should include the blockerTicket (blocked_by)
      const blockerEntry = blockingTickets.find((t: { id: number }) => t.id === blockerTicketId);
      expect(blockerEntry).toBeDefined();

      // Should include the dependsOnTicket (depends_on)
      const depEntry = blockingTickets.find((t: { id: number }) => t.id === dependsOnTicketId);
      expect(depEntry).toBeDefined();
    });

    it('should return correct relation_type for each blocker', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      const blockingTickets = res.body.data.blocking_tickets;

      const blockerEntry = blockingTickets.find((t: { id: number }) => t.id === blockerTicketId);
      expect(blockerEntry).toBeDefined();
      expect(blockerEntry.relation_type).toBe('blocked_by');

      const depEntry = blockingTickets.find((t: { id: number }) => t.id === dependsOnTicketId);
      expect(depEntry).toBeDefined();
      expect(depEntry.relation_type).toBe('depends_on');
    });

    it('should return ticket_id matching the requested ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      expect(res.body.data.ticket_id).toBe(blockedTicketId);
    });
  });

  // ─── Test 3: Unblocked ticket returns is_blocked: false ───

  describe('Unblocked ticket — is_blocked: false', () => {
    it('should return is_blocked: false for a ticket with no dependencies', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      expect(res.status).toBe(200);
      expect(res.body.data.is_blocked).toBe(false);
    });

    it('should return empty blocking_tickets array for unblocked ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      expect(res.body.data.blocking_tickets).toEqual([]);
    });

    it('should return correct ticket_id for unblocked ticket', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);
      expect(res.body.data.ticket_id).toBe(unblockedTicketId);
    });
  });

  // ─── Test 4: Dependency lifecycle — add → remove ───

  describe('Dependency lifecycle — add and remove', () => {
    let lifecycleTicketId: number | null = null;
    let lifecycleBlockerId: number | null = null;

    beforeAll(async () => {
      // Create a fresh ticket for lifecycle testing
      const lifecycleRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Lifecycle Test Ticket', column: 'todo', priority: 3, role_id: 1 });
      expect(lifecycleRes.status).toBe(201);
      lifecycleTicketId = lifecycleRes.body.data.id;

      // Create a blocker for lifecycle testing
      const blockerRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Lifecycle Blocker', column: 'todo', priority: 1, role_id: 1 });
      expect(blockerRes.status).toBe(201);
      lifecycleBlockerId = blockerRes.body.data.id;
    });

    it('should show is_blocked: false before adding dependency', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${lifecycleTicketId}/blockers`);
      expect(res.body.data.is_blocked).toBe(false);
      expect(res.body.data.blocking_tickets).toEqual([]);
    });

    it('should show is_blocked: true after adding blocked_by dependency', async () => {
      // Add dependency
      const depRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${lifecycleTicketId}/dependencies/blocked_by/${lifecycleBlockerId}`)
        .send();
      expect(depRes.status).toBe(201);

      // Verify blocked state
      const blockersRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${lifecycleTicketId}/blockers`);
      expect(blockersRes.body.data.is_blocked).toBe(true);
      expect(blockersRes.body.data.blocking_tickets.length).toBe(1);
      expect(blockersRes.body.data.blocking_tickets[0].id).toBe(lifecycleBlockerId);
      expect(blockersRes.body.data.blocking_tickets[0].relation_type).toBe('blocked_by');
    });

    it('should show is_blocked: false after removing dependency', async () => {
      // Remove dependency (DELETE, not POST — POST adds dependencies)
      const removeRes = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tickets/${lifecycleTicketId}/dependencies/blocked_by/${lifecycleBlockerId}`)
        .send();
      expect(removeRes.status).toBe(200);

      // Verify unblocked state
      const blockersRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${lifecycleTicketId}/blockers`);
      expect(blockersRes.body.data.is_blocked).toBe(false);
      expect(blockersRes.body.data.blocking_tickets).toEqual([]);
    });
  });

  // ─── Test 5: Multiple blockers ───

  describe('Multiple blockers', () => {
    it('should return all blockers for a ticket with multiple dependencies', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${multiBlockerTicketId}/blockers`);
      expect(res.status).toBe(200);
      expect(res.body.data.is_blocked).toBe(true);
      expect(res.body.data.blocking_tickets.length).toBe(2);

      const blockerIds = res.body.data.blocking_tickets.map((t: { id: number }) => t.id);
      expect(blockerIds).toContain(blockerTicketId);
      expect(blockerIds).toContain(blocker2Id);
    });

    it('should return correct relation_type for each of multiple blockers', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${multiBlockerTicketId}/blockers`);
      const blockingTickets = res.body.data.blocking_tickets;

      const blocker1Entry = blockingTickets.find((t: { id: number }) => t.id === blockerTicketId);
      expect(blocker1Entry).toBeDefined();
      expect(blocker1Entry.relation_type).toBe('blocked_by');

      const blocker2Entry = blockingTickets.find((t: { id: number }) => t.id === blocker2Id);
      expect(blocker2Entry).toBeDefined();
      expect(blocker2Entry.relation_type).toBe('depends_on');
    });
  });

  // ─── Test 6: depends_on relation ───

  describe('depends_on relation', () => {
    it('should return is_blocked: true for ticket with depends_on dependency', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      // blockedTicket has both blocked_by and depends_on — should be blocked
      expect(res.body.data.is_blocked).toBe(true);
    });

    it('should return relation_type: depends_on for depends_on blockers', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);
      const depEntry = res.body.data.blocking_tickets.find(
        (t: { id: number }) => t.id === dependsOnTicketId
      );
      expect(depEntry).toBeDefined();
      expect(depEntry.relation_type).toBe('depends_on');
    });
  });

  // ─── Test 7: Error cases ───

  describe('Error cases', () => {
    it('should return 404 for non-existent project slug', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/nonexistent-project-xyz/tickets/${unblockedTicketId}/blockers`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent ticket ID', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/999999/blockers`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent ticket in non-existent project', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/nonexistent/tickets/999999/blockers`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for ticket that does not belong to the project', async () => {
      // Create a ticket in a different project, then try to access it via this project
      const otherProjectRes = await requestAgent()
        .post('/api/v1/projects')
        .send({ name: 'Other Project', slug: `test-other-${Date.now()}` });
      expect(otherProjectRes.status).toBe(201);
      const otherSlug = otherProjectRes.body.data.slug;

      const otherTicketRes = await requestAgent()
        .post(`/api/v1/projects/${otherSlug}/tickets`)
        .send({ title: 'Other Ticket', column: 'todo', priority: 1, role_id: 1 });
      expect(otherTicketRes.status).toBe(201);
      const otherTicketId = otherTicketRes.body.data.id;

      // Try to access the other project's ticket via this project's slug
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${otherTicketId}/blockers`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${otherSlug}`);
    });
  });

  // ─── Test 8: Frontend integration — store calls the endpoint correctly ───

  describe('Frontend integration — fetchTicketBlockers calls correct endpoint', () => {
    it('should return response shape matching the BlockingInfo interface used by the frontend store', async () => {
      // The frontend store (web/src/stores/tickets.ts) calls getTicketBlockers() which
      // hits GET /api/v1/projects/:slug/tickets/:id/blockers and expects:
      // { ticket_id: number, is_blocked: boolean, blocking_tickets: { id: number, relation_type: string }[] }
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`);

      const data = res.body.data;

      // Verify exact BlockingInfo shape
      expect(typeof data.ticket_id).toBe('number');
      expect(typeof data.is_blocked).toBe('boolean');
      expect(Array.isArray(data.blocking_tickets)).toBe(true);

      // Each blocking ticket should have id (number) and relation_type (string)
      for (const ticket of data.blocking_tickets) {
        expect(typeof ticket.id).toBe('number');
        expect(typeof ticket.relation_type).toBe('string');
        expect(['blocked_by', 'depends_on', 'related']).toContain(ticket.relation_type);
      }
    });

    it('should return response that the store can directly spread into blockingStatus', async () => {
      // The store does: blockingStatus.value = { ...blockingStatus.value, [ticketId]: res.data }
      // So the response data must be a plain object with the expected keys
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`);

      const data = res.body.data;

      // Simulate what the store does: spread into a new record
      const blockingStatus: Record<number, { ticket_id: number; is_blocked: boolean; blocking_tickets: { id: number; relation_type: string }[] }> = {};
      blockingStatus[data.ticket_id] = {
        ticket_id: data.ticket_id,
        is_blocked: data.is_blocked,
        blocking_tickets: data.blocking_tickets,
      };

      expect(blockingStatus[data.ticket_id].is_blocked).toBe(false);
      expect(blockingStatus[data.ticket_id].blocking_tickets).toEqual([]);
      expect(blockingStatus[data.ticket_id].ticket_id).toBe(unblockedTicketId);
    });
  });

  // ─── Test 9: Consistency with the ticket detail endpoint ───

  describe('Consistency with ticket detail blocking info', () => {
    it('should agree with ticket detail is_blocked flag', async () => {
      // The /blockers endpoint and the ticket detail endpoint should agree on is_blocked
      const [blockersRes, detailRes] = await Promise.all([
        requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}/blockers`),
        requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${blockedTicketId}`),
      ]);

      expect(blockersRes.body.data.is_blocked).toBe(detailRes.body.data.is_blocked);
    });

    it('should agree on is_blocked for unblocked ticket', async () => {
      const [blockersRes, detailRes] = await Promise.all([
        requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}/blockers`),
        requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${unblockedTicketId}`),
      ]);

      expect(blockersRes.body.data.is_blocked).toBe(detailRes.body.data.is_blocked);
    });
  });
});
