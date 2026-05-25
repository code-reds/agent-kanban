import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedGlobalDefaults } from '../db/seed.js';

describe('Global Workflow CRUD — Full Request/Response Cycle (Ticket #157)', () => {
  const requestAgent = () => request(getApp());

  beforeAll(async () => {
    resetDb();
    const db = getDb();
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations();
    seedDefaultRoles();
    seedGlobalDefaults();

    try {
      db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
    } catch { /* ignore */ }

    await startServer();
  });

  afterAll(async () => {
    // Clean up test columns
    const db = getDb();
    const cols = db.prepare(
      'SELECT id FROM kanban_columns WHERE project_id IS NULL AND slug LIKE ?'
    ).all(['col-crud-%']) as { id: number }[];
    for (const c of cols) {
      try { db.prepare('DELETE FROM ticket_access_rules WHERE column_id = ? AND project_id IS NULL').run(c.id); } catch {}
      try { db.prepare('DELETE FROM roles_columns WHERE column_id = ? AND project_id IS NULL').run(c.id); } catch {}
      try { db.prepare('DELETE FROM workflow_transitions WHERE (column_from = ? OR column_to = ?) AND project_id IS NULL').run(c.id, c.id); } catch {}
      try { db.prepare('DELETE FROM kanban_columns WHERE id = ?').run(c.id); } catch {}
    }
    // Clean up test workflows (created via API)
    const wfs = db.prepare(
      "SELECT id FROM workflow_transitions WHERE project_id IS NULL AND (column_from LIKE ? OR column_to LIKE ?)"
    ).all(['col-crud-%', 'col-crud-%']) as { id: number }[];
    for (const wf of wfs) {
      try { db.prepare('DELETE FROM transition_allowed_roles WHERE workflow_transition_id = ?').run(wf.id); } catch {}
      try { db.prepare('DELETE FROM workflow_transitions WHERE id = ?').run(wf.id); } catch {}
    }
    delete process.env.PORT;
    await stopServer();
  });

  // =========================================================================
  // Test: Add workflow → re-fetch → verify in list
  // =========================================================================

  it('POST → GET: Full cycle for adding a workflow transition', async () => {
    // Step 1: Create two columns for the transition
    const col1 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-a1', name: 'CrudA1', order: 100 });
    expect(col1.status).toBe(201);
    const col1Id = col1.body.data.id;

    const col2 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-a2', name: 'CrudA2', order: 101 });
    expect(col2.status).toBe(201);
    const col2Id = col2.body.data.id;

    // Step 2: Verify no workflows exist yet between these columns
    const beforeList = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(beforeList.status).toBe(200);
    const existingCount = beforeList.body.data.filter(
      (w: any) => w.column_from === col1Id && w.column_to === col2Id
    ).length;
    expect(existingCount).toBe(0);

    // Step 3: Create a workflow transition (simulates UI add)
    const addRes = await requestAgent()
      .post('/api/v1/global-settings/workflows')
      .send({ column_from: col1Id, column_to: col2Id });
    expect(addRes.status).toBe(201);
    expect(addRes.body).toHaveProperty('success', true);
    expect(addRes.body.data).toHaveProperty('id');
    const addedWf = addRes.body.data;

    // Step 4: Re-fetch workflows (simulates UI re-fetch after add)
    const afterList = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(afterList.status).toBe(200);
    expect(afterList.body).toHaveProperty('success', true);

    // Step 5: Verify the new workflow appears in the list
    const found = afterList.body.data.find(
      (w: any) => w.id === addedWf.id
    );
    expect(found).toBeDefined();
    expect(found.column_from).toBe(col1Id);
    expect(found.column_to).toBe(col2Id);
  });

  // =========================================================================
  // Test: Edit workflow → re-fetch → verify update
  // =========================================================================

  it('PATCH → GET: Full cycle for editing a workflow transition', async () => {
    // Create a workflow transition first
    const col1 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-e1', name: 'CrudE1', order: 200 });
    expect(col1.status).toBe(201);
    const col1Id = col1.body.data.id;

    const col2 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-e2', name: 'CrudE2', order: 201 });
    expect(col2.status).toBe(201);
    const col2Id = col2.body.data.id;

    const addRes = await requestAgent()
      .post('/api/v1/global-settings/workflows')
      .send({ column_from: col1Id, column_to: col2Id });
    expect(addRes.status).toBe(201);
    const wfId = addRes.body.data.id;

    // Get initial state
    const listBefore = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listBefore.status).toBe(200);
    const wfBefore = listBefore.body.data.find((w: any) => w.id === wfId);
    expect(wfBefore).toBeDefined();
    const originalRequiresComment = wfBefore.requires_comment;

    // Edit the workflow (simulates UI edit)
    const editRes = await requestAgent()
      .patch(`/api/v1/global-settings/workflows/${wfId}`)
      .send({ requires_comment: !originalRequiresComment });
    expect(editRes.status).toBe(200);
    expect(editRes.body).toHaveProperty('success', true);
    // Note: API returns { success: true } without full transition data
    // The re-fetch below verifies the update was applied

    // Re-fetch workflows (simulates UI re-fetch after edit)
    const listAfter = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listAfter.status).toBe(200);

    // Verify the update is reflected
    const wfAfter = listAfter.body.data.find((w: any) => w.id === wfId);
    expect(wfAfter).toBeDefined();
    // SQLite stores booleans as 1/0, so coerce to number for comparison
    expect(Number(wfAfter.requires_comment)).toBe(Number(!originalRequiresComment));
  });

  // =========================================================================
  // Test: Delete workflow → re-fetch → verify removal
  // =========================================================================

  it('DELETE → GET: Full cycle for deleting a workflow transition', async () => {
    // Create a workflow transition first
    const col1 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-d1', name: 'CrudD1', order: 300 });
    expect(col1.status).toBe(201);
    const col1Id = col1.body.data.id;

    const col2 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-d2', name: 'CrudD2', order: 301 });
    expect(col2.status).toBe(201);
    const col2Id = col2.body.data.id;

    const addRes = await requestAgent()
      .post('/api/v1/global-settings/workflows')
      .send({ column_from: col1Id, column_to: col2Id });
    expect(addRes.status).toBe(201);
    const wfId = addRes.body.data.id;

    // Verify workflow exists before delete
    const listBefore = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listBefore.status).toBe(200);
    const foundBefore = listBefore.body.data.find((w: any) => w.id === wfId);
    expect(foundBefore).toBeDefined();

    // Delete the workflow (simulates UI delete)
    const delRes = await requestAgent()
      .delete(`/api/v1/global-settings/workflows/${wfId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toHaveProperty('success', true);
    expect(delRes.body.data).toHaveProperty('id', wfId);
    // Note: SQLite stores booleans as 1/0, not true/false

    // Re-fetch workflows (simulates UI re-fetch after delete)
    const listAfter = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listAfter.status).toBe(200);

    // Verify the workflow no longer appears in list
    const foundAfter = listAfter.body.data.find((w: any) => w.id === wfId);
    expect(foundAfter).toBeUndefined();
  });

  // =========================================================================
  // Test: Multiple sequential operations
  // =========================================================================

  it('Sequential add → edit → delete cycle with re-fetch after each', async () => {
    const col1 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-s1', name: 'CrudS1', order: 400 });
    expect(col1.status).toBe(201);
    const col1Id = col1.body.data.id;

    const col2 = await requestAgent()
      .post('/api/v1/global-settings/columns')
      .send({ slug: 'col-crud-s2', name: 'CrudS2', order: 401 });
    expect(col2.status).toBe(201);
    const col2Id = col2.body.data.id;

    // Add
    const addRes = await requestAgent()
      .post('/api/v1/global-settings/workflows')
      .send({ column_from: col1Id, column_to: col2Id });
    expect(addRes.status).toBe(201);
    const wfId = addRes.body.data.id;

    let listRes = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listRes.body.data.find((w: any) => w.id === wfId)).toBeDefined();

    // Edit
    const editRes = await requestAgent()
      .patch(`/api/v1/global-settings/workflows/${wfId}`)
      .send({ requires_comment: true });
    expect(editRes.status).toBe(200);

    listRes = await requestAgent().get('/api/v1/global-settings/workflows');
    const wfAfterEdit = listRes.body.data.find((w: any) => w.id === wfId);
    // SQLite stores booleans as 1/0
    expect(Number(wfAfterEdit?.requires_comment)).toBe(1);

    // Delete
    const delRes = await requestAgent()
      .delete(`/api/v1/global-settings/workflows/${wfId}`);
    expect(delRes.status).toBe(200);

    listRes = await requestAgent().get('/api/v1/global-settings/workflows');
    expect(listRes.body.data.find((w: any) => w.id === wfId)).toBeUndefined();
  });
});
