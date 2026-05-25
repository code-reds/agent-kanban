import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedGlobalDefaults, seedProjectColumns } from '../db/seed.js';

describe('Project Roles_Columns API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `prc-api-${Date.now()}`;
  let projectId: number;
  let projectCols: { id: number; slug: string }[];
  let roleArchitect: number; // AI architect (role_id = 3)
  let roleDeveloper: number; // AI code developer (role_id = 4)
  let colTodo: number;
  let colImplementation: number;
  let colUnitReview: number;

  beforeAll(async () => {
    // Reset DB for clean state
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();

    // Seed global defaults so roles_columns are available
    seedGlobalDefaults();

    // Create a test project with columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Project RolesColumns Test', testSlug);
    const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug) as { id: number };
    projectId = project.id;

    // Get role IDs
    const roles = db.prepare('SELECT id, name FROM roles ORDER BY id').all() as { id: number; name: string }[];
    roleArchitect = roles.find((r) => r.name === 'AI architect')!.id;
    roleDeveloper = roles.find((r) => r.name === 'AI code developer')!.id;

    // Seed project columns (includes hardcoded role-column mappings)
    seedProjectColumns(projectId, roles.map((r) => r.id));

    // Get the actual column IDs
    projectCols = db.prepare(
      'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(projectId) as { id: number; slug: string }[];
    colTodo = projectCols.find((c) => c.slug === 'todo')!.id;
    colImplementation = projectCols.find((c) => c.slug === 'implementation')!.id;
    colUnitReview = projectCols.find((c) => c.slug === 'unit_review')!.id;

    await startServer();
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  // Helper: delete project-specific roles_columns entries for a role
  function clearProjectRoleColumn(roleId: number): void {
    getDb().prepare(
      'DELETE FROM roles_columns WHERE project_id = ? AND role_id = ?'
    ).run(projectId, roleId);
  }

  // =========================================================================
  // GET /api/v1/projects/:slug/roles-columns
  // =========================================================================

  describe('GET /api/v1/projects/:slug/roles-columns', () => {
    it('should return combined project + global roles_columns entries', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should return entries with role_name, column_name, and is_override fields', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(7);

      for (const entry of res.body.data) {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('role_id');
        expect(entry).toHaveProperty('role_name');
        expect(entry).toHaveProperty('column_id');
        expect(entry).toHaveProperty('column_name');
        expect(entry).toHaveProperty('is_default');
        expect(entry).toHaveProperty('is_override');
      }
    });

    it('should return project-specific overrides with is_override = 1', async () => {
      // Clear pre-seeded mappings for the architect
      clearProjectRoleColumn(roleArchitect);

      // Create a project-specific override via POST
      const res1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleArchitect, column_id: colUnitReview, is_default: 1 });
      expect(res1.status).toBe(201);

      // Now GET and check is_override
      const res2 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res2.status).toBe(200);

      const overrideEntry = res2.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(overrideEntry).toBeDefined();
      expect(overrideEntry.is_override).toBe(1);
    });

    it('should return inherited global defaults with is_override = 0', async () => {
      // Clear pre-seeded mappings
      clearProjectRoleColumn(roleArchitect);

      // GET should now show only global defaults with is_override = 0
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);

      const architectEntry = res.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(architectEntry.is_override).toBe(0);
    });

    it('should return NULL column_name when column_id is NULL (unrestricted)', async () => {
      // Clear pre-seeded mappings
      const db = getDb();
      clearProjectRoleColumn(1); // Human User

      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);

      // Human User should have NULL column_id (from global defaults)
      const humanUser = res.body.data.find((e: any) => e.role_id === 1);
      expect(humanUser).toBeDefined();
      expect(humanUser.column_id).toBeNull();
      expect(humanUser.column_name).toBeNull();
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .get('/api/v1/projects/nonexistent-xyz/roles-columns');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return all 7 roles with mappings', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(7);
    });

    it('should return entries ordered by role_id', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(res.status).toBe(200);

      const roleIds = res.body.data.map((e: any) => e.role_id);
      for (let i = 1; i < roleIds.length; i++) {
        expect(roleIds[i]).toBeGreaterThanOrEqual(roleIds[i - 1]);
      }
    });
  });

  // =========================================================================
  // POST /api/v1/projects/:slug/roles-columns
  // =========================================================================

  describe('POST /api/v1/projects/:slug/roles-columns', () => {
    it('should create a project-specific override (via upsert)', async () => {
      // Clear pre-seeded mapping first so we test the upsert properly
      clearProjectRoleColumn(roleDeveloper);

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview, is_default: 0 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('role_id', roleDeveloper);
      expect(res.body.data).toHaveProperty('column_id', colUnitReview);
      expect(res.body.data).toHaveProperty('id');
    });

    it('should reject missing role_id', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ column_id: colUnitReview });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should handle upsert (idempotent update)', async () => {
      // Clear first
      clearProjectRoleColumn(roleDeveloper);

      // First create
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview, is_default: 0 });
      expect(createRes.status).toBe(201);
      const id1 = createRes.body.data.id;

      // Update (same role_id)
      const updateRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colTodo, is_default: 1 });
      expect(updateRes.status).toBe(201);
      expect(updateRes.body.data.id).toBe(id1);
      expect(updateRes.body.data.column_id).toBe(colTodo);
      expect(updateRes.body.data.is_default).toBe(1);
    });

    it('should handle NULL column_id (unrestricted access)', async () => {
      clearProjectRoleColumn(roleDeveloper);

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: null, is_default: 0 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('role_id', roleDeveloper);
      expect(res.body.data).toHaveProperty('column_id', null);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent-xyz/roles-columns')
        .send({ role_id: roleDeveloper, column_id: colUnitReview });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should set is_default to 0 when not provided', async () => {
      clearProjectRoleColumn(roleDeveloper);

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview });
      expect(res.status).toBe(201);
      expect(res.body.data.is_default).toBe(0);
    });
  });

  // =========================================================================
  // PATCH /api/v1/projects/:slug/roles-columns/:role_id
  // =========================================================================

  describe('PATCH /api/v1/projects/:slug/roles-columns/:role_id', () => {
    it('should update a project-specific override', async () => {
      // Clear and create
      clearProjectRoleColumn(roleDeveloper);
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview, is_default: 0 });

      // Update via PATCH
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles-columns/${roleDeveloper}`)
        .send({ column_id: colTodo, is_default: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('role_id', roleDeveloper);
      expect(res.body.data).toHaveProperty('column_id', colTodo);
      expect(res.body.data).toHaveProperty('is_default', 1);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .patch('/api/v1/projects/nonexistent-xyz/roles-columns/1')
        .send({ column_id: colUnitReview });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should handle NULL column_id', async () => {
      clearProjectRoleColumn(roleDeveloper);
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview });

      // Update with NULL
      const res = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles-columns/${roleDeveloper}`)
        .send({ column_id: null, is_default: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.column_id).toBeNull();
      expect(res.body.data.is_default).toBe(1);
    });
  });

  // =========================================================================
  // DELETE /api/v1/projects/:slug/roles-columns/:role_id
  // =========================================================================

  describe('DELETE /api/v1/projects/:slug/roles-columns/:role_id', () => {
    it('should delete a project-specific override', async () => {
      // Clear and create
      clearProjectRoleColumn(roleDeveloper);
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleDeveloper, column_id: colUnitReview, is_default: 0 });
      const roleId = roleDeveloper;

      // Delete
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/roles-columns/${roleId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('deleted', true);
    });

    it('should revert to global default after delete', async () => {
      // Clear first
      clearProjectRoleColumn(roleArchitect);

      // Create a project override
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleArchitect, column_id: colUnitReview, is_default: 0 });

      // Verify it exists with is_override = 1
      const beforeGet = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      const overrideBefore = beforeGet.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(overrideBefore.is_override).toBe(1);
      expect(overrideBefore.column_id).toBe(colUnitReview);

      // Delete the override
      const deleteRes = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/roles-columns/${roleArchitect}`);
      expect(deleteRes.status).toBe(200);

      // Verify it's gone (should fall back to global default)
      const afterGet = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      const overrideAfter = afterGet.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(overrideAfter.is_override).toBe(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .delete('/api/v1/projects/nonexistent-xyz/roles-columns/1');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent project override', async () => {
      // Clear pre-seeded mappings for this role
      clearProjectRoleColumn(roleDeveloper);

      // This role has no project-specific override anymore
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/roles-columns/${roleDeveloper}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  // =========================================================================
  // Integration: Combined CRUD flow
  // =========================================================================

  describe('Integration: full CRUD cycle', () => {
    it('should support create, read, update, delete cycle', async () => {
      // Clear pre-seeded mapping
      clearProjectRoleColumn(roleDeveloper);

      const testRoleId = roleDeveloper;
      const col1 = colUnitReview;
      const col2 = colTodo;

      // 1. CREATE
      const createRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: testRoleId, column_id: col1, is_default: 1 });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.column_id).toBe(col1);

      // 2. READ (combined with global defaults)
      const getRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      expect(getRes.status).toBe(200);
      const entryAfterCreate = getRes.body.data.find((e: any) => e.role_id === testRoleId);
      expect(entryAfterCreate).toBeDefined();
      expect(entryAfterCreate.is_override).toBe(1);
      expect(entryAfterCreate.column_id).toBe(col1);

      // 3. UPDATE
      const updateRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug}/roles-columns/${testRoleId}`)
        .send({ column_id: col2, is_default: 0 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.column_id).toBe(col2);

      // Verify updated values via GET
      const getRes2 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      const entryAfterUpdate = getRes2.body.data.find((e: any) => e.role_id === testRoleId);
      expect(entryAfterUpdate.column_id).toBe(col2);
      expect(entryAfterUpdate.is_default).toBe(0);

      // 4. DELETE
      const deleteRes = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/roles-columns/${testRoleId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.deleted).toBe(true);

      // Verify deleted (should fall back to global default)
      const getRes3 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      const entryAfterDelete = getRes3.body.data.find((e: any) => e.role_id === testRoleId);
      expect(entryAfterDelete.is_override).toBe(0);
    });

    it('should have independent roles_columns between project overrides and global defaults', async () => {
      // Clear pre-seeded project mappings
      clearProjectRoleColumn(roleArchitect);

      // Get current global default for AI architect
      const globalRes = await requestAgent()
        .get('/api/v1/global-settings/roles-columns');
      const globalArchitect = globalRes.body.data.find((e: any) => e.role_id === roleArchitect);
      const globalColId = globalArchitect?.column_id;

      // Create a different project-specific override
      await requestAgent()
        .post(`/api/v1/projects/${testSlug}/roles-columns`)
        .send({ role_id: roleArchitect, column_id: colTodo, is_default: 0 });

      // Verify project-level returns the override
      const projectRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles-columns`);
      const projectArchitect = projectRes.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(projectArchitect.is_override).toBe(1);
      expect(projectArchitect.column_id).toBe(colTodo);
      // It should be different from the global default (if different)
      if (globalColId !== null) {
        expect(projectArchitect.column_id).not.toBe(globalColId);
      }

      // Verify global-level is unchanged
      const globalRes2 = await requestAgent()
        .get('/api/v1/global-settings/roles-columns');
      const globalArchitect2 = globalRes2.body.data.find((e: any) => e.role_id === roleArchitect);
      expect(globalArchitect2.column_id).toBe(globalColId);
    });
  });
});
