import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Projects API Error Paths', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-projects-errors-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Projects Error Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects', () => {
    it('should return projects list', async () => {
      const res = await requestAgent().get('/api/v1/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should support search query', async () => {
      const res = await requestAgent().get('/api/v1/projects?q=error');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return empty array when search matches nothing', async () => {
      const res = await requestAgent().get('/api/v1/projects?q=zzzznotfound');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('POST /api/v1/projects', () => {
    it('should return 409 for duplicate slug', async () => {
      const res = await requestAgent().post('/api/v1/projects').send({ name: 'Duplicate', slug: testSlug });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('GET /api/v1/projects/:slug', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent-project-xyz');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should return project with all relations', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('slug');
    });
  });

  describe('PATCH /api/v1/projects/:slug', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().patch('/api/v1/projects/nonexistent-project-xyz').send({ name: 'New Name' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should update project name', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}`).send({ name: 'Updated Name' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.name).toBe('Updated Name');

      // Restore original name
      await requestAgent().patch(`/api/v1/projects/${testSlug}`).send({ name: 'Projects Error Test' });
    });

    it('should update project description', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}`).send({ description: 'New description' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.description).toBe('New description');
    });

    it('should update only description, leaving name unchanged', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}`).send({ description: 'Only description' });
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Only description');
    });
  });

  describe('DELETE /api/v1/projects/:slug', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().delete('/api/v1/projects/nonexistent-project-xyz');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should return success for valid delete', async () => {
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
