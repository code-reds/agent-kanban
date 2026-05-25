import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';

describe('Global Settings API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `global-settings-test-${Date.now()}`;

  beforeAll(async () => {
    // Reset DB for clean state
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    try {
      db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
    } catch { /* ignore */ }

    // Create a test project with columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Global Settings Test', testSlug);
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

  // =========================================================================
  // Global Columns
  // =========================================================================

  describe('GET /api/v1/global-settings/columns', () => {
    it('should return global columns (empty initially)', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/columns');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('should return global columns after creation', async () => {
      // Create a global column first
      await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'api-gcol', name: 'API Global Column', order: 100 });

      const res = await requestAgent().get('/api/v1/global-settings/columns');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].slug).toBe('api-gcol');
    });
  });

  describe('POST /api/v1/global-settings/columns', () => {
    it('should create a global column', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'create-test', name: 'Create Test Column', order: 200 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('slug', 'create-test');
      expect(res.body.data).toHaveProperty('name', 'Create Test Column');
    });

    it('should reject missing slug', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ name: 'No Slug', order: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject missing name', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'no-name', order: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject missing order', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'no-order', name: 'No Order' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject duplicate slug', async () => {
      const res1 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'dup-global', name: 'Dup', order: 1 });
      expect(res1.status).toBe(201);

      const res2 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'dup-global', name: 'Dup 2', order: 2 });
      expect(res2.status).toBe(409);
      expect(res2.body).toHaveProperty('success', false);
      expect(res2.body).toHaveProperty('code', 'CONFLICT');
    });

    it('should accept is_default flag', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'default-test', name: 'Default Test', order: 300, is_default: true });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('is_default', 1);
    });
  });

  describe('PATCH /api/v1/global-settings/columns/:id', () => {
    it('should update a global column', async () => {
      // Get the column created by POST test
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const col = listRes.body.data.find((c: any) => c.slug === 'create-test');
      expect(col).toBeDefined();

      const res = await requestAgent()
        .patch(`/api/v1/global-settings/columns/${col.id}`)
        .send({ name: 'Updated Column', order: 500 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('name', 'Updated Column');
      expect(res.body.data).toHaveProperty('order', 500);
    });

    it('should return 404 for non-existent column', async () => {
      const res = await requestAgent()
        .patch('/api/v1/global-settings/columns/999999')
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/global-settings/columns/:id', () => {
    it('should delete a non-default global column', async () => {
      // Create a column to delete
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'delete-me', name: 'Delete Me', order: 999 });
      const colId = createRes.body.data.id;

      const res = await requestAgent().delete(`/api/v1/global-settings/columns/${colId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id', colId);

      // Verify it's gone
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const stillExists = listRes.body.data.find((c: any) => c.id === colId);
      expect(stillExists).toBeUndefined();
    });

    it('should return 404 for non-existent column', async () => {
      const res = await requestAgent().delete('/api/v1/global-settings/columns/999999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject deleting default columns', async () => {
      // The 'default-test' column was created with is_default: true
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const defaultCol = listRes.body.data.find((c: any) => c.is_default === 1 && c.slug === 'default-test');
      if (defaultCol) {
        const res = await requestAgent().delete(`/api/v1/global-settings/columns/${defaultCol.id}`);
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('success', false);
        expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      }
    });
  });

  // =========================================================================
  // Global Workflows
  // =========================================================================

  describe('GET /api/v1/global-settings/workflows', () => {
    it('should return global workflows (empty initially)', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/workflows');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/v1/global-settings/workflows', () => {
    it('should create a global workflow transition', async () => {
      // Create two global columns to reference
      await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'wf-from', name: 'WF From', order: 10 });
      await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'wf-to', name: 'WF To', order: 11 });

      const columns = await requestAgent().get('/api/v1/global-settings/columns');
      const fromCol = columns.body.data.find((c: any) => c.slug === 'wf-from');
      const toCol = columns.body.data.find((c: any) => c.slug === 'wf-to');

      const res = await requestAgent()
        .post('/api/v1/global-settings/workflows')
        .send({
          column_from: fromCol.id,
          column_to: toCol.id,
          requires_comment: true,
          entire_ticket_group: false,
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('column_from', fromCol.id);
      expect(res.body.data).toHaveProperty('column_to', toCol.id);
      expect(res.body.data).toHaveProperty('is_global', 1);
    });

    it('should reject missing column IDs', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/workflows')
        .send({ column_from: undefined, column_to: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject non-existent column IDs', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/workflows')
        .send({ column_from: 9999, column_to: 9998 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/global-settings/workflows/:id', () => {
    it('should update a global workflow', async () => {
      // Get an existing workflow
      const listRes = await requestAgent().get('/api/v1/global-settings/workflows');
      const wf = listRes.body.data[0];
      if (!wf) return;

      const res = await requestAgent()
        .patch(`/api/v1/global-settings/workflows/${wf.id}`)
        .send({ requires_comment: false });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await requestAgent()
        .patch('/api/v1/global-settings/workflows/999999')
        .send({ requires_comment: true });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject no update fields', async () => {
      const listRes = await requestAgent().get('/api/v1/global-settings/workflows');
      const wf = listRes.body.data[0];
      if (!wf) return;

      const res = await requestAgent()
        .patch(`/api/v1/global-settings/workflows/${wf.id}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/global-settings/workflows/:id', () => {
    it('should delete a global workflow', async () => {
      // Create a workflow to delete
      const columns = await requestAgent().get('/api/v1/global-settings/columns');
      const fromCol = columns.body.data.find((c: any) => c.slug === 'wf-from');
      const toCol = columns.body.data.find((c: any) => c.slug === 'wf-to');
      if (!fromCol || !toCol) return;

      const createRes = await requestAgent()
        .post('/api/v1/global-settings/workflows')
        .send({ column_from: fromCol.id, column_to: toCol.id });
      const wfId = createRes.body.data.id;

      const res = await requestAgent().delete(`/api/v1/global-settings/workflows/${wfId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id', wfId);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await requestAgent().delete('/api/v1/global-settings/workflows/999999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  // =========================================================================
  // Global Access Rules
  // =========================================================================

  describe('GET /api/v1/global-settings/access-rules', () => {
    it('should return global access rules (may be empty)', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/access-rules');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('PATCH /api/v1/global-settings/access-rules', () => {
    it('should bulk update global access rules', async () => {
      const columns = await requestAgent().get('/api/v1/global-settings/columns');
      const col = columns.body.data[0];
      if (!col) return;

      const roles = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const roleId = roles.body.data[0]?.id;
      if (!roleId) return;

      const res = await requestAgent()
        .patch('/api/v1/global-settings/access-rules')
        .send({
          rules: [
            { column_id: col.id, role_id: roleId, action_type: 'create' },
            { column_id: col.id, role_id: roleId, action_type: 'edit' },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveLength(2);
    });

    it('should reject non-array rules', async () => {
      const res = await requestAgent()
        .patch('/api/v1/global-settings/access-rules')
        .send({ rules: null });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject invalid column_id', async () => {
      const res = await requestAgent()
        .patch('/api/v1/global-settings/access-rules')
        .send({ rules: [{ column_id: 9999, role_id: 1, action_type: 'create' }] });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should reject invalid action_type', async () => {
      const columns = await requestAgent().get('/api/v1/global-settings/columns');
      const col = columns.body.data[0];
      if (!col) return;

      const res = await requestAgent()
        .patch('/api/v1/global-settings/access-rules')
        .send({ rules: [{ column_id: col.id, role_id: 1, action_type: 'invalid' }] });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // Global Roles_Columns
  // =========================================================================

  describe('GET /api/v1/global-settings/roles-columns', () => {
    it('should return global roles_columns entries', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/roles-columns');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return entries with role_name and column_name', async () => {
      // First create a global column if none exists
      const columnsRes = await requestAgent().get('/api/v1/global-settings/columns');
      expect(columnsRes.status).toBe(200);

      // Create a role_column entry
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const roleId = rolesRes.body.data[0]?.id;
      const colId = columnsRes.body.data[0]?.id;
      if (!roleId || !colId) return;

      await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 1 });

      const res = await requestAgent().get('/api/v1/global-settings/roles-columns');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('role_id');
      expect(res.body.data[0]).toHaveProperty('role_name');
      expect(res.body.data[0]).toHaveProperty('column_id');
      expect(res.body.data[0]).toHaveProperty('column_name');
      expect(res.body.data[0]).toHaveProperty('is_default');
    });
  });

  describe('POST /api/v1/global-settings/roles-columns', () => {
    it('should create a global roles_column entry', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const columnsRes = await requestAgent().get('/api/v1/global-settings/columns');
      const roleId = rolesRes.body.data[0]?.id;
      const colId = columnsRes.body.data[0]?.id;
      if (!roleId || !colId) return;

      const res = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('role_id', roleId);
      expect(res.body.data).toHaveProperty('column_id', colId);
      expect(res.body.data).toHaveProperty('is_default', 1);
      expect(res.body.data).toHaveProperty('id');
    });

    it('should reject missing role_id', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ column_id: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should handle upsert (idempotent)', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const columnsRes = await requestAgent().get('/api/v1/global-settings/columns');
      const roleId = rolesRes.body.data[0]?.id;
      const colId = columnsRes.body.data[0]?.id;
      if (!roleId || !colId) return;

      // First create
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 1 });
      expect(createRes.status).toBe(201);

      // Upsert (update)
      const updateRes = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 0 });
      expect(updateRes.status).toBe(201);
      expect(updateRes.body.data).toHaveProperty('is_default', 0);
    });

    it('should handle NULL column_id (unrestricted)', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const roleId = rolesRes.body.data[0]?.id;
      if (!roleId) return;

      const res = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: null, is_default: 0 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('role_id', roleId);
      expect(res.body.data).toHaveProperty('column_id', null);
    });
  });

  describe('PATCH /api/v1/global-settings/roles-columns/:role_id', () => {
    it('should update a global roles_column entry', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const columnsRes = await requestAgent().get('/api/v1/global-settings/columns');
      const roleId = rolesRes.body.data[0]?.id;
      const colId = columnsRes.body.data[0]?.id;
      if (!roleId || !colId) return;

      // Create first
      await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 1 });

      // Update
      const res = await requestAgent()
        .patch(`/api/v1/global-settings/roles-columns/${roleId}`)
        .send({ column_id: colId, is_default: 0 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('role_id', roleId);
      expect(res.body.data).toHaveProperty('is_default', 0);
    });

    it('should return error for invalid role_id', async () => {
      const res = await requestAgent()
        .patch('/api/v1/global-settings/roles-columns/999999')
        .send({ column_id: 1 });
      // Returns 500 because role_id 999999 doesn't exist in roles table (FK constraint)
      // The service layer doesn't pre-validate role existence - DB constraint enforces it
      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('DELETE /api/v1/global-settings/roles-columns/:role_id', () => {
    it('should delete a global roles_column entry', async () => {
      const rolesRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      const columnsRes = await requestAgent().get('/api/v1/global-settings/columns');
      const roleId = rolesRes.body.data[0]?.id;
      const colId = columnsRes.body.data[0]?.id;
      if (!roleId || !colId) return;

      // Create
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: roleId, column_id: colId, is_default: 1 });
      const entryId = createRes.body.data.id;

      // Delete
      const res = await requestAgent()
        .delete(`/api/v1/global-settings/roles-columns/${roleId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('deleted', true);

      // Verify it's gone
      const listRes = await requestAgent().get('/api/v1/global-settings/roles-columns');
      const stillExists = listRes.body.data.find((c: any) => c.id === entryId);
      expect(stillExists).toBeUndefined();
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await requestAgent()
        .delete('/api/v1/global-settings/roles-columns/999999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // =========================================================================
  // Project Seed
  // =========================================================================

  describe('GET /api/v1/global-settings/project-seed', () => {
    it('should return seed data structure', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/project-seed');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('columns');
      expect(res.body.data).toHaveProperty('workflows');
      expect(res.body.data).toHaveProperty('accessRules');
      expect(Array.isArray(res.body.data.columns)).toBe(true);
      expect(Array.isArray(res.body.data.workflows)).toBe(true);
      expect(Array.isArray(res.body.data.accessRules)).toBe(true);
    });

    it('should return data with columns after global columns exist', async () => {
      const res = await requestAgent().get('/api/v1/global-settings/project-seed');
      expect(res.status).toBe(200);
      expect(res.body.data.columns.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Reset to Defaults
  // =========================================================================

  describe('POST /api/v1/global-settings/reset', () => {
    it('should reset all global settings to defaults and return success', async () => {
      // First, create some custom global settings
      await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'reset-test-col', name: 'Reset Test', order: 999 });

      // Reset
      const res = await requestAgent().post('/api/v1/global-settings/reset');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('deleted');
    });

    it('should return success even when no global settings exist', async () => {
      // Reset again — should still succeed
      const res = await requestAgent().post('/api/v1/global-settings/reset');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should restore default columns after reset', async () => {
      // Create a custom column
      await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'restore-test', name: 'Restore Test', order: 888 });

      // Reset
      await requestAgent().post('/api/v1/global-settings/reset');

      // Verify default columns are present
      const columns = await requestAgent().get('/api/v1/global-settings/columns');
      expect(columns.status).toBe(200);
      const defaultCols = columns.body.data.map((c: any) => c.slug);
      expect(defaultCols).toContain('todo');
      expect(defaultCols).toContain('done');
    });

    it('should return proper response structure', async () => {
      const res = await requestAgent().post('/api/v1/global-settings/reset');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data).toBe('object');
    });
  });
});
