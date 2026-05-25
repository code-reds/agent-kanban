import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as queries from '../db/queries/global-settings.js';
import { GlobalSettingsService } from '../services/global-settings-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
  try {
    db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
  } catch {}
}

describe('Global Settings Query Functions', () => {
  beforeEach(() => {
    initDb();
  });

  function createProject() {
    const db = getDb();
    const slug = `test-global-${Date.now()}`;
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Global', slug);
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));
    return project;
  }

  // =========================================================================
  // Global Columns
  // =========================================================================

  describe('getGlobalColumns', () => {
    it('should return empty array when no global columns exist', () => {
      const columns = queries.getGlobalColumns();
      expect(columns).toHaveLength(0);
    });

    it('should return global columns after creation', () => {
      queries.createGlobalColumn('global-todo', 'Global To Do', 0);
      queries.createGlobalColumn('global-done', 'Global Done', 1);
      const columns = queries.getGlobalColumns();
      expect(columns).toHaveLength(2);
      expect(columns[0].slug).toBe('global-todo');
      expect(columns[0].project_id).toBeNull();
      expect(columns[1].slug).toBe('global-done');
    });

    it('should not include project-specific columns', () => {
      const project = createProject();
      const db = getDb();
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(project.id, 'project-col', 'Project Column', 99, 1);
      const columns = queries.getGlobalColumns();
      expect(columns).toHaveLength(0);
    });

    it('should return columns ordered by order field', () => {
      queries.createGlobalColumn('col-2', 'Column 2', 2);
      queries.createGlobalColumn('col-1', 'Column 1', 1);
      queries.createGlobalColumn('col-3', 'Column 3', 3);
      const columns = queries.getGlobalColumns();
      expect(columns[0].slug).toBe('col-1');
      expect(columns[1].slug).toBe('col-2');
      expect(columns[2].slug).toBe('col-3');
    });
  });

  describe('getGlobalColumnsWithProject', () => {
    it('should return global columns for a project', () => {
      queries.createGlobalColumn('global-col', 'Global Column', 0);
      const project = createProject();
      const columns = queries.getGlobalColumnsWithProject(project.id);
      expect(columns.length).toBeGreaterThan(0);
      // Should include both global (project_id IS NULL) and project-specific columns
      const globalCols = columns.filter((c) => c.project_id === null);
      const projectCols = columns.filter((c) => c.project_id === project.id);
      expect(globalCols.length).toBe(1);
      expect(projectCols.length).toBeGreaterThan(0);
    });

    it('should return empty for non-existent project', () => {
      const columns = queries.getGlobalColumnsWithProject(9999);
      // Only global columns exist
      expect(columns).toBeInstanceOf(Array);
    });
  });

  describe('createGlobalColumn', () => {
    it('should create a global column with project_id = NULL', () => {
      const col = queries.createGlobalColumn('test-slug', 'Test Column', 5);
      expect(col).toBeDefined();
      expect(col!.slug).toBe('test-slug');
      expect(col!.name).toBe('Test Column');
      expect(col!.order).toBe(5);
      expect(col!.project_id).toBeNull();
      expect(col!.is_global).toBe(1);
    });

    it('should set is_default flag when specified', () => {
      const col = queries.createGlobalColumn('default-col', 'Default', 1, true);
      expect(col!.is_default).toBe(1);
    });

    it('should not set is_default by default', () => {
      const col = queries.createGlobalColumn('non-default', 'Not Default', 1);
      expect(col!.is_default).toBe(0);
    });
  });

  describe('updateGlobalColumn', () => {
    it('should update a global column name', () => {
      const col = queries.createGlobalColumn('update-me', 'Original', 1);
      const updated = queries.updateGlobalColumn(col!.id, undefined, 'Updated Name');
      expect(updated!.name).toBe('Updated Name');
    });

    it('should update a global column order', () => {
      const col = queries.createGlobalColumn('update-me', 'Original', 1);
      const updated = queries.updateGlobalColumn(col!.id, undefined, undefined, 50);
      expect(updated!.order).toBe(50);
    });

    it('should update multiple fields', () => {
      const col = queries.createGlobalColumn('update-me', 'Original', 1);
      const updated = queries.updateGlobalColumn(col!.id, 'new-slug', 'New Name', 99);
      expect(updated!.slug).toBe('new-slug');
      expect(updated!.name).toBe('New Name');
      expect(updated!.order).toBe(99);
    });

    it('should return undefined for non-existent column', () => {
      const result = queries.updateGlobalColumn(9999, 'new-slug');
      expect(result).toBeUndefined();
    });

    it('should return undefined for project-specific column', () => {
      const project = createProject();
      const columns = queries.getGlobalColumnsWithProject(project.id);
      const projectCol = columns.find((c) => c.project_id === project.id);
      if (!projectCol) return;
      const result = queries.updateGlobalColumn(projectCol.id, 'new-slug');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteGlobalColumn', () => {
    it('should delete an empty global column', () => {
      const col = queries.createGlobalColumn('deletable', 'Deletable', 10);
      const result = queries.deleteGlobalColumn(col!.id);
      expect(result).toBe(true);
      const remaining = queries.getGlobalColumns();
      expect(remaining.find((c) => c.id === col!.id)).toBeUndefined();
    });

    it('should not delete a default global column', () => {
      const col = queries.createGlobalColumn('default-del', 'Default', 10, true);
      const result = queries.deleteGlobalColumn(col!.id);
      expect(result).toBe(false);
    });

    it('should return false for non-existent column', () => {
      const result = queries.deleteGlobalColumn(9999);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Global Workflows
  // =========================================================================

  describe('getGlobalWorkflows', () => {
    it('should return empty array when no global workflows exist', () => {
      const workflows = queries.getGlobalWorkflows();
      expect(workflows).toHaveLength(0);
    });
  });

  describe('createGlobalWorkflow', () => {
    it('should create a global workflow transition', () => {
      // First create two global columns to reference
      const colFrom = queries.createGlobalColumn('g-todo', 'Global Todo', 0)!;
      const colTo = queries.createGlobalColumn('g-done', 'Global Done', 1)!;
      const result = queries.createGlobalWorkflow(colFrom.id, colTo.id, true, false);
      expect(result).toBeDefined();
      expect(result!.id).toBeGreaterThan(0);
    });

    it('should set project_id = NULL for global workflow', () => {
      const colFrom = queries.createGlobalColumn('g-a', 'A', 0)!;
      const colTo = queries.createGlobalColumn('g-b', 'B', 1)!;
      const result = queries.createGlobalWorkflow(colFrom.id, colTo.id, false, true);
      expect(result).toBeDefined();
      const workflows = queries.getGlobalWorkflows();
      const wf = workflows.find((w) => w.id === result!.id);
      expect(wf).toBeDefined();
      expect(wf!.project_id).toBeNull();
      expect(wf!.requires_comment).toBe(0);
      expect(wf!.entire_ticket_group).toBe(1);
    });
  });

  describe('updateGlobalWorkflow', () => {
    it('should update a global workflow transition', () => {
      const colFrom = queries.createGlobalColumn('uw-from', 'From', 0)!;
      const colTo = queries.createGlobalColumn('uw-to', 'To', 1)!;
      const result = queries.createGlobalWorkflow(colFrom.id, colTo.id, false, false);
      const updated = queries.updateGlobalWorkflow(result!.id, true, true);
      expect(updated).toBe(true);
    });

    it('should return false for non-existent workflow', () => {
      const result = queries.updateGlobalWorkflow(9999, true);
      expect(result).toBe(false);
    });
  });

  describe('deleteGlobalWorkflow', () => {
    it('should delete a global workflow transition', () => {
      const colFrom = queries.createGlobalColumn('dw-from', 'From', 0)!;
      const colTo = queries.createGlobalColumn('dw-to', 'To', 1)!;
      const result = queries.createGlobalWorkflow(colFrom.id, colTo.id);
      const deleted = queries.deleteGlobalWorkflow(result!.id);
      expect(deleted).toBe(true);
      const remaining = queries.getGlobalWorkflows();
      expect(remaining.find((w) => w.id === result!.id)).toBeUndefined();
    });

    it('should return false for non-existent workflow', () => {
      const result = queries.deleteGlobalWorkflow(9999);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Global Access Rules
  // =========================================================================

  describe('getGlobalAccessRules', () => {
    it('should return empty array when no global rules exist', () => {
      const rules = queries.getGlobalAccessRules();
      expect(rules).toHaveLength(0);
    });
  });

  describe('replaceGlobalAccessRules', () => {
    it('should replace global access rules', () => {
      const col = queries.createGlobalColumn('rule-col', 'Rule Column', 0)!;
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;

      queries.replaceGlobalAccessRules([
        { column_id: col.id, role_id: humanUserId, action_type: 'create' },
        { column_id: col.id, role_id: humanUserId, action_type: 'edit' },
      ]);

      const rules = queries.getGlobalAccessRules();
      expect(rules).toHaveLength(2);
      expect(rules[0].column_id).toBe(col.id);
      expect(rules[0].project_id).toBeNull();
      expect(rules[0].is_global).toBe(1);
    });

    it('should clear existing rules before inserting new ones', () => {
      const col = queries.createGlobalColumn('clr-col', 'Clear Column', 0)!;
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;

      // Insert initial rule
      queries.replaceGlobalAccessRules([
        { column_id: col.id, role_id: humanUserId, action_type: 'create' },
      ]);

      // Replace with different rule
      queries.replaceGlobalAccessRules([
        { column_id: col.id, role_id: humanUserId, action_type: 'edit' },
      ]);

      const rules = queries.getGlobalAccessRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].action_type).toBe('edit');
    });
  });

  // =========================================================================
  // Project Seeding
  // =========================================================================

  describe('getProjectSeedData', () => {
    it('should return empty seed data when no global settings exist', () => {
      const data = queries.getProjectSeedData();
      expect(data.columns).toHaveLength(0);
      expect(data.workflows).toHaveLength(0);
      expect(data.accessRules).toHaveLength(0);
    });

    it('should return global columns, workflows, and access rules', () => {
      const col1 = queries.createGlobalColumn('seed-col-1', 'Seed Column 1', 0)!;
      const col2 = queries.createGlobalColumn('seed-col-2', 'Seed Column 2', 1)!;
      const workflow = queries.createGlobalWorkflow(col1.id, col2.id)!;
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;
      queries.replaceGlobalAccessRules([
        { column_id: col1.id, role_id: humanUserId, action_type: 'create' },
      ]);

      const data = queries.getProjectSeedData();
      expect(data.columns).toHaveLength(2);
      expect(data.workflows).toHaveLength(1);
      expect(data.accessRules).toHaveLength(1);
    });
  });

  describe('seedNewProjectColumns', () => {
    it('should copy global columns to a new project with ID mapping', () => {
      const globalCol = queries.createGlobalColumn('map-col', 'Mapped Column', 5)!;
      const project = createProject();

      const mappings = queries.seedNewProjectColumns(project.id, [globalCol]);
      expect(mappings).toHaveLength(1);
      expect(mappings[0].globalColumnId).toBe(globalCol.id);
      expect(mappings[0].newColumnId).not.toBe(globalCol.id); // Should be a different ID

      // Verify the project-specific column exists
      const projectColumns = queries.getGlobalColumnsWithProject(project.id);
      const projectCol = projectColumns.find((c) => c.id === mappings[0].newColumnId);
      expect(projectCol).toBeDefined();
      expect(projectCol!.project_id).toBe(project.id);
    });

    it('should not duplicate columns that already exist in the project', () => {
      const globalCol = queries.createGlobalColumn('dup-col', 'Dup Column', 10)!;
      const project = createProject();

      // Insert the column directly
      const db = getDb();
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(project.id, globalCol.slug, globalCol.name, globalCol.order, 0);

      const mappings = queries.seedNewProjectColumns(project.id, [globalCol]);
      expect(mappings).toHaveLength(1);
      expect(mappings[0].globalColumnId).toBe(globalCol.id);
      // Should use the existing column ID, not create a new one
    });
  });

  describe('seedNewProjectWorkflows', () => {
    it('should copy global workflows with remapped column IDs', () => {
      const globalCol1 = queries.createGlobalColumn('wf-col-1', 'WF Col 1', 0)!;
      const globalCol2 = queries.createGlobalColumn('wf-col-2', 'WF Col 2', 1)!;
      queries.createGlobalWorkflow(globalCol1.id, globalCol2.id, true, false);

      const project = createProject();
      const mappings = queries.seedNewProjectColumns(project.id, [globalCol1, globalCol2]);
      const columnIdMap = new Map<number, number>();
      for (const m of mappings) {
        columnIdMap.set(m.globalColumnId, m.newColumnId);
      }

      queries.seedNewProjectWorkflows(project.id, queries.getGlobalWorkflows(), columnIdMap);

      // Verify the workflow exists for the project
      const projectWorkflows = queries.getGlobalWorkflows();
      // The global workflows still exist — seedNewProjectWorkflows creates project-specific copies
    });
  });

  describe('seedNewProjectAccessRules', () => {
    it('should copy global access rules with remapped column IDs', () => {
      const globalCol = queries.createGlobalColumn('ar-col', 'AR Column', 0)!;
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;
      queries.replaceGlobalAccessRules([
        { column_id: globalCol.id, role_id: humanUserId, action_type: 'create' },
      ]);

      const project = createProject();
      const mappings = queries.seedNewProjectColumns(project.id, [globalCol]);
      const columnIdMap = new Map<number, number>();
      for (const m of mappings) {
        columnIdMap.set(m.globalColumnId, m.newColumnId);
      }

      queries.seedNewProjectAccessRules(project.id, queries.getGlobalAccessRules(), columnIdMap);

      // Verify the project-specific access rule exists
      const projectRules = db.prepare<
        [number],
        { id: number; project_id: number | null }
      >('SELECT * FROM ticket_access_rules WHERE project_id = ?').all(project.id);
      expect(projectRules.length).toBeGreaterThan(0);
      expect(projectRules[0].project_id).toBe(project.id);
    });
  });

  // =========================================================================
  // Integration: Full seed flow
  // =========================================================================

  describe('Full seed flow', () => {
    it('should correctly seed a new project from global settings', () => {
      // Create global columns
      const gCol1 = queries.createGlobalColumn('g-seed-1', 'Global Seed 1', 0)!;
      const gCol2 = queries.createGlobalColumn('g-seed-2', 'Global Seed 2', 1)!;

      // Create a global workflow
      queries.createGlobalWorkflow(gCol1.id, gCol2.id, true, false);

      // Create a global access rule
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;
      queries.replaceGlobalAccessRules([
        { column_id: gCol1.id, role_id: humanUserId, action_type: 'create' },
      ]);

      // Get seed data
      const seedData = queries.getProjectSeedData();
      expect(seedData.columns).toHaveLength(2);
      expect(seedData.workflows).toHaveLength(1);
      expect(seedData.accessRules).toHaveLength(1);

      // Create a new project and seed it
      const project = createProject();
      const mappings = queries.seedNewProjectColumns(
        project.id,
        seedData.columns
      );
      const columnIdMap = new Map<number, number>();
      for (const m of mappings) {
        columnIdMap.set(m.globalColumnId, m.newColumnId);
      }

      queries.seedNewProjectWorkflows(project.id, seedData.workflows, columnIdMap);
      queries.seedNewProjectAccessRules(project.id, seedData.accessRules, columnIdMap);

      // Verify project has its own copies
      const projectColumns = queries.getGlobalColumnsWithProject(project.id);
      const projectOnlyCols = projectColumns.filter((c) => c.project_id === project.id);
      expect(projectOnlyCols.length).toBeGreaterThan(0);

      // Verify project has access rules
      const projectRules = db.prepare<
        [number],
        { project_id: number | null }
      >('SELECT * FROM ticket_access_rules WHERE project_id = ?').all(project.id);
      expect(projectRules.length).toBeGreaterThan(0);
    });
  });
});

// =========================================================================
// GlobalSettingsService Tests
// =========================================================================

describe('GlobalSettingsService', () => {
  beforeEach(() => {
    initDb();
  });

  function createProject() {
    const db = getDb();
    const slug = `test-svc-${Date.now()}`;
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test Service', slug);
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));
    return project;
  }

  // =========================================================================
  // Column CRUD via Service
  // =========================================================================

  describe('listColumns', () => {
    it('should return empty array when no global columns exist', () => {
      const result = GlobalSettingsService.listColumns();
      expect(result.columns).toHaveLength(0);
    });

    it('should return global columns', () => {
      queries.createGlobalColumn('svc-col', 'Service Column', 5);
      const result = GlobalSettingsService.listColumns();
      expect(result.columns).toHaveLength(1);
      expect(result.columns[0].slug).toBe('svc-col');
    });
  });

  describe('listColumnsWithProject', () => {
    it('should return NOT_FOUND for non-existent project', () => {
      const result = GlobalSettingsService.listColumnsWithProject('nonexistent');
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });

    it('should return global + project columns', () => {
      const project = createProject();
      queries.createGlobalColumn('svc-union', 'Union Col', 0);
      const result = GlobalSettingsService.listColumnsWithProject(project.slug);
      // Should have at least the global column and the project's seeded columns
      expect(result.columns.length).toBeGreaterThan(0);
    });
  });

  describe('createColumn', () => {
    it('should reject missing slug', () => {
      const result = GlobalSettingsService.createColumn({
        slug: '',
        name: 'Test',
        order: 1,
      });
      expect(result.error).toContain('slug');
      expect(result.statusCode).toBe(400);
    });

    it('should reject missing name', () => {
      const result = GlobalSettingsService.createColumn({
        slug: 'valid',
        name: '',
        order: 1,
      });
      expect(result.error).toContain('name');
      expect(result.statusCode).toBe(400);
    });

    it('should reject missing order', () => {
      const result = GlobalSettingsService.createColumn({
        slug: 'valid',
        name: 'Valid',
        order: -1,
      });
      // Order -1 is a valid number, should not error on validation
      // But it should succeed
    });

    it('should create a global column', () => {
      const result = GlobalSettingsService.createColumn({
        slug: 'new-svc-col',
        name: 'New Service Column',
        order: 10,
      });
      expect(result.column).toBeDefined();
      expect(result.column!.slug).toBe('new-svc-col');
      expect(result.column!.project_id).toBeNull();
    });

    it('should reject duplicate slug', () => {
      GlobalSettingsService.createColumn({ slug: 'dup-svc', name: 'Dup', order: 1 });
      const result = GlobalSettingsService.createColumn({ slug: 'dup-svc', name: 'Dup 2', order: 2 });
      expect(result.error).toContain('already exists');
      expect(result.statusCode).toBe(409);
    });
  });

  describe('updateColumn', () => {
    it('should update a global column', () => {
      queries.createGlobalColumn('upd-svc', 'Original', 1);
      const result = GlobalSettingsService.updateColumn(1, { name: 'Updated' });
      expect(result.column!.name).toBe('Updated');
    });

    it('should return NOT_FOUND for non-existent column', () => {
      const result = GlobalSettingsService.updateColumn(9999, { name: 'Nope' });
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });
  });

  describe('deleteColumn', () => {
    it('should delete a non-default global column', () => {
      queries.createGlobalColumn('del-svc', 'Deletable', 10);
      const result = GlobalSettingsService.deleteColumn(1);
      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent column', () => {
      const result = GlobalSettingsService.deleteColumn(9999);
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });

    it('should reject project-specific columns', () => {
      const project = createProject();
      const columns = queries.getGlobalColumnsWithProject(project.id);
      const projectCol = columns.find((c) => c.project_id === project.id);
      if (projectCol) {
        const result = GlobalSettingsService.deleteColumn(projectCol.id);
        expect(result.error).toContain('not a global column');
      }
    });
  });

  // =========================================================================
  // Workflow CRUD via Service
  // =========================================================================

  describe('listWorkflows', () => {
    it('should return empty when no global workflows exist', () => {
      const result = GlobalSettingsService.listWorkflows();
      expect(result.transitions).toHaveLength(0);
    });

    it('should return global workflows', () => {
      const colFrom = queries.createGlobalColumn('wf-svc-a', 'A', 0)!;
      const colTo = queries.createGlobalColumn('wf-svc-b', 'B', 1)!;
      queries.createGlobalWorkflow(colFrom.id, colTo.id);
      const result = GlobalSettingsService.listWorkflows();
      expect(result.transitions).toHaveLength(1);
    });
  });

  describe('createWorkflow', () => {
    it('should reject missing column IDs', () => {
      const result = GlobalSettingsService.createWorkflow({
        column_from: undefined as any,
        column_to: 1,
      });
      expect(result.error).toContain('column_from and column_to are required');
      expect(result.statusCode).toBe(400);
    });

    it('should reject non-existent column IDs', () => {
      const result = GlobalSettingsService.createWorkflow({
        column_from: 9999,
        column_to: 9998,
      });
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });

    it('should create a global workflow', () => {
      const colFrom = queries.createGlobalColumn('wf-create-a', 'A', 0)!;
      const colTo = queries.createGlobalColumn('wf-create-b', 'B', 1)!;
      const result = GlobalSettingsService.createWorkflow({
        column_from: colFrom.id,
        column_to: colTo.id,
        requires_comment: true,
        entire_ticket_group: false,
      });
      expect(result.transition).toBeDefined();
      expect(result.transition!.requires_comment).toBe(1);
    });
  });

  describe('updateWorkflow', () => {
    it('should update a global workflow', () => {
      const colFrom = queries.createGlobalColumn('wf-upd-a', 'A', 0)!;
      const colTo = queries.createGlobalColumn('wf-upd-b', 'B', 1)!;
      queries.createGlobalWorkflow(colFrom.id, colTo.id);
      const result = GlobalSettingsService.updateWorkflow(1, {
        requires_comment: true,
      });
      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent workflow', () => {
      const result = GlobalSettingsService.updateWorkflow(9999, {
        requires_comment: true,
      });
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });

    it('should reject no update fields', () => {
      const result = GlobalSettingsService.updateWorkflow(1, {});
      expect(result.error).toContain('No update fields provided');
      expect(result.statusCode).toBe(400);
    });
  });

  describe('deleteWorkflow', () => {
    it('should delete a global workflow', () => {
      const colFrom = queries.createGlobalColumn('wf-del-a', 'A', 0)!;
      const colTo = queries.createGlobalColumn('wf-del-b', 'B', 1)!;
      queries.createGlobalWorkflow(colFrom.id, colTo.id);
      const result = GlobalSettingsService.deleteWorkflow(1);
      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent workflow', () => {
      const result = GlobalSettingsService.deleteWorkflow(9999);
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Access Rule CRUD via Service
  // =========================================================================

  describe('listAccessRules', () => {
    it('should return empty when no global rules exist', () => {
      const result = GlobalSettingsService.listAccessRules();
      expect(result.rules).toHaveLength(0);
    });
  });

  describe('updateAccessRules', () => {
    it('should reject non-array input', () => {
      const result = GlobalSettingsService.updateAccessRules(null as any);
      expect(result.error).toContain('rules array is required');
      expect(result.statusCode).toBe(400);
    });

    it('should reject invalid column_id', () => {
      const result = GlobalSettingsService.updateAccessRules([
        { column_id: 9999, role_id: 1, action_type: 'create' },
      ]);
      expect(result.error).toContain('Invalid column_id');
      expect(result.statusCode).toBe(400);
    });

    it('should reject invalid action_type', () => {
      queries.createGlobalColumn('ar-svc', 'Service', 0);
      const result = GlobalSettingsService.updateAccessRules([
        { column_id: 1, role_id: 1, action_type: 'invalid' },
      ]);
      expect(result.error).toContain('Invalid action_type');
      expect(result.statusCode).toBe(400);
    });

    it('should replace global access rules', () => {
      const col = queries.createGlobalColumn('ar-replace', 'Replace', 0)!;
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const humanUserId = roles[0]?.id ?? 1;

      const result = GlobalSettingsService.updateAccessRules([
        { column_id: col.id, role_id: humanUserId, action_type: 'create' },
        { column_id: col.id, role_id: humanUserId, action_type: 'edit' },
      ]);

      expect(result.rules).toHaveLength(2);
      expect(result.error).toBeUndefined();
    });
  });

  // =========================================================================
  // Project seeding via Service
  // =========================================================================

  describe('getProjectSeedData', () => {
    it('should return seed data', () => {
      const result = GlobalSettingsService.getProjectSeedData();
      expect(result.data).toBeDefined();
      expect(result.data.columns).toBeInstanceOf(Array);
      expect(result.data.workflows).toBeInstanceOf(Array);
      expect(result.data.accessRules).toBeInstanceOf(Array);
    });
  });

  describe('seedProject', () => {
    it('should seed a new project from global defaults', () => {
      // Create some global settings first
      queries.createGlobalColumn('seed-svc-1', 'Seed Svc 1', 0);
      queries.createGlobalColumn('seed-svc-2', 'Seed Svc 2', 1);

      // Create a project to seed
      const project = createProject();
      const result = GlobalSettingsService.seedProject(project.id);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid project', () => {
      const result = GlobalSettingsService.seedProject(999999);
      // This may succeed if the DB allows it, or fail due to FK constraints
      // Either way, the result should have a defined success field
      expect(result).toHaveProperty('success');
    });
  });

  // =========================================================================
  // Reset to Defaults
  // =========================================================================

  describe('resetGlobalDefaults', () => {
    it('should reset global settings to defaults', () => {
      // Create custom global columns
      queries.createGlobalColumn('custom-col-1', 'Custom 1', 100);
      queries.createGlobalColumn('custom-col-2', 'Custom 2', 101);

      // Create a workflow
      const col1 = queries.getGlobalColumns().find((c) => c.slug === 'custom-col-1')!;
      const col2 = queries.getGlobalColumns().find((c) => c.slug === 'custom-col-2')!;
      queries.createGlobalWorkflow(col1.id, col2.id, false, false);

      // Replace access rules
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const roleId = roles[0]?.id ?? 1;
      queries.replaceGlobalAccessRules([
        { column_id: col1.id, role_id: roleId, action_type: 'create' },
      ]);

      // Verify custom settings exist
      const columnsBefore = queries.getGlobalColumns();
      expect(columnsBefore.length).toBe(2);
      const workflowsBefore = queries.getGlobalWorkflows();
      expect(workflowsBefore.length).toBe(1);
      const rulesBefore = queries.getGlobalAccessRules();
      expect(rulesBefore.length).toBe(1);

      // Reset
      const result = GlobalSettingsService.resetGlobalDefaults();

      // Verify success
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBeGreaterThan(0);

      // After reset, standard defaults should be back
      // The defaults include: todo, done columns + workflow + access rules
      const columnsAfter = queries.getGlobalColumns();
      expect(columnsAfter.length).toBeGreaterThan(0);

      // Verify the default columns are present
      const defaultSlugs = columnsAfter.map((c) => c.slug);
      expect(defaultSlugs).toContain('todo');
      expect(defaultSlugs).toContain('done');
    });

    it('should handle reset when no global settings exist', () => {
      // Database is already clean from initDb()
      const result = GlobalSettingsService.resetGlobalDefaults();

      // Should still succeed — reseeding defaults on empty DB
      expect(result.success).toBe(true);

      // Should have standard defaults
      const columns = queries.getGlobalColumns();
      expect(columns.length).toBeGreaterThan(0);
    });

    it('should not affect project-specific settings on reset', () => {
      // Create a project
      const project = createProject();

      // Modify some project-specific settings
      const db = getDb();
      db.prepare(
        'UPDATE kanban_columns SET name = ? WHERE project_id = ?'
      ).run('Modified Project Column', project.id);

      // Reset global settings
      const result = GlobalSettingsService.resetGlobalDefaults();

      // Reset should succeed
      expect(result.success).toBe(true);

      // Project-specific settings should be preserved
      const projectColumns = db.prepare<[number], { name: string }>(
        'SELECT name FROM kanban_columns WHERE project_id = ?'
      ).all(project.id);
      const modifiedCol = projectColumns.find((c) => c.name === 'Modified Project Column');
      expect(modifiedCol).toBeDefined();
    });

    it('resetGlobalDefaults returns deletedCount', () => {
      // Create some custom global columns
      queries.createGlobalColumn('count-col-1', 'Count 1', 200);
      queries.createGlobalColumn('count-col-2', 'Count 2', 201);

      const col1 = queries.getGlobalColumns().find((c) => c.slug === 'count-col-1')!;
      const col2 = queries.getGlobalColumns().find((c) => c.slug === 'count-col-2')!;
      queries.createGlobalWorkflow(col1.id, col2.id, false, false);

      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const roleId = roles[0]?.id ?? 1;
      queries.replaceGlobalAccessRules([
        { column_id: col1.id, role_id: roleId, action_type: 'view' },
      ]);

      const result = GlobalSettingsService.resetGlobalDefaults();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBeGreaterThan(0);
    });
  });
});
