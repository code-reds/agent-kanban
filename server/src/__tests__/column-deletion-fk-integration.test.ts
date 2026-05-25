import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns, seedGlobalDefaults } from '../db/seed.js';

describe('Column Deletion Integration Tests — FK Constraint Fixes (Ticket #156)', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `col-del-test-${Date.now()}`;

  beforeAll(async () => {
    resetDb();
    const db = getDb();
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations();
    seedDefaultRoles();

    // Seed global defaults BEFORE creating project, so global columns exist
    seedGlobalDefaults();

    try {
      db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
    } catch { /* ignore */ }

    // Create a test project with seeded columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Column Deletion Test', testSlug);
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
  // Global Column Deletion with FK Dependencies
  // =========================================================================

  describe('Global Column deletion with FK dependency chains', () => {
    beforeEach(() => {
      // Clean up any leftover test columns from previous tests in this suite
      const db = getDb();
      const cols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL AND slug LIKE ?'
      ).all(['col-del-%']) as { id: number }[];
      for (const c of cols) {
        try { db.prepare('DELETE FROM ticket_access_rules WHERE column_id = ? AND project_id IS NULL').run(c.id); } catch {}
        try { db.prepare('DELETE FROM roles_columns WHERE column_id = ? AND project_id IS NULL').run(c.id); } catch {}
        try { db.prepare('DELETE FROM workflow_transitions WHERE (column_from = ? OR column_to = ?) AND project_id IS NULL').run(c.id, c.id); } catch {}
        try { db.prepare('DELETE FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?').run(c.id, c.id); } catch {}
        try { db.prepare('DELETE FROM kanban_columns WHERE id = ?').run(c.id); } catch {}
      }
    });

    it('should delete a global column with associated workflow_transitions (FK cleanup)', async () => {
      // Create two global columns
      const c1 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-gc1', name: 'GC1', order: 10 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      const c2 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-gc2', name: 'GC2', order: 11 });
      expect(c2.status).toBe(201);
      const col2 = c2.body.data;

      // Create a global workflow transition between them
      const wfRes = await requestAgent()
        .post('/api/v1/global-settings/workflows')
        .send({ column_from: col1.id, column_to: col2.id });
      expect(wfRes.status).toBe(201);

      // Create a global access rule for col1
      const res = await requestAgent()
        .patch('/api/v1/global-settings/access-rules')
        .send({
          rules: [
            { column_id: col1.id, role_id: 1, action_type: 'create' },
            { column_id: col1.id, role_id: 1, action_type: 'edit' },
          ],
        });
      expect(res.status).toBe(200);

      // Now delete col1 — should also clean up its FK references
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${col1.id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify column is gone
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const stillExists = listRes.body.data.find((c: any) => c.id === col1.id);
      expect(stillExists).toBeUndefined();

      // Verify FK cleanup: workflow_transitions referencing col1 should be gone
      const db = getDb();
      const remainingWfs = db.prepare(
        "SELECT COUNT(*) as cnt FROM workflow_transitions WHERE project_id IS NULL AND (column_from = ? OR column_to = ?)"
      ).get(col1.id, col1.id) as { cnt: number };
      expect(remainingWfs.cnt).toBe(0);

      // Verify FK cleanup: access_rules referencing col1 (global) should be gone
      const remainingRules = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE column_id = ? AND project_id IS NULL"
      ).get(col1.id) as { cnt: number };
      expect(remainingRules.cnt).toBe(0);

      // col2 should still exist
      const col2StillExists = listRes.body.data.find((c: any) => c.id === col2.id);
      expect(col2StillExists).toBeDefined();
    });

    it('should delete a global column with roles_columns FK references', async () => {
      // Create a global column
      const c1 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-rc', name: 'RC Test', order: 20 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      // Create role_column entries
      const res = await requestAgent()
        .post('/api/v1/global-settings/roles-columns')
        .send({ role_id: 1, column_id: col1.id, is_default: 1 });
      expect(res.status).toBe(201);

      // Delete the column
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${col1.id}`);
      expect(delRes.status).toBe(200);

      // Verify FK cleanup: roles_columns referencing col1 should be gone
      const db = getDb();
      const remainingRC = db.prepare(
        "SELECT COUNT(*) as cnt FROM roles_columns WHERE column_id = ? AND project_id IS NULL"
      ).get(col1.id) as { cnt: number };
      expect(remainingRC.cnt).toBe(0);
    });

    it('should delete a global column with ticket_status_history records (after removing ticket)', async () => {
      // Create two global columns
      const c1 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-tsh1', name: 'TSH1', order: 30 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      const c2 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-tsh2', name: 'TSH2', order: 31 });
      expect(c2.status).toBe(201);
      const col2 = c2.body.data;

      // Create a ticket in col1
      const db = getDb();
      const ticket = db.prepare(
        "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_by_role_id) VALUES (?, ?, 'Test', '', '[]', 2, 1)"
      ).run(1, col1.id);
      const ticketId = ticket.lastInsertRowid as number;

      // Create status history referencing col1
      db.prepare(
        "INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id) VALUES (?, ?, ?, ?)"
      ).run(ticketId, col1.id, col2.id, 1);

      // Verify history exists
      const historyCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?"
      ).get(col1.id, col1.id) as { cnt: number };
      expect(historyCount.cnt).toBeGreaterThan(0);

      // Move the ticket to col2 (so col1 has no tickets)
      db.prepare("UPDATE tickets SET column_id = ? WHERE id = ?").run(col2.id, ticketId);

      // Delete col1 — should now succeed and also clean up ticket_status_history
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${col1.id}`);
      expect(delRes.status).toBe(200);

      // Verify FK cleanup: ticket_status_history referencing col1 should be gone
      const remainingHistory = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?"
      ).get(col1.id, col1.id) as { cnt: number };
      expect(remainingHistory.cnt).toBe(0);
    });

    it('should reject deleting a global column that has tickets', async () => {
      // Create a global column
      const c1 = await requestAgent()
        .post('/api/v1/global-settings/columns')
        .send({ slug: 'col-del-blocked', name: 'Blocked', order: 40 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      // Create a ticket in this column (stay in col1)
      const db = getDb();
      db.prepare(
        "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_by_role_id) VALUES (?, ?, 'Blocked Ticket', '', '[]', 2, 1)"
      ).run(1, col1.id);

      // Try to delete — should fail because column has tickets
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${col1.id}`);
      expect(delRes.status).toBe(400);
      expect(delRes.body).toHaveProperty('success', false);
      expect(delRes.body).toHaveProperty('code', 'VALIDATION_ERROR');

      // Verify column still exists
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const stillExists = listRes.body.data.find((c: any) => c.id === col1.id);
      expect(stillExists).toBeDefined();
    });

    it('should reject deleting the "todo" global column (protected slug)', async () => {
      // Find the todo global column
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const todoCol = listRes.body.data.find((c: any) => c.slug === 'todo');
      expect(todoCol).toBeDefined();

      // Try to delete
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${todoCol.id}`);
      expect(delRes.status).toBe(400);
      expect(delRes.body).toHaveProperty('success', false);
    });

    it('should reject deleting the "done" global column (protected slug)', async () => {
      // Find the done global column
      const listRes = await requestAgent().get('/api/v1/global-settings/columns');
      const doneCol = listRes.body.data.find((c: any) => c.slug === 'done');
      expect(doneCol).toBeDefined();

      // Try to delete
      const delRes = await requestAgent().delete(`/api/v1/global-settings/columns/${doneCol.id}`);
      expect(delRes.status).toBe(400);
      expect(delRes.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent global column deletion', async () => {
      const delRes = await requestAgent().delete('/api/v1/global-settings/columns/999999');
      expect(delRes.status).toBe(404);
      expect(delRes.body).toHaveProperty('success', false);
    });
  });

  // =========================================================================
  // Project-Level Column Deletion with FK Dependencies
  // =========================================================================

  describe('Project column deletion with FK dependency chains', () => {
    // Use a unique test project to avoid interference with main test project
    const testSlug2 = `col-del-project-${Date.now()}`;

    beforeAll(async () => {
      // Create a separate test project for these tests
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Project Column Test', testSlug2);
      const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(testSlug2) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map((r) => r.id));
    });

    afterAll(async () => {
      try {
        await requestAgent().delete(`/api/v1/projects/${testSlug2}`);
      } catch { /* ignore */ }
    });

    // No beforeEach needed - each test creates and cleans up its own columns

    it('should delete a project column with associated workflow_transitions (FK cleanup)', async () => {
      // Create two project columns (use the test project)
      const c1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc1', name: 'PC1', order: 100 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      const c2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc2', name: 'PC2', order: 101 });
      expect(c2.status).toBe(201);
      const col2 = c2.body.data;

      // Create a workflow transition between project columns
      const wfRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/workflow`)
        .send({ column_from: col1.id, column_to: col2.id });
      expect(wfRes.status).toBe(201);

      // Create access rules for col1
      const arRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug2}/access-rules`)
        .send({
          rules: [
            { column_id: col1.id, role_id: 1, action_type: 'create' },
          ],
        });
      expect(arRes.status).toBe(200);

      // Delete col1 — should also clean up FK references
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${col1.id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify column is gone
      const listRes = await requestAgent().get(`/api/v1/projects/${testSlug2}/columns`);
      const stillExists = listRes.body.data.find((c: any) => c.id === col1.id);
      expect(stillExists).toBeUndefined();

      // Verify FK cleanup: workflow_transitions referencing col1 should be gone
      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug2) as { id: number };
      const remainingWfs = db.prepare(
        "SELECT COUNT(*) as cnt FROM workflow_transitions WHERE project_id = ? AND (column_from = ? OR column_to = ?)"
      ).get(project.id, col1.id, col1.id) as { cnt: number };
      expect(remainingWfs.cnt).toBe(0);

      // col2 should still exist
      const col2StillExists = listRes.body.data.find((c: any) => c.id === col2.id);
      expect(col2StillExists).toBeDefined();
    });

    it('should delete a project column with roles_columns and ticket_access_rules FK refs', async () => {
      // Create a project column
      const c1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc-rc', name: 'PC-RC', order: 110 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      // Create roles_columns entry
      const rcRes = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/roles-columns`)
        .send({ role_id: 1, column_id: col1.id });
      expect(rcRes.status).toBe(201);

      // Create access rule
      const arRes = await requestAgent()
        .patch(`/api/v1/projects/${testSlug2}/access-rules`)
        .send({
          rules: [
            { column_id: col1.id, role_id: 1, action_type: 'edit' },
          ],
        });
      expect(arRes.status).toBe(200);

      // Delete col1
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${col1.id}`);
      expect(delRes.status).toBe(200);

      // Verify FK cleanup
      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug2) as { id: number };
      const remainingRC = db.prepare(
        "SELECT COUNT(*) as cnt FROM roles_columns WHERE column_id = ? AND project_id = ?"
      ).get(col1.id, project.id) as { cnt: number };
      expect(remainingRC.cnt).toBe(0);

      const remainingRules = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE column_id = ? AND project_id = ?"
      ).get(col1.id, project.id) as { cnt: number };
      expect(remainingRules.cnt).toBe(0);
    });

    it('should delete a project column with ticket_status_history records', async () => {
      // Create two project columns
      const c1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc-tsh1', name: 'PCTSH1', order: 120 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      const c2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc-tsh2', name: 'PCTSH2', order: 121 });
      expect(c2.status).toBe(201);
      const col2 = c2.body.data;

      // Create a ticket in col1
      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug2) as { id: number };
      db.prepare(
        "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_by_role_id) VALUES (?, ?, 'TSH Ticket', '', '[]', 2, 1)"
      ).run(project.id, col1.id);
      const ticketId = db.prepare('SELECT last_insert_rowid() as id').get().id;

      // Create status history
      db.prepare(
        "INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id) VALUES (?, ?, ?, ?)"
      ).run(ticketId, col1.id, col2.id, 1);

      // Verify history exists
      const historyCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?"
      ).get(col1.id, col1.id) as { cnt: number };
      expect(historyCount.cnt).toBeGreaterThan(0);

      // Move the ticket to col2
      db.prepare("UPDATE tickets SET column_id = ? WHERE id = ?").run(col2.id, ticketId);

      // Delete col1 — should also clean up ticket_status_history
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${col1.id}`);
      expect(delRes.status).toBe(200);

      // Verify FK cleanup
      const remainingHistory = db.prepare(
        "SELECT COUNT(*) as cnt FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?"
      ).get(col1.id, col1.id) as { cnt: number };
      expect(remainingHistory.cnt).toBe(0);
    });

    it('should delete a project column that has tickets (moving tickets to todo)', async () => {
      // Create a project column
      const c1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug2}/columns`)
        .send({ slug: 'col-del-pc-with-tickets', name: 'PC-With-Tickets', order: 130 });
      expect(c1.status).toBe(201);
      const col1 = c1.body.data;

      // Find the 'todo' column in this project
      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug2) as { id: number };
      const todoCol = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
      ).get(project.id, 'todo') as { id: number } | undefined;
      expect(todoCol).toBeDefined();

      // Create a ticket in col1
      db.prepare(
        "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_by_role_id) VALUES (?, ?, 'InFlight', '', '[]', 2, 1)"
      ).run(project.id, col1.id);

      // Verify ticket is in col1
      const ticketBefore = db.prepare(
        'SELECT column_id FROM tickets WHERE title = ?'
      ).get('InFlight') as { column_id: number } | undefined;
      expect(ticketBefore?.column_id).toBe(col1.id);

      // Delete — should succeed and move tickets to todo
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${col1.id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify column is gone
      const listRes = await requestAgent().get(`/api/v1/projects/${testSlug2}/columns`);
      const stillExists = listRes.body.data.find((c: any) => c.id === col1.id);
      expect(stillExists).toBeUndefined();

      // Verify ticket was moved to todo
      const ticketAfter = db.prepare(
        'SELECT column_id FROM tickets WHERE title = ?'
      ).get('InFlight') as { column_id: number } | undefined;
      expect(ticketAfter?.column_id).toBe(todoCol?.id);
    });

    it('should reject deleting the "todo" project column (protected slug)', async () => {
      const listRes = await requestAgent().get(`/api/v1/projects/${testSlug2}/columns`);
      const todoCol = listRes.body.data.find((c: any) => c.slug === 'todo');
      expect(todoCol).toBeDefined();

      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${todoCol.id}`);
      expect(delRes.status).toBe(400);
      expect(delRes.body).toHaveProperty('success', false);
    });

    it('should reject deleting the "done" project column (protected slug)', async () => {
      const listRes = await requestAgent().get(`/api/v1/projects/${testSlug2}/columns`);
      const doneCol = listRes.body.data.find((c: any) => c.slug === 'done');
      expect(doneCol).toBeDefined();

      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/${doneCol.id}`);
      expect(delRes.status).toBe(400);
      expect(delRes.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent project column deletion', async () => {
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug2}/columns/999999`);
      expect(delRes.status).toBe(404);
      expect(delRes.body).toHaveProperty('success', false);
    });
  });

  // =========================================================================
  // End-to-End: Full FK cleanup chain for seeded project columns
  // =========================================================================

  describe('End-to-End: Full FK cleanup for seeded project columns', () => {
    // Use a separate project to avoid interference
    const testSlug3 = `col-del-e2e-${Date.now()}`;

    beforeAll(async () => {
      const db = getDb();
      db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('E2E Test', testSlug3);
      const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(testSlug3) as { id: number };
      const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      seedProjectColumns(project.id, roleIds.map((r) => r.id));
    });

    afterAll(async () => {
      try {
        await requestAgent().delete(`/api/v1/projects/${testSlug3}`);
      } catch { /* ignore */ }
    });

    it('should handle deleting a project column with multiple FK dependency types', async () => {
      // Create multiple custom columns with interdependencies
      const cols = await Promise.all([
        requestAgent().post(`/api/v1/projects/${testSlug3}/columns`).send({ slug: 'col-del-e2e-1', name: 'E2E-1', order: 200 }),
        requestAgent().post(`/api/v1/projects/${testSlug3}/columns`).send({ slug: 'col-del-e2e-2', name: 'E2E-2', order: 201 }),
        requestAgent().post(`/api/v1/projects/${testSlug3}/columns`).send({ slug: 'col-del-e2e-3', name: 'E2E-3', order: 202 }),
      ]);
      for (const c of cols) expect(c.status).toBe(201);
      const col1 = cols[0].body.data;
      const col2 = cols[1].body.data;
      const col3 = cols[2].body.data;

      // Create workflow transitions
      await requestAgent().post(`/api/v1/projects/${testSlug3}/workflow`).send({ column_from: col1.id, column_to: col2.id });
      await requestAgent().post(`/api/v1/projects/${testSlug3}/workflow`).send({ column_from: col2.id, column_to: col3.id });

      // Create access rules for col1
      await requestAgent().patch(`/api/v1/projects/${testSlug3}/access-rules`).send({
        rules: [
          { column_id: col1.id, role_id: 1, action_type: 'create' },
          { column_id: col1.id, role_id: 2, action_type: 'edit' },
        ],
      });

      // Create role_column entries for col1
      await requestAgent().post(`/api/v1/projects/${testSlug3}/roles-columns`).send({ role_id: 1, column_id: col1.id });
      await requestAgent().post(`/api/v1/projects/${testSlug3}/roles-columns`).send({ role_id: 2, column_id: col1.id });

      // Create a ticket and status history, then move ticket out
      const db = getDb();
      const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(testSlug3) as { id: number };
      db.prepare(
        "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_by_role_id) VALUES (?, ?, 'E2E Ticket', '', '[]', 2, 1)"
      ).run(project.id, col1.id);
      const ticketId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      db.prepare(
        "INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id) VALUES (?, ?, ?, ?)"
      ).run(ticketId, col1.id, col2.id, 1);
      db.prepare(
        "INSERT INTO ticket_status_history (ticket_id, from_column_id, to_column_id, actor_role_id) VALUES (?, ?, ?, ?)"
      ).run(ticketId, col2.id, col3.id, 1);

      // Move ticket to col3 so col1 is empty
      db.prepare("UPDATE tickets SET column_id = ? WHERE id = ?").run(col3.id, ticketId);

      // Now delete col1 — should clean up ALL FK dependencies
      const delRes = await requestAgent().delete(`/api/v1/projects/${testSlug3}/columns/${col1.id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body).toHaveProperty('success', true);

      // Verify col1 is gone
      const listRes = await requestAgent().get(`/api/v1/projects/${testSlug3}/columns`);
      const stillExists = listRes.body.data.find((c: any) => c.id === col1.id);
      expect(stillExists).toBeUndefined();

      // Verify ALL FK cleanup
      expect(
        db.prepare("SELECT COUNT(*) as cnt FROM workflow_transitions WHERE project_id = ? AND (column_from = ? OR column_to = ?)").get(project.id, col1.id, col1.id) as { cnt: number }
      ).toMatchObject({ cnt: 0 });

      expect(
        db.prepare("SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE column_id = ? AND project_id = ?").get(col1.id, project.id) as { cnt: number }
      ).toMatchObject({ cnt: 0 });

      expect(
        db.prepare("SELECT COUNT(*) as cnt FROM roles_columns WHERE column_id = ? AND project_id = ?").get(col1.id, project.id) as { cnt: number }
      ).toMatchObject({ cnt: 0 });

      expect(
        db.prepare("SELECT COUNT(*) as cnt FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?").get(col1.id, col1.id) as { cnt: number }
      ).toMatchObject({ cnt: 0 });

      // col2 and col3 should still exist
      const col2StillExists = listRes.body.data.find((c: any) => c.id === col2.id);
      const col3StillExists = listRes.body.data.find((c: any) => c.id === col3.id);
      expect(col2StillExists).toBeDefined();
      expect(col3StillExists).toBeDefined();
    });
  });
});
