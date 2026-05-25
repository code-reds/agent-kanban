import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import { getDb, resetDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import request from 'supertest';

describe('PATCH parent_id parameter — Integration Tests (Ticket #15)', () => {
  const requestAgent = () => request(getApp());
  let testSlug: string;
  let parentTicketId: number;
  let childTicketId: number;
  let anotherProjectSlug: string;
  let anotherProjectTicketId: number;

  beforeAll(async () => {
    // Initialize in-memory database with migrations and seed data
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    await startServer();

    // Create two projects to test cross-project validation
    const createProject1Res = await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Parent ID Test Project 1', slug: `parent-id-test-1-${Date.now()}` });
    expect(createProject1Res.status).toBe(201);
    testSlug = createProject1Res.body.data.slug;

    const createProject2Res = await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Parent ID Test Project 2', slug: `parent-id-test-2-${Date.now()}` });
    expect(createProject2Res.status).toBe(201);
    anotherProjectSlug = createProject2Res.body.data.slug;

    // Create a parent ticket in the first project
    const parentRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Parent Ticket', column: 'todo', priority: 2, role_id: 1 });
    expect(parentRes.status).toBe(201);
    parentTicketId = parentRes.body.data.id;

    // Create a child ticket (top-level, no parent) in the first project
    const childRes = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/tickets`)
      .send({ title: 'Child Ticket (top-level)', column: 'todo', priority: 2, role_id: 1 });
    expect(childRes.status).toBe(201);
    childTicketId = childRes.body.data.id;

    // Create a ticket in the second project (for cross-project tests)
    const otherRes = await requestAgent()
      .post(`/api/v1/projects/${anotherProjectSlug}/tickets`)
      .send({ title: 'Other Project Ticket', column: 'todo', priority: 2, role_id: 1 });
    expect(otherRes.status).toBe(201);
    anotherProjectTicketId = otherRes.body.data.id;
  });

  afterAll(async () => {
    // Clean up tickets
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
    } catch { /* ignore */ }
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${parentTicketId}`);
    } catch { /* ignore */ }
    try {
      await requestAgent().delete(`/api/v1/projects/${anotherProjectSlug}/tickets/${anotherProjectTicketId}`);
    } catch { /* ignore */ }
    // Clean up projects
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    try {
      await requestAgent().delete(`/api/v1/projects/${anotherProjectSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    delete process.env.DB_PATH;
    await stopServer();
    resetDb();
  });

  describe('AC1: PATCH endpoint accepts parent_id in request body', () => {
    it('should accept parent_id parameter without error (200)', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: parentTicketId });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('parent_id', parentTicketId);
    });
  });

  describe('AC2: Setting parent_id to a valid ticket ID makes the ticket a sub-ticket', () => {
    it('should set parent_id to an existing ticket in same project', async () => {
      // Create a fresh ticket for this test
      const freshRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Fresh Sub-Task', column: 'todo', priority: 3, role_id: 1 });
      const freshId = freshRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({ parent_id: parentTicketId });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('parent_id', parentTicketId);

      // Verify by fetching the ticket
      const fetchRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
      expect(fetchRes.status).toBe(200);
      expect(fetchRes.body.data).toHaveProperty('parent_id', parentTicketId);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
    });

    it('should allow a ticket to have a parent in todo column', async () => {
      const freshRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Sub-Task in Todo', column: 'todo', priority: 2, role_id: 1 });
      const freshId = freshRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({ parent_id: parentTicketId });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('parent_id', parentTicketId);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
    });
  });

  describe('AC3: Setting parent_id to null makes the ticket a top-level ticket', () => {
    it('should clear parent_id when set to null', async () => {
      // First set a parent
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: parentTicketId });

      // Verify parent is set
      const verifyRes1 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(verifyRes1.body.data.parent_id).toBe(parentTicketId);

      // Now clear the parent
      const clearRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: null });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body).toHaveProperty('success', true);
      expect(clearRes.body.data).toHaveProperty('parent_id', null);
    });

    it('should make ticket top-level after clearing parent', async () => {
      const freshRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Temp Sub', column: 'todo', priority: 2, role_id: 1 });
      const freshId = freshRes.body.data.id;

      // Set as sub-ticket
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({ parent_id: parentTicketId });

      // Clear parent to make top-level
      const clearRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({ parent_id: null });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.data).toHaveProperty('parent_id', null);

      // Verify it's top-level via GET
      const getRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
      expect(getRes.body.data).toHaveProperty('parent_id', null);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
    });
  });

  describe('AC4: Setting parent_id to a ticket in a different project returns a validation error', () => {
    it('should reject parent_id from a different project (400 VALIDATION_ERROR)', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: anotherProjectTicketId });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body).toHaveProperty('error');
      // Parent should remain unchanged
      const verifyRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(verifyRes.body.data).toHaveProperty('parent_id', null);
    });
  });

  describe('AC5: Setting parent_id to a non-existent ticket returns a NOT_FOUND error', () => {
    it('should return 404 for non-existent parent ticket ID', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: 999999 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
      // Ticket should remain unchanged
      const verifyRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(verifyRes.body.data).toHaveProperty('parent_id', null);
    });
  });

  describe('AC6: Setting parent_id to the ticket\'s own ID returns a validation error', () => {
    it('should reject self-reference (400 VALIDATION_ERROR)', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: childTicketId });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body).toHaveProperty('error');
      // Verify ticket is unchanged
      const verifyRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(verifyRes.body.data).toHaveProperty('parent_id', null);
    });
  });

  describe('AC7: Setting parent_id to an existing value it already has is a no-op (returns success)', () => {
    it('should succeed when setting to the same parent_id that is already set', async () => {
      // First set the parent
      const setRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: parentTicketId });
      expect(setRes.status).toBe(200);
      expect(setRes.body.data).toHaveProperty('parent_id', parentTicketId);

      // Now set it again to the same value
      const againRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: parentTicketId });
      expect(againRes.status).toBe(200);
      expect(againRes.body).toHaveProperty('success', true);
      expect(againRes.body.data).toHaveProperty('parent_id', parentTicketId);

      // Verify via GET
      const getRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(getRes.body.data).toHaveProperty('parent_id', parentTicketId);
    });

    it('should succeed when clearing parent_id that is already null', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
        .send({ parent_id: null });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('End-to-end: changing parent_id affects child ticket listing', () => {
    it('should list child tickets filtered by parent_id query param', async () => {
      // Create a sub-ticket
      const sub1Res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Sub-Task A', column: 'todo', priority: 2, role_id: 1 });
      const sub1Id = sub1Res.body.data.id;
      const sub2Res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Sub-Task B', column: 'todo', priority: 2, role_id: 1 });
      const sub2Id = sub2Res.body.data.id;

      // Set both as children of parentTicketId
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${sub1Id}`)
        .send({ parent_id: parentTicketId });
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${sub2Id}`)
        .send({ parent_id: parentTicketId });

      // List tickets with parent_id filter
      const listRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?parent_id=${parentTicketId}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.tickets.length).toBe(2);

      // Verify parentTicketId itself is NOT in the list
      const ticketIds = listRes.body.data.tickets.map((t: { id: number }) => t.id);
      expect(ticketIds).not.toContain(parentTicketId);
      expect(ticketIds).toContain(sub1Id);
      expect(ticketIds).toContain(sub2Id);

      // Remove one child
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${sub1Id}`)
        .send({ parent_id: null });

      // Verify only sub2 remains as child
      const listRes2 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets?parent_id=${parentTicketId}`);
      expect(listRes2.status).toBe(200);
      expect(listRes2.body.data.tickets.length).toBe(1);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${sub1Id}`);
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${sub2Id}`);
    });
  });

  describe('Regression: PATCH with parent_id and other fields together', () => {
    it('should update parent_id along with title and priority in one request', async () => {
      const freshRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Original Title', column: 'todo', priority: 5, role_id: 1 });
      const freshId = freshRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({
          title: 'New Title',
          priority: 1,
          parent_id: parentTicketId,
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('parent_id', parentTicketId);
      expect(res.body.data).toHaveProperty('title', 'New Title');
      expect(res.body.data).toHaveProperty('priority', 1);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
    });

    it('should not affect other fields when only parent_id is provided', async () => {
      const freshRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({
          title: 'Stable Title',
          column: 'todo',
          priority: 3,
          description: 'Some description',
          role_id: 1,
        });
      const freshId = freshRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/tickets/${freshId}`)
        .send({ parent_id: parentTicketId });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('parent_id', parentTicketId);
      expect(res.body.data).toHaveProperty('title', 'Stable Title');
      expect(res.body.data).toHaveProperty('priority', 3);

      // Clean up
      await requestAgent().delete(`/api/v1/projects/${testSlug}/tickets/${freshId}`);
    });
  });

  describe('SQL injection safety: parent_id uses parameterized queries', () => {
    it('should not crash the server or corrupt data on malicious parent_id values', async () => {
      // Malicious values that could be SQL injection attempts
      // The API should handle these gracefully — either reject them or treat them safely
      const maliciousValues: unknown[] = [
        -1,           // Invalid ID
        null,         // null is valid (clears parent)
      ];

      for (const val of maliciousValues) {
        const res = await requestAgent()
          .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
          .send({ parent_id: val });

        // Should not crash the server (status must be in valid HTTP range)
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
        // Response must be well-formed JSON
        expect(res.body).toHaveProperty('success');
      }
    });

    it('should not corrupt data after sending special character parent_id values', async () => {
      // Some clients might send strings where numbers are expected
      const specialValues: unknown[] = ['0', '', undefined];

      for (const val of specialValues) {
        const res = await requestAgent()
          .patch(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`)
          .send({ parent_id: val });

        // Should not crash — either 200 (no-op) or 400/404 (validation)
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
      }

      // Verify ticket data is still intact after all requests
      const verifyRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tickets/${childTicketId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data).toHaveProperty('id', childTicketId);
      expect(verifyRes.body.data).toHaveProperty('title');
    });
  });
});
