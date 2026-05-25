import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { getDb } from '../db/database.js';

describe('Ticket Re-open from Done Column', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `reopen-${Date.now()}`;
  let projectId: number;

  beforeAll(async () => {
    await startServer();
    const res = await requestAgent().post('/api/v1/projects').send({
      name: 'Re-open Test',
      slug: testSlug,
    });
    expect(res.status).toBe(201);
    projectId = res.body.data.id;
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  /**
   * Helper: query kanban_columns to get slug → id mapping for the project.
   * The REST API strips column_slug from ticket responses, so we use the DB directly.
   */
  function getColumnSlugMap(): Record<string, number> {
    const db = getDb();
    const rows = db.prepare<[number], { slug: string; id: number }>(
      `SELECT slug, id FROM kanban_columns WHERE project_id = ? ORDER BY id`
    ).all(projectId);
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.slug] = Number(r.id);
    }
    return map;
  }

  /**
   * Move a ticket through every column in the given order, with a comment on each step.
   * Returns the ticket ID.
   */
  async function moveThrough(
    ticketId: number,
    columns: string[],
    commentPrefix: string
  ): Promise<void> {
    for (const col of columns) {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: col, comment: `${commentPrefix}: ${col}` });
      expect(res.status).toBe(200);
    }
  }

  /**
   * Helper: query status_history with column slugs via JOIN.
   */
  function getStatusHistoryWithSlugs(ticketId: number) {
    const db = getDb();
    return db.prepare<[number], { from_column_slug: string; to_column_slug: string }>(
      `SELECT
         fc.slug AS from_column_slug,
         tc.slug AS to_column_slug
       FROM ticket_status_history sh
       JOIN kanban_columns fc ON sh.from_column_id = fc.id
       JOIN kanban_columns tc ON sh.to_column_id = tc.id
       WHERE sh.ticket_id = ?
       ORDER BY sh.created_at`
    ).all(ticketId);
  }

  describe('Re-opening a closed ticket (happy path)', () => {
    it('should allow Human User to re-open a ticket from done to implementation', async () => {
      // Create a ticket and move it all the way to done
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Re-open Test Ticket', column: 'todo', role_id: 1 });
      expect(createRes.status).toBe(201);
      const ticketId = createRes.body.data.id;

      // Move through full workflow to done
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      await moveThrough(ticketId, flow, 'moving');

      // Verify ticket is closed (use DB query since REST strips column_slug)
      const db = getDb();
      const colMap = getColumnSlugMap();
      const doneColId = colMap['done'];
      expect(doneColId).toBeDefined();
      const closedTicket = db.prepare<[number], { closed_at: string | null }>(
        `SELECT closed_at FROM tickets WHERE id = ?`
      ).get(ticketId)!;
      expect(closedTicket.closed_at).toBeDefined();
      expect(closedTicket.closed_at).not.toBeNull();

      // Re-open the ticket: move from done to implementation
      const reopenRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'Re-opening for additional work' });
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body).toHaveProperty('success', true);
      expect(reopenRes.body.data).toHaveProperty('moved', true);
      expect(reopenRes.body.data).toHaveProperty('to_column', 'implementation');

      // Verify closed_at is NULL after re-opening
      const verifyTicket = db.prepare<[number], { closed_at: string | null }>(
        `SELECT closed_at FROM tickets WHERE id = ?`
      ).get(ticketId)!;
      expect(verifyTicket.closed_at).toBeNull();

      // Verify ticket is now in implementation column
      const implColId = colMap['implementation'];
      expect(implColId).toBeDefined();
      const ticketCol = db.prepare<[number], { column_id: number }>(
        `SELECT column_id FROM tickets WHERE id = ?`
      ).get(ticketId)!;
      expect(Number(ticketCol.column_id)).toBe(implColId);
    });
  });

  describe('Re-opening requires a comment', () => {
    it('should reject re-opening without a comment', async () => {
      // Create a ticket and move it to done
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Re-open No Comment', column: 'todo', role_id: 1 });
      const ticketId = createRes.body.data.id;

      // Move to done
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      await moveThrough(ticketId, flow, 'moving');

      // Try to re-open without comment — should fail
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body.error).toContain('Comment is required');
    });
  });

  describe('closed_at is NULL after re-opening', () => {
    it('should verify closed_at is explicitly NULL after re-opening', async () => {
      // Create a ticket and move it to done
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Verify ClosedAt Null', column: 'todo', role_id: 1 });
      const ticketId = createRes.body.data.id;

      // Move to done
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      await moveThrough(ticketId, flow, 'moving');

      // Verify closed_at is set
      const db = getDb();
      let getRes = await db.prepare<[number], { closed_at: string | null }>(
        `SELECT closed_at FROM tickets WHERE id = ?`
      ).get(ticketId)!;
      expect(getRes.closed_at).toBeDefined();
      expect(getRes.closed_at).not.toBeNull();

      // Re-open
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'Re-opening' });

      // Verify closed_at is NULL
      getRes = await db.prepare<[number], { closed_at: string | null }>(
        `SELECT closed_at FROM tickets WHERE id = ?`
      ).get(ticketId)!;
      expect(getRes.closed_at).toBeNull();
    });
  });

  describe('Non-Human-User role cannot re-open', () => {
    it('should reject AI code developer (role 4) from re-opening a ticket from done', async () => {
      // Create a ticket and move it to done with Human User (role 1)
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Protected Re-open', column: 'todo', role_id: 1 });
      const ticketId = createRes.body.data.id;

      // Move to done
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      await moveThrough(ticketId, flow, 'moving');

      // Try to re-open as AI code developer (role 4)
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'try to re-open', role_id: 4 });
      // The workflow engine returns TransitionResult without errorCode,
      // so the API handler defaults to VALIDATION_ERROR / 400
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject AI teamleader (role 2) from re-opening a ticket from done', async () => {
      // Create a ticket and move it to done with Human User (role 1)
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Protected Re-open TL', column: 'todo', role_id: 1 });
      const ticketId = createRes.body.data.id;

      // Move to done
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      await moveThrough(ticketId, flow, 'moving');

      // Try to re-open as AI teamleader (role 2)
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'try to re-open', role_id: 2 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('Status history entry on re-open', () => {
    it('should create a status history entry when re-opening from done to implementation', async () => {
      // Create a ticket and move it to done
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'History Check', column: 'todo', role_id: 1 });
      const ticketId = createRes.body.data.id;

      // Move through full workflow to done and count history entries
      const flow = ['implementation', 'unit_review', 'integration_testing', 'final_review', 'done'];
      for (const col of flow) {
        await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
          .send({ to_column: col, comment: `moving to ${col}` });
      }

      // Get initial status history count (with slugs via DB query)
      const initialHistoryCount = getStatusHistoryWithSlugs(ticketId).length;

      // Re-open the ticket
      const reopenRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'Re-opening for fixes' });
      expect(reopenRes.status).toBe(200);

      // Verify status history has a new entry for done → implementation
      const history = getStatusHistoryWithSlugs(ticketId);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(initialHistoryCount);

      // The last history entry should be from done to implementation
      const lastEntry = history[history.length - 1];
      expect(lastEntry).toHaveProperty('from_column_slug', 'done');
      expect(lastEntry).toHaveProperty('to_column_slug', 'implementation');
    });
  });
});
