import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Workflow API Error Paths for Delete and Catch Blocks', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-workflow-errors-${Date.now()}`;
  let columns: { id: number; slug: string }[] = [];

  beforeAll(async () => {
    delete process.env.MCP_PORT;
    delete process.env.MCP_HOST;
    await startServer();
    // Create project and wait for it to be ready
    const createRes = await requestAgent().post('/api/v1/projects').send({ name: 'Workflow Error Test', slug: testSlug });
    if (createRes.status !== 201) {
      // Project might already exist from a previous test run, try to fetch anyway
    }
    const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
    columns = columnsRes.body.data;
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    delete process.env.MCP_PORT;
    delete process.env.MCP_HOST;
    await stopServer();
  });

  describe('DELETE /api/v1/projects/:slug/workflow/:id - error paths', () => {
    it('should return 404 when transition is not found for existing project', async () => {
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/workflow/999999`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().delete('/api/v1/projects/nonexistent/workflow/1');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return success for valid delete and verify transition gone', async () => {
      // Re-fetch columns
      const freshColsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const freshCols = freshColsRes.body.data;
      const col1 = freshCols.find(c => c.slug === 'todo')!;
      const col2 = freshCols.find(c => c.slug === 'unit_review')!;

      // Create a transition
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          allowed_roles: [1],
        });
      expect(createRes.status).toBe(201);
      const transitionId = createRes.body.data.id;

      // Delete it
      const deleteRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/workflow/${transitionId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toHaveProperty('success', true);

      // Verify it's gone
      const getRes = await requestAgent().get(`/api/v1/projects/${testSlug}/workflow`);
      const remaining = getRes.body.data.filter((t: any) => t.id === transitionId);
      expect(remaining.length).toBe(0);
    });
  });

  describe('POST /api/v1/projects/:slug/workflow - error paths', () => {
    it('should handle non-numeric column IDs gracefully', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({ column_from: 'abc', column_to: 'xyz' });
      // Non-numeric column IDs result in 404 since the columns can't be found
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent project on workflow creation', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/workflow')
        .send({ column_from: 1, column_to: 2 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject missing column_from', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({ column_to: 2 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject missing column_to', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({ column_from: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('PATCH /api/v1/projects/:slug/workflow/:id - error paths', () => {
    it('should return 404 for non-existent project on update', async () => {
      const res = await requestAgent()
        .patch('/api/v1/projects/nonexistent/workflow/1')
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent transition on update', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/999999`)
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 when no update fields are provided', async () => {
      // Create a transition first
      const freshColsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const freshCols = freshColsRes.body.data;
      const col1 = freshCols.find(c => c.slug === 'done')!;
      const col2 = freshCols.find(c => c.slug === 'unit_review')!;
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          entire_ticket_group: false,
          allowed_roles: [1],
        });
      const transitionId = createRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/${transitionId}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });
});
