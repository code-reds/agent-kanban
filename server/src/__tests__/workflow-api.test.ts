import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Workflow API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-workflow-${Date.now()}`;
  let columns: { id: number; slug: string }[] = [];

  beforeAll(async () => {
    await startServer();
    // Create a test project
    await requestAgent().post('/api/v1/projects').send({ name: 'Workflow Test', slug: testSlug });
    // Fetch actual column IDs for this project
    const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
    columns = columnsRes.body.data;
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/workflow', () => {
    it('should return workflow transitions', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/workflow`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/workflow');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return enriched transitions with column slugs', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/workflow`);
      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const first = res.body.data[0];
        expect(first).toHaveProperty('from_slug');
        expect(first).toHaveProperty('to_slug');
        expect(first).toHaveProperty('allowed_roles');
        expect(first).toHaveProperty('requires_comment');
      }
    });
  });

  describe('POST /api/v1/projects/:slug/workflow', () => {
    it('should create a new transition', async () => {
      const col1 = columns.find(c => c.slug === 'todo')!;
      const col2 = columns.find(c => c.slug === 'unit_review')!;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          allowed_roles: [1, 2],
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
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

    it('should reject column not in project', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({ column_from: 9999, column_to: 2 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should create transition with requires_comment true', async () => {
      const col1 = columns.find(c => c.slug === 'todo')!;
      const col2 = columns.find(c => c.slug === 'final_review')!;
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: true,
          allowed_roles: [1],
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('requires_comment', true);
    });

    it('should reject for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/workflow')
        .send({ column_from: 1, column_to: 2 });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/projects/:slug/workflow/:id', () => {
    it('should delete a transition', async () => {
      // First create a transition using columns not already connected
      const col1 = columns.find(c => c.slug === 'implementation')!;
      const col2 = columns.find(c => c.slug === 'final_review')!;
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          allowed_roles: [1],
        });
      const transitionId = createRes.body.data.id;
      const deleteRes = await requestAgent().delete(`/api/v1/projects/${testSlug}/workflow/${transitionId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toHaveProperty('success', true);
    });

    it('should return 404 for non-existent transition', async () => {
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/workflow/99999`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().delete('/api/v1/projects/nonexistent/workflow/1');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/projects/:slug/workflow/:id', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .patch('/api/v1/projects/nonexistent/workflow/1')
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent transition', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/99999`)
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 when no update fields are provided', async () => {
      // Create a transition first (use done→unit_review which isn't in seed data)
      const col1 = columns.find(c => c.slug === 'done')!;
      const col2 = columns.find(c => c.slug === 'unit_review')!;
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
    });

    it('should update requires_comment', async () => {
      // Use done→final_review which isn't in seed data
      const col1 = columns.find(c => c.slug === 'done')!;
      const col2 = columns.find(c => c.slug === 'final_review')!;
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
        .send({ requires_comment: true });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.requires_comment).toBe(true);
    });

    it('should update entire_ticket_group', async () => {
      const col1 = columns.find(c => c.slug === 'implementation')!;
      const col2 = columns.find(c => c.slug === 'final_review')!;
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          entire_ticket_group: false,
          allowed_roles: [1],
        });
      const transitionId = createRes.body.data.id;

      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/${transitionId}`)
        .send({ entire_ticket_group: true });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.entire_ticket_group).toBe(true);
    });

    it('should update allowed_roles (full replacement)', async () => {
      // Use done→integration_testing which isn't in seed data
      const col1 = columns.find(c => c.slug === 'done')!;
      const col2 = columns.find(c => c.slug === 'integration_testing')!;
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

      // Update allowed_roles to a different set
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/${transitionId}`)
        .send({ allowed_roles: [2, 3] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.allowed_roles).toEqual([2, 3]);
    });

    it('should support partial updates (only requires_comment)', async () => {
      // Use done→human_feedback which isn't in seed data
      const col1 = columns.find(c => c.slug === 'done')!;
      const col2 = columns.find(c => c.slug === 'human_feedback')!;
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          entire_ticket_group: true,
          allowed_roles: [1, 2],
        });
      const transitionId = createRes.body.data.id;

      // Update only requires_comment
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/${transitionId}`)
        .send({ requires_comment: true });
      expect(res.status).toBe(200);
      expect(res.body.data.requires_comment).toBe(true);
      // entire_ticket_group should remain true
      expect(res.body.data.entire_ticket_group).toBe(true);
    });

    it('should support combined updates (all fields at once)', async () => {
      // Use human_feedback→done which isn't in seed data  
      const col1 = columns.find(c => c.slug === 'human_feedback')!;
      const col2 = columns.find(c => c.slug === 'done')!;
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
        .send({
          requires_comment: true,
          entire_ticket_group: true,
          allowed_roles: [2, 3],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.requires_comment).toBe(true);
      expect(res.body.data.entire_ticket_group).toBe(true);
      expect(res.body.data.allowed_roles).toEqual([2, 3]);
    });

    it('should return 404 when transition belongs to different project', async () => {
      // Create a second project
      const testSlug2 = `test-workflow2-${Date.now()}`;
      await requestAgent().post('/api/v1/projects').send({ name: 'Workflow Test 2', slug: testSlug2 });
      const columns2Res = await requestAgent().get(`/api/v1/projects/${testSlug2}/columns`);
      const columns2 = columns2Res.body.data;

      // Create a transition in the second project
      const col1 = columns2.find(c => c.slug === 'todo')!;
      const col2 = columns2.find(c => c.slug === 'unit_review')!;
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/workflow`)
        .send({
          column_from: col1.id,
          column_to: col2.id,
          requires_comment: false,
          allowed_roles: [1],
        });
      const transitionId = createRes.body.data.id;

      // Try to update it from the first project
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/workflow/${transitionId}`)
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);

      // Cleanup
      await requestAgent().delete(`/api/v1/projects/${testSlug2}`);
    });
  });
});
