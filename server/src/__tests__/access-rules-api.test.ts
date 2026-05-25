import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Access Rules API Error Paths', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-access-rules-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Access Rules Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/access-rules', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/access-rules');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should return enriched access rules for valid project', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/access-rules`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('PATCH /api/v1/projects/:slug/access-rules', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().patch('/api/v1/projects/nonexistent/access-rules').send({ rules: [] });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 when rules is not an array', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}/access-rules`).send({ rules: 'not-an-array' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body.error).toContain('rules array is required');
    });

    it('should return 400 when rules is null', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}/access-rules`).send({ rules: null });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 400 when a rule has an invalid column_id', async () => {
      // Invalid column_id = 99999 doesn't exist in the project
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/access-rules`)
        .send({ rules: [{ column_id: 99999, role_id: 1, action_type: 'create' }] });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 400 when a rule has an invalid action_type', async () => {
      // Get a valid column_id from the project
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col = columnsRes.body.data[0];

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/access-rules`)
        .send({ rules: [{ column_id: col.id, role_id: 1, action_type: 'invalid_action' }] });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body.error).toContain('Invalid action_type');
    });

    it('should return 400 when a rule is missing action_type', async () => {
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col = columnsRes.body.data[0];

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/access-rules`)
        .send({ rules: [{ column_id: col.id, role_id: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should successfully update valid access rules', async () => {
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col = columnsRes.body.data[0];

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/access-rules`)
        .send({ rules: [{ column_id: col.id, role_id: 1, action_type: 'create' }] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
