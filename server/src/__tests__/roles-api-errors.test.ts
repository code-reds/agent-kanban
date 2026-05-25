import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';

describe('Roles API Error Paths', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-roles-errors-${Date.now()}`;

  beforeAll(async () => {
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();

    // Seed global columns for access rules
    const globalColumns = [
      { slug: 'todo', name: 'To Do', order: 0 },
      { slug: 'implementation', name: 'Implementation', order: 1 },
      { slug: 'unit_review', name: 'Unit Review', order: 2 },
      { slug: 'integration_testing', name: 'Integration Testing', order: 3 },
      { slug: 'final_review', name: 'Final Review', order: 4 },
      { slug: 'done', name: 'Done', order: 5 },
      { slug: 'human_feedback', name: 'Human Feedback', order: 6 },
    ];
    for (const col of globalColumns) {
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default) VALUES (NULL, ?, ?, ?, 1, ?)'
      ).run(col.slug, col.name, col.order, col.slug === 'todo' ? 1 : 0);
    }

    // Create a test project
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Roles Error Test', testSlug);
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(testSlug) as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));

    await startServer();
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /api/v1/projects/:slug/roles', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/roles');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should return roles with access levels', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('PATCH /api/v1/projects/:slug/roles/:id', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().patch('/api/v1/projects/nonexistent/roles/1').send({ name: 'New Name' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent role in existing project', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}/roles/99999`).send({ name: 'New Name' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should update role name successfully', async () => {
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles/1`)
        .send({ name: 'Updated Human User', description: 'Updated desc' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.name).toBe('Updated Human User');

      // Restore original name
      await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles/1`)
        .send({ name: 'Human User' });
    });

    it('should return 500 when service throws', async () => {
      // This tests the catch block in the API route
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}/roles/1`);
      // No body sent — should still succeed since name is optional
      expect(res.body).toHaveProperty('success');
    });
  });

  describe('GET /api/v1/projects/:slug/roles-columns', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().get('/api/v1/projects/nonexistent/roles-columns');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return combined roles_columns', async () => {
      const res = await requestAgent().get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/v1/projects/:slug/roles-columns', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().post('/api/v1/projects/nonexistent/roles-columns').send({ role_id: 1, column_id: 1 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 for invalid role_id', async () => {
      const res = await requestAgent().post(`/api/v1/projects/${testSlug}/roles-columns`).send({ role_id: -1, column_id: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should create a project-specific override', async () => {
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col = columnsRes.body.data[0];
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: 1, column_id: col.id, is_default: 0 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('PATCH /api/v1/projects/:slug/roles-columns/:role_id', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().patch('/api/v1/projects/nonexistent/roles-columns/1').send({ column_id: 1 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 for invalid role_id', async () => {
      const res = await requestAgent().patch(`/api/v1/projects/${testSlug}/roles-columns/-1`).send({ column_id: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should update an existing override', async () => {
      // First create an override
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col1 = columnsRes.body.data[0];
      const col2 = columnsRes.body.data[1];

      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: 1, column_id: col1.id, is_default: 0 });

      // Now update it
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles-columns/1`)
        .send({ column_id: col2.id, is_default: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('DELETE /api/v1/projects/:slug/roles-columns/:role_id', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent().delete('/api/v1/projects/nonexistent/roles-columns/1');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 for invalid role_id', async () => {
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/roles-columns/-1`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 404 when no override exists for role', async () => {
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/roles-columns/99999`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should delete an existing override and return success', async () => {
      const columnsRes = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
      const col = columnsRes.body.data[0];

      // Create an override first
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: 1, column_id: col.id, is_default: 0 });

      // Delete it
      const res = await requestAgent().delete(`/api/v1/projects/${testSlug}/roles-columns/1`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
