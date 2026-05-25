import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer } from '../server.js';
import request from 'supertest';

describe('Ticket Closure Validation', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `closure-validation-${Date.now()}`;
  let projectId: number;

  beforeAll(async () => {
    // DB is already initialized by integration-setup.ts (module-level)
    // Only start the server here; the setup file runs migrations and seeds roles
    await startServer();
    const res = await requestAgent().post('/api/v1/projects').send({
      name: 'Closure Validation Test',
      slug: testSlug,
    });
    expect(res.status).toBe(201);
    projectId = res.body.data.id;
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    // Don't stop server or delete PORT - shared singleton across test files
  });

  describe('POST /api/v1/projects/:slug/tickets/:id/move to done', () => {
    it('should allow closing a ticket with no children and no dependencies', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Simple Ticket', column: 'todo', role_id: 1 });
      const id = res.body.data.id;

      // Move through the workflow to done
      const r1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      expect(r1.status).toBe(200);
      const r2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      expect(r2.status).toBe(200);
      const r3 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      expect(r3.status).toBe(200);
      const r4 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'final_review', comment: 'final' });
      expect(r4.status).toBe(200);
      const r5 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${id}/move`)
        .send({ to_column: 'done', comment: 'done' });
      expect(r5.status).toBe(200);
      expect(r5.body).toHaveProperty('success', true);
      expect(r5.body.data).toHaveProperty('moved', true);
    });

    it('should reject closing a ticket with open child tickets in other columns', async () => {
      // Create parent and move it through workflow FIRST (no children yet)
      const parentRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Parent Ticket', column: 'todo', role_id: 1 });
      const parentId = parentRes.body.data.id;

      // Move parent through workflow to final_review (no children yet, so entire-ticket-group passes)
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // NOW create child tickets in a different column (todo)
      const childRes1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Child 1', column: 'todo', role_id: 1, parent_id: parentId });
      const childId1 = childRes1.body.data.id;

      const childRes2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Child 2', column: 'todo', role_id: 1, parent_id: parentId });
      const childId2 = childRes2.body.data.id;

      // Children in other columns are not closed — should reject (409)
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'done', comment: 'closing parent' });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'CONFLICT');

      // Verify children are still open
      const child1 = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${childId1}`);
      expect(child1.body.data).toHaveProperty('closed_at', null);
      const child2 = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${childId2}`);
      expect(child2.body.data).toHaveProperty('closed_at', null);
    });

    it('should allow closing parent when same-column children cascade-close', async () => {
      // Create parent and move to final_review FIRST (no children yet)
      const parentRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Parent All Closed', column: 'todo', role_id: 1 });
      const parentId = parentRes.body.data.id;

      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // Create child tickets in the SAME column as parent (final_review)
      // These will be cascade-closed when parent moves to done
      const childRes1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Child Closed 1', column: 'final_review', role_id: 1, parent_id: parentId });
      const childId1 = childRes1.body.data.id;

      // Closing parent to done cascades to same-column children
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${parentId}/move`)
        .send({ to_column: 'done', comment: 'closing parent with cascade' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      // Verify children were cascade-closed
      const child1 = await requestAgent().get(`/api/v1/projects/${testSlug}/tickets/${childId1}`);
      expect(child1.body.data).toHaveProperty('closed_at');
      expect(child1.body.data).toHaveProperty('column_id');
    });

    it('should reject closing a ticket with unresolved blocked_by dependency', async () => {
      // Create dependency ticket (keep it open)
      const depTicket = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Dependency Ticket', column: 'todo', role_id: 1 });
      const depId = depTicket.body.data.id;

      // Create target ticket and move through workflow to final_review (no dependency yet)
      const targetRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Target Ticket', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // Add blocked_by dependency AFTER moving to final_review
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/dependencies/blocked_by/${depId}`)
        .send();

      // Try to close target — should fail due to unresolved blocked_by dep
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'done', comment: 'closing' });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'CONFLICT');
      expect(res.body.error).toContain('unresolved dependency');
      expect(res.body.error).toContain(`#${depId}`);
    });

    it('should reject closing a ticket with unresolved depends_on dependency', async () => {
      // Create dependency ticket (keep it open)
      const depTicket = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Depends On Ticket', column: 'todo', role_id: 1 });
      const depId = depTicket.body.data.id;

      // Create target ticket and move through workflow to final_review (no dependency yet)
      const targetRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Target Depends On', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // Add depends_on dependency AFTER moving to final_review
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/dependencies/depends_on/${depId}`)
        .send();

      // Try to close target — should fail due to unresolved depends_on dep
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'done', comment: 'closing' });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'CONFLICT');
      expect(res.body.error).toContain('unresolved dependency');
      expect(res.body.error).toContain(`#${depId}`);
    });

    it('should allow closing despite related dependency (informational only)', async () => {
      // Create related ticket
      const relatedTicket = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Related Ticket', column: 'todo', role_id: 1 });
      const relatedId = relatedTicket.body.data.id;

      // Create target ticket and move to final_review
      const targetRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Target Related', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Add related dependency (informational only — should NOT block closure)
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/dependencies/related/${relatedId}`)
        .send();

      // Move target through workflow to final_review
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // Should succeed — related deps don't block closure
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'done', comment: 'closing' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should allow closing when all dependencies are closed', async () => {
      // Create dependency ticket and close it
      const depTicket = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Closed Dep', column: 'todo', role_id: 1 });
      const depId = depTicket.body.data.id;

      // Close dependency ticket first
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${depId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${depId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${depId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${depId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${depId}/move`)
        .send({ to_column: 'done', comment: 'done' });

      // Create target ticket and move to final_review
      const targetRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'Target Closed Dep', column: 'todo', role_id: 1 });
      const targetId = targetRes.body.data.id;

      // Add blocked_by dependency
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/dependencies/blocked_by/${depId}`)
        .send();

      // Move target through workflow to final_review
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'implementation', comment: 'start' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'unit_review', comment: 'review' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'integration_testing', comment: 'integration' });
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'final_review', comment: 'final' });

      // Should succeed — dependency is closed
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tickets/${targetId}/move`)
        .send({ to_column: 'done', comment: 'closing' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
