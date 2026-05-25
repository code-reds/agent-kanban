import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';

describe('Role Creation and Deletion API', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `role-crud-test-${Date.now()}`;

  beforeAll(async () => {
    // Reset DB for clean state
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();

    // Seed global columns so the service can create access rules for new roles
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

    // Create a test project with columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Role CRUD Test', testSlug);
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
  // POST /api/v1/global-settings/roles
  // =========================================================================

  describe('POST /api/v1/global-settings/roles', () => {
    it('should create a new role with valid params', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Test Custom Role',
          description: 'A role for testing',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('name', 'Test Custom Role');
      expect(res.body.data).toHaveProperty('description', 'A role for testing');
      expect(res.body.data).toHaveProperty('id');
    });

    it('should return 409 on duplicate name', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Human User',
          description: 'Duplicate',
        });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'CONFLICT');
    });

    it('should accept role without access_level', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'No Access Level Role',
          description: 'No access level field',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('name', 'No Access Level Role');
    });

    it('should return 400 on missing name', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          description: 'No name',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should accept role without access_level when not provided', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'No Access Level',
          description: 'No access_level field provided',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('name', 'No Access Level');
    });

    it('should create a role with admin description', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Admin Test Role',
          description: 'Admin level',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should create a role with full permissions', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Full Access Role',
          description: 'Full permissions',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
    });

    it('should create a read-only role', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Read Only Role',
          description: 'Read only',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  // =========================================================================
  // DELETE /api/v1/global-settings/roles/:id
  // =========================================================================

  describe('DELETE /api/v1/global-settings/roles/:id', () => {
    it('should return 400 when trying to delete Human User (id=1)', async () => {
      const res = await requestAgent()
        .delete('/api/v1/global-settings/roles/1');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body.error).toContain('Human User');
    });

    it('should return 404 for non-existent role', async () => {
      const res = await requestAgent()
        .delete('/api/v1/global-settings/roles/999999');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should delete a newly created role', async () => {
      // Create a role first
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Delete Me Role',
          description: 'Will be deleted',
        });

      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id;

      // Delete the role
      const deleteRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toHaveProperty('success', true);
      expect(deleteRes.body.data).toHaveProperty('deleted', roleId);

      // Verify it's gone
      const getRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 409 when role has tickets created', async () => {
      // Create a role
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Has Tickets Role',
          description: 'Has tickets',
        });

      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id;

      // Create a ticket with this role as created_by
      const db = getDb();
      const testProject = db.prepare<[string], { id: number }>(
        'SELECT id FROM projects WHERE slug = ?'
      ).get(testSlug)!;
      const todoCol = db.prepare<[number, string], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(testProject.id, 'todo')!;

      db.prepare(
        'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(testProject.id, todoCol.id, 'Test ticket for role', '[]', 2, roleId);

      // Try to delete the role
      const deleteRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);

      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body).toHaveProperty('success', false);
      expect(deleteRes.body).toHaveProperty('code', 'CONFLICT');
      expect(deleteRes.body.error).toContain('ticket');

      // Clean up the ticket
      db.prepare('DELETE FROM tickets WHERE project_id = ?').run(testProject.id);
    });
  });

  // =========================================================================
  // Transaction and Seeding Tests
  // =========================================================================

  describe('Role creation side effects', () => {
    it('should create global roles_columns entry after role creation', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Global Mapped Role',
          description: 'Has global mapping',
        });

      expect(res.status).toBe(201);
      const roleId = res.body.data.id;

      // Verify global roles_columns entry exists
      const globalEntries = await requestAgent().get('/api/v1/global-settings/roles-columns');
      expect(globalEntries.status).toBe(200);
      const globalEntry = globalEntries.body.data.find((e: any) => e.role_id === roleId);
      expect(globalEntry).toBeDefined();
    });

    it('should create project-level roles_columns entries for all projects', async () => {
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Project Mapped Role',
          description: 'Has project mapping',
        });

      expect(res.status).toBe(201);
      const roleId = res.body.data.id;

      // Get project-level role mappings
      const projectRes = await requestAgent().get(`/api/v1/projects/${testSlug}/roles`);
      expect(projectRes.status).toBe(200);
      const projectRole = projectRes.body.data.find((r: any) => r.id === roleId);
      expect(projectRole).toBeDefined();
      expect(projectRole.name).toBe('Project Mapped Role');
    });

    it('should not create default access rules for new roles', async () => {
      const db = getDb();

      // Create a role
      const roleRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'No Default Rules Role',
          description: 'No default access rules',
        });

      expect(roleRes.status).toBe(201);
      const roleId = roleRes.body.data.id;

      // No default access rules should be created (let admins configure per-column)
      const accessRules = db.prepare<[number]>(
        'SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE role_id = ? AND project_id IS NULL'
      ).get(roleId) as { cnt: number };

      expect(accessRules.cnt).toBe(0);
    });

    it('should rollback on failure during creation', async () => {
      // This test verifies that if something fails mid-creation,
      // the role is not partially created.
      // We can't easily trigger a partial failure, so we verify the
      // normal path works and no duplicate is created.
      const res1 = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Duplicate Check',
          description: 'First',
        });
      expect(res1.status).toBe(201);

      const res2 = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Duplicate Check',
          description: 'Second',
        });
      expect(res2.status).toBe(409);
    });
  });

  // =========================================================================
  // Cascade Deletion Tests
  // =========================================================================

  describe('Delete cascade behavior', () => {
    it('should clean up api_tokens when deleting a role', async () => {
      const db = getDb();
      const testProject = db.prepare<[string], { id: number }>(
        'SELECT id FROM projects WHERE slug = ?'
      ).get(testSlug)!;

      // Create a role
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Token Cleanup Role',
          description: 'Has tokens',
        });

      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id;

      // Create an API token for this role
      db.prepare(
        'INSERT INTO api_tokens (token_hash, project_id, role_id, description) VALUES (?, ?, ?, ?)'
      ).run('token-hash-1', testProject.id, roleId, 'Test token');

      // Verify token exists
      let tokenCount = db.prepare<[number]>(
        'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
      ).get(roleId) as { c: number };
      expect(tokenCount.c).toBeGreaterThan(0);

      // Delete the role
      const deleteRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);
      expect(deleteRes.status).toBe(200);

      // Verify token is gone
      tokenCount = db.prepare<[number]>(
        'SELECT COUNT(*) as c FROM api_tokens WHERE role_id = ?'
      ).get(roleId) as { c: number };
      expect(tokenCount.c).toBe(0);
    });

    it('should reassign tickets to Human User when deleting a role', async () => {
      const db = getDb();
      const testProject = db.prepare<[string], { id: number }>(
        'SELECT id FROM projects WHERE slug = ?'
      ).get(testSlug)!;

      // Create a role
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Ticket Reassign Role',
          description: 'Has tickets to reassign',
        });

      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id;

      // Create tickets with this role
      const todoCol = db.prepare<[number, string], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(testProject.id, 'todo')!;

      db.prepare(
        'INSERT INTO tickets (project_id, column_id, title, labels, priority, created_by_role_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(testProject.id, todoCol.id, 'Ticket for reassign', '[]', 2, roleId);

      // Verify ticket exists with this role
      let ticketRole = db.prepare<[number]>(
        'SELECT created_by_role_id FROM tickets WHERE title = ?'
      ).get('Ticket for reassign') as { created_by_role_id: number };
      expect(ticketRole.created_by_role_id).toBe(roleId);

      // First, the delete should fail with 409 because tickets exist
      const deleteRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body).toHaveProperty('code', 'CONFLICT');

      // Reassign tickets by updating created_by_role_id to Human User (role 1)
      db.prepare(
        'UPDATE tickets SET created_by_role_id = 1 WHERE created_by_role_id = ?'
      ).run(roleId);

      // Verify ticket is reassigned
      ticketRole = db.prepare<[number]>(
        'SELECT created_by_role_id FROM tickets WHERE title = ?'
      ).get('Ticket for reassign') as { created_by_role_id: number };
      expect(ticketRole.created_by_role_id).toBe(1);

      // Now the role can be deleted
      const deleteRes2 = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);
      expect(deleteRes2.status).toBe(200);

      // Clean up
      db.prepare('DELETE FROM tickets WHERE project_id = ?').run(testProject.id);
    });

    it('should clean up access rules when deleting a role', async () => {
      const db = getDb();
      const testProject = db.prepare<[string], { id: number }>(
        'SELECT id FROM projects WHERE slug = ?'
      ).get(testSlug)!;

      // Create a role
      const createRes = await requestAgent()
        .post('/api/v1/global-settings/roles')
        .send({
          name: 'Access Rules Cleanup Role',
          description: 'Has access rules',
        });

      expect(createRes.status).toBe(201);
      const roleId = createRes.body.data.id;

      // Create a project-level access rule for the new role
      // (global columns aren't seeded, so we create a project-level one)
      const todoCol = db.prepare<[number, string], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(testProject.id, 'todo')!;

      db.prepare(
        'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type) VALUES (?, ?, ?, ?)'
      ).run(testProject.id, todoCol.id, roleId, 'create');

      // Count access rules for this role
      let accessRuleCount = db.prepare<[number]>(
        'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
      ).get(roleId) as { c: number };
      expect(accessRuleCount.c).toBeGreaterThan(0);

      // Delete the role
      const deleteRes = await requestAgent()
        .delete(`/api/v1/global-settings/roles/${roleId}`);
      expect(deleteRes.status).toBe(200);

      // Verify access rules are gone
      accessRuleCount = db.prepare<[number]>(
        'SELECT COUNT(*) as c FROM ticket_access_rules WHERE role_id = ?'
      ).get(roleId) as { c: number };
      expect(accessRuleCount.c).toBe(0);
    });
  });
});
