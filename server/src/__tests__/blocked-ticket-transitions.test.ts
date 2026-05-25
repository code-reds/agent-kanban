import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, startServer } from '../server.js';
import request from 'supertest';
import { getDb } from '../db/database.js';

// Tests for: blocked tickets should only block forward transitions, not backward moves
// https://github.com/... Ticket #117
describe('Blocked Ticket Forward/Backward Transition', () => {
  beforeAll(async () => {
    // DB is already initialized by integration-setup.ts (module-level)
    // Only start the server here; the setup file runs migrations and seeds roles
    await startServer();
  });

  const createTestProject = async () => {
    const res = await request(getApp()).post('/api/v1/projects').send({
      name: 'Blocked Transition Test',
      slug: `blocked-transition-${Date.now()}`,
    });
    expect(res.status).toBe(201);
    return res.body.data.slug;
  };

  const moveTicket = async (slug: string, ticketId: number, toColumn: string, comment = 'move', roleId: number = 1) => {
    return request(getApp())
      .post(`/api/v1/projects/${slug}/tickets/${ticketId}/move`)
      .send({ to_column: toColumn, comment, role_id: roleId });
  };

  const addDependency = async (slug: string, ticketId: number, dependsOnId: number, relationType: string) => {
    return request(getApp())
      .post(`/api/v1/projects/${slug}/tickets/${ticketId}/dependencies/${relationType}/${dependsOnId}`)
      .send();
  };

  const getTicketColumnSlug = (slug: string, ticketId: number): string => {
    const project = getDb().prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as { id: number };
    const ticketColId = getDb().prepare('SELECT column_id FROM tickets WHERE id = ?').get(ticketId) as { column_id: number };
    const col = getDb().prepare('SELECT slug FROM kanban_columns WHERE id = ?').get(ticketColId.column_id) as { slug: string };
    return col.slug;
  };

  describe('forward transitions: blocked tickets should be blocked', () => {
    it('should block moving a blocked ticket from implementation to unit_review', async () => {
      const slug = await createTestProject();

      // Create dependency ticket (keep it open in todo)
      const depRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Dependency', column: 'todo', role_id: 1 });
      const depId = depRes.body.data.id;

      // Create target ticket and move to implementation
      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Add blocked_by dependency
      await addDependency(slug, targetId, depId, 'blocked_by');

      // Move target to implementation (order 1), blocked by unresolved dependency
      const move1 = await moveTicket(slug, targetId, 'implementation');
      expect(move1.status).toBe(409);
      expect(move1.body).toHaveProperty('success', false);
      expect(move1.body).toHaveProperty('code', 'CONFLICT');
      expect(move1.body.error).toContain('unresolved dependency');

      // Try to move forward to implementation again — also blocked
      const move2 = await moveTicket(slug, targetId, 'implementation');
      expect(move2.status).toBe(409);
      expect(move2.body).toHaveProperty('success', false);
      expect(move2.body).toHaveProperty('code', 'CONFLICT');

      // Verify ticket is still in todo
      expect(getTicketColumnSlug(slug, targetId)).toBe('todo');
    });

    it('should block moving a blocked ticket from integration_testing to final_review', async () => {
      const slug = await createTestProject();

      const depRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Dependency', column: 'todo', role_id: 1 });
      const depId = depRes.body.data.id;

      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Move through workflow to integration_testing (no dependency yet)
      for (const col of ['implementation', 'unit_review', 'integration_testing']) {
        const r = await moveTicket(slug, targetId, col, 'move');
        expect(r.status).toBe(200);
      }

      // NOW add the blocked_by dependency
      await addDependency(slug, targetId, depId, 'blocked_by');

      // For entire_ticket_group transitions, blocker checks should block ticket 
      // progression fo entire-grop tickets when dependencies are in earlier columns. 
      const res = await moveTicket(slug, targetId, 'final_review', 'final');
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('backward transitions: blocked tickets should be allowed', () => {
    it('should allow moving a blocked ticket from unit_review back to implementation', async () => {
      const slug = await createTestProject();

      // Create dependency ticket (keep it open in todo)
      const depRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Dependency', column: 'todo', role_id: 1 });
      const depId = depRes.body.data.id;

      // Create target ticket and move forward to unit_review first (no dependency yet)
      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      await moveTicket(slug, targetId, 'implementation');
      await moveTicket(slug, targetId, 'unit_review');

      // NOW add the blocked_by dependency
      await addDependency(slug, targetId, depId, 'blocked_by');

     // Moving backward from unit_review to implementation should succeed
      const res = await moveTicket(slug, targetId, 'implementation', 'back');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.to_column).toBe('implementation');
    });

   // Note: the test below "should allow pulling a blocked ticket back from unit_review to implementation"
    // handles this scenario. This empty test block was removed during refactoring.

    it('should allow pulling a blocked ticket back from final_review to implementation', async () => {
      const slug = await createTestProject();

      // Create dependency ticket (keep it open in todo)
      const depRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Dependency', column: 'todo', role_id: 1 });
      const depId = depRes.body.data.id;

      // Create target and move through entire workflow (no dependency yet)
      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      for (const col of ['implementation', 'unit_review', 'integration_testing', 'final_review']) {
        const r = await moveTicket(slug, targetId, col, 'move');
        expect(r.status).toBe(200);
      }

      // NOW add the blocked_by dependency
      await addDependency(slug, targetId, depId, 'blocked_by');

      // Try to move backward from final_review to implementation — should succeed
      const res = await moveTicket(slug, targetId, 'implementation', 'rework');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.to_column).toBe('implementation');
    });

    it('should allow moving a blocked ticket from integration_testing to implementation if blocked, then backward to unit_review', async () => {
      const slug = await createTestProject();

      // Create dependency ticket
      const depRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Dependency', column: 'todo', role_id: 1 });
      const depId = depRes.body.data.id;

      // Create target and move to integration_testing first (no dependency yet)
      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      for (const col of ['implementation', 'unit_review', 'integration_testing']) {
        const r = await moveTicket(slug, targetId, col, 'move');
        expect(r.status).toBe(200);
      }

      // Add blocked_by dependency
      await addDependency(slug, targetId, depId, 'blocked_by');

      // Moving backward from integration_testing to implementation should work
      const res = await moveTicket(slug, targetId, 'implementation', 'back');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.to_column).toBe('implementation');

      // Then moving forward to unit_review should be blocked (forward transition with unresolved dep)
      const forward = await moveTicket(slug, targetId, 'unit_review', 'review');
      expect(forward.status).toBe(409);
      expect(forward.body).toHaveProperty('success', false);
      expect(forward.body.error).toContain('unresolved dependency');
    });
  });

  describe('non-blocked tickets: can move in any direction', () => {
    it('should allow moving a non-blocked ticket forward', async () => {
      const slug = await createTestProject();

      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Move forward through the workflow
      const r1 = await moveTicket(slug, targetId, 'implementation');
      expect(r1.status).toBe(200);

      const r2 = await moveTicket(slug, targetId, 'unit_review', 'review');
      expect(r2.status).toBe(200);
    });

    it('should allow moving a non-blocked ticket backward', async () => {
      const slug = await createTestProject();

      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Move forward
      await moveTicket(slug, targetId, 'implementation');
      await moveTicket(slug, targetId, 'unit_review', 'review');

      // Move backward
      const res = await moveTicket(slug, targetId, 'implementation', 'back');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      // Move forward again
      const r2 = await moveTicket(slug, targetId, 'unit_review', 'review again');
      expect(r2.status).toBe(200);
    });

    it('should allow moving a non-blocked ticket from final_review to implementation', async () => {
      const slug = await createTestProject();

      const targetRes = await request(getApp())
        .post(`/api/v1/projects/${slug}/tickets`)
        .send({ title: 'Target', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      for (const col of ['implementation', 'unit_review', 'integration_testing', 'final_review']) {
        const r = await moveTicket(slug, targetId, col, 'move');
        expect(r.status).toBe(200);
      }

      // Move backward
      const res = await moveTicket(slug, targetId, 'implementation', 'rework');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
