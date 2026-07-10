import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Conversations API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-conversations-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Conversations Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/conversations', () => {
    it('should return conversations', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/conversations`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/conversations');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/projects/:slug/conversations/:id', () => {
    it('should return 404 for non-existent conversation', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/conversations/9999`);
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/conversations/1');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:slug/conversations/:id/messages', () => {
    it('should return 404 for non-existent conversation', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations/9999/messages`)
        .send({ content: 'Hello' });
      expect(res.status).toBe(404);
    });

    it('should reject missing content', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations/1/messages`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject non-string content', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations/1/messages`)
        .send({ content: 123 });
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/conversations/1/messages')
        .send({ content: 'Hello' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/projects/:slug/messages/unread', () => {
    it('should return unread messages', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/messages/unread`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('messages');
      expect(res.body.data).toHaveProperty('last_read_message_id');
    });

    it('should support limit parameter', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/messages/unread?limit=5`);
      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBeLessThanOrEqual(5);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/messages/unread');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:slug/conversations', () => {
    it('should create a new conversation with a valid role_id', async () => {
      // Get an agent role id (skip Human User which is role 1)
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const agentRole = rolesRes.body.data.find((r: any) => r.id !== 1);
      expect(agentRole).toBeDefined();

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations`)
        .send({ role_id: agentRole.id });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('from_role_name', 'Human User');
      expect(res.body.data.from_role_id).toBe(1);
      expect(res.body.data.to_role_id).toBe(agentRole.id);
    });

    it('should return existing conversation if one already exists', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const agentRole = rolesRes.body.data.find((r: any) => r.id !== 1);

      // Create first time
      const res1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations`)
        .send({ role_id: agentRole.id });
      const firstConvId = res1.body.data.id;

      // Create again - should return the existing one
      const res2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations`)
        .send({ role_id: agentRole.id });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(firstConvId);
    });

    it('should reject missing role_id', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject non-number role_id', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/conversations`)
        .send({ role_id: 'abc' });

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/conversations')
        .send({ role_id: 4 });

      expect(res.status).toBe(404);
    });
  });
});
