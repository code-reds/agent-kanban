import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Roles API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `roles-test-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Roles Test Project', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/roles', () => {
    it('should return roles with access levels', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/roles');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('PATCH /api/v1/projects/:slug/roles/:id', () => {
    it('should update a role name', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const testRole = res.body.data.find((r: any) => r.name === 'AI architect');
      if (!testRole) {
        throw new Error('Test role not found');
      }

      const updateRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles/${testRole.id}`)
        .send({ name: 'Updated Architect' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data).toHaveProperty('name', 'Updated Architect');
    });

    it('should return 404 for non-existent project role', async () => {
      const res = await requestAgent()
        .patch('/api/v1/projects/nonexistent/roles/1')
        .send({ name: 'Test' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent role', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles/999999`)
        .send({ name: 'Test' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });
  });
});
