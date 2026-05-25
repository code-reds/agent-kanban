import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedGlobalDefaults, seedProjectRolesColumns, seedRolesColumns } from '../db/seed.js';
import { ProjectService } from '../services/project-service.js';
import { GlobalSettingsService } from '../services/global-settings-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

describe('Project Creation from Global Defaults', () => {
  beforeEach(() => {
    initDb();
  });

  afterEach(() => {
    resetDb();
    runMigrations();
    seedDefaultRoles();
  });

  // =========================================================================
  // seedGlobalDefaults tests
  // =========================================================================

  describe('seedGlobalDefaults', () => {
    it('should create 7 global columns with project_id = NULL', () => {
      seedGlobalDefaults();
      const db = getDb();
      const columns = db.prepare(
        'SELECT * FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
      ).all() as { slug: string; name: string; order: number; is_global: number }[];

      expect(columns.length).toBe(7);
      expect(columns[0].slug).toBe('todo');
      expect(columns[0].is_global).toBe(1);
      expect(columns[5].slug).toBe('done');
      expect(columns[6].slug).toBe('human_feedback');
    });

    it('should create global workflow transitions with project_id = NULL', () => {
      seedGlobalDefaults();
      const db = getDb();
      const transitions = db.prepare(
        'SELECT * FROM workflow_transitions WHERE project_id IS NULL'
      ).all() as { column_from: number; column_to: number }[];

      expect(transitions.length).toBe(19);
    });

    it('should create global access rules with project_id = NULL', () => {
      seedGlobalDefaults();
      const db = getDb();
      const rules = db.prepare(
        'SELECT COUNT(*) as total FROM ticket_access_rules WHERE project_id IS NULL'
      ).get() as { total: number };

      expect(rules.total).toBeGreaterThan(0);
    });

    it('should be idempotent — calling twice does not create duplicates', () => {
      seedGlobalDefaults();
      const db = getDb();

      const firstColumns = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      seedGlobalDefaults();

      const secondColumns = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      expect(secondColumns.total).toBe(firstColumns.total);
    });

    it('should create global columns with project_id IS NULL (not project-specific)', () => {
      seedGlobalDefaults();
      const db = getDb();

      const globalCount = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      const projectCount = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NOT NULL'
      ).get() as { total: number };

      expect(globalCount.total).toBe(7);
      expect(projectCount.total).toBe(0);
    });
  });

  // =========================================================================
  // Project creation with global defaults
  // =========================================================================

  describe('ProjectService.create() with global defaults', () => {
    it('should seed project columns from global defaults', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('Global Project', 'global-project');
      expect(result.project).toBeDefined();
      expect(result.project!.slug).toBe('global-project');

      const db = getDb();
      const columns = db.prepare(
        'SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(result.project!.id) as { slug: string; is_global: number }[];

      expect(columns.length).toBe(7);
      // Project-specific columns should have is_global = 0
      for (const col of columns) {
        expect(col.is_global).toBe(0);
      }
    });

    it('should seed project workflows from global defaults with remapped column IDs', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('Global Workflow Project', 'global-workflow');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectCols = db.prepare(
        'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(result.project!.id) as { id: number; slug: string }[];

      const projectColMap = new Map(projectCols.map((c) => [c.slug, c.id]));

      const transitions = db.prepare(
        'SELECT * FROM workflow_transitions WHERE project_id = ?'
      ).all(result.project!.id) as { column_from: number; column_to: number; is_global: number }[];

      expect(transitions.length).toBe(19);

      // All transitions should reference project-specific column IDs (not global IDs)
      for (const trans of transitions) {
        expect(trans.is_global).toBe(0);
        expect(projectColMap.has(Object.fromEntries(projectCols.map(c => [c.slug, c.id]))[trans.column_from] as any)).toBe(false);
        // Verify the from/to columns exist in the project
        const fromCol = projectCols.find((c) => c.id === trans.column_from);
        const toCol = projectCols.find((c) => c.id === trans.column_to);
        expect(fromCol).toBeDefined();
        expect(toCol).toBeDefined();
      }
    });

    it('should seed project access rules from global defaults with remapped column IDs', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('Global Access Project', 'global-access');
      expect(result.project).toBeDefined();

      const db = getDb();
      const rules = db.prepare(
        'SELECT * FROM ticket_access_rules WHERE project_id = ?'
      ).all(result.project!.id) as { column_id: number; is_global: number }[];

      expect(rules.length).toBeGreaterThan(0);

      // All rules should have is_global = 0
      for (const rule of rules) {
        expect(rule.is_global).toBe(0);
      }
    });

    it('should not have dangling column references after seeding', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('No Dangling', 'no-dangling');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result.project!.id) as { id: number }[];
      const projectColIds = new Set(projectCols.map((c) => c.id));

      // Check workflows don't reference global column IDs
      const workflows = db.prepare(
        'SELECT column_from, column_to FROM workflow_transitions WHERE project_id = ?'
      ).all(result.project!.id) as { column_from: number; column_to: number }[];

      for (const wf of workflows) {
        expect(projectColIds.has(wf.column_from)).toBe(true);
        expect(projectColIds.has(wf.column_to)).toBe(true);
      }

      // Check access rules don't reference global column IDs
      const accessRules = db.prepare(
        'SELECT column_id FROM ticket_access_rules WHERE project_id = ?'
      ).all(result.project!.id) as { column_id: number }[];

      for (const rule of accessRules) {
        expect(projectColIds.has(rule.column_id)).toBe(true);
      }
    });
  });

  // =========================================================================
  // Fallback: project creation without global defaults
  // =========================================================================

  describe('ProjectService.create() without global defaults (fallback)', () => {
    it('should create project with hardcoded defaults when no global settings exist', () => {
      // Do NOT call seedGlobalDefaults() — use the fresh DB from initDb
      const result = ProjectService.create('Fallback Project', 'fallback-project');
      expect(result.project).toBeDefined();

      const db = getDb();
      const columns = db.prepare(
        'SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(result.project!.id) as { slug: string }[];

      expect(columns.length).toBe(7);
      expect(columns.map((c) => c.slug)).toEqual([
        'todo', 'implementation', 'unit_review', 'integration_testing',
        'final_review', 'done', 'human_feedback',
      ]);
    });

    it('should still create workflow transitions in fallback mode', () => {
      const result = ProjectService.create('Fallback Workflow', 'fallback-wf');
      expect(result.project).toBeDefined();

      const db = getDb();
      const transitions = db.prepare(
        'SELECT COUNT(*) as total FROM workflow_transitions WHERE project_id = ?'
      ).get(result.project!.id) as { total: number };

      expect(transitions.total).toBe(19);
    });

    it('should not create global columns when using fallback seeding', () => {
      // Verify no global columns exist yet
      const db = getDb();
      const globalBefore = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      const result = ProjectService.create('Fallback No Global', 'fallback-noglobal');
      expect(result.project).toBeDefined();

      const globalAfter = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      // No global columns should have been created
      expect(globalAfter.total).toBe(globalBefore.total);
    });
  });

  // =========================================================================
  // Mixed mode: global defaults exist but project already has columns
  // =========================================================================

  describe('Seeding idempotency across projects', () => {
    it('should create independent project settings when global defaults exist', () => {
      seedGlobalDefaults();

      const result1 = ProjectService.create('Project A', 'proj-a');
      const result2 = ProjectService.create('Project B', 'proj-b');

      expect(result1.project).toBeDefined();
      expect(result2.project).toBeDefined();
      expect(result1.project!.id).not.toBe(result2.project!.id);

      const db = getDb();

      const colsA = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id = ?'
      ).get(result1.project!.id) as { total: number };

      const colsB = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id = ?'
      ).get(result2.project!.id) as { total: number };

      // Each project should have its own 7 columns
      expect(colsA.total).toBe(7);
      expect(colsB.total).toBe(7);

      // Project A columns should not share IDs with project B
      const colIdsA: { id: number }[] = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result1.project!.id) as { id: number }[];
      const colIdSetA = new Set(colIdsA.map((c: { id: number }) => c.id));

      const colIdsB: { id: number }[] = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result2.project!.id) as { id: number }[];

      for (const colB of colIdsB) {
        expect(colIdSetA.has(colB.id)).toBe(false);
      }
    });
  });

  // =========================================================================
  // Integration test: full create flow with global defaults
  // =========================================================================

  describe('Full integration: create project with global defaults', () => {
    it('should produce a fully functional project with correct workflow', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('Full Test Project', 'full-test');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectId = result.project!.id;

      // Verify columns
      const columns = db.prepare(
        'SELECT slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(projectId) as { slug: string }[];
      expect(columns.map((c) => c.slug)).toEqual([
        'todo', 'implementation', 'unit_review', 'integration_testing',
        'final_review', 'done', 'human_feedback',
      ]);

      // Verify workflows
      const transitions = db.prepare(
        'SELECT COUNT(*) as total FROM workflow_transitions WHERE project_id = ?'
      ).get(projectId) as { total: number };
      expect(transitions.total).toBe(19);

      // Verify access rules
      const rules = db.prepare(
        'SELECT COUNT(*) as total FROM ticket_access_rules WHERE project_id = ?'
      ).get(projectId) as { total: number };
      expect(rules.total).toBeGreaterThan(0);

      // Verify global columns are separate
      const globalColumns = db.prepare(
        'SELECT COUNT(*) as total FROM kanban_columns WHERE project_id IS NULL'
      ).get() as { total: number };
      expect(globalColumns.total).toBe(7);
    });
  });

  // =========================================================================
  // Roles_Columns Seeding
  // =========================================================================

  describe('seedRolesColumns', () => {
    it('should create 7 global roles_columns entries', () => {
      // Ensure global columns exist
      const db = getDb();
      seedGlobalDefaults();

      const count = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
      ).get() as { total: number };
      expect(count.total).toBe(7);
    });

    it('should be idempotent — calling twice does not create duplicates', () => {
      const db = getDb();
      seedGlobalDefaults();

      const first = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      seedRolesColumns();

      const second = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
      ).get() as { total: number };

      expect(first.total).toBe(second.total);
      expect(first.total).toBe(7);
    });

    it('should map roles to their default columns', () => {
      seedGlobalDefaults();

      const db = getDb();
      // Get global roles_columns
      const mappings = db.prepare(
        'SELECT rc.role_id, r.name as role_name, rc.column_id, rc.is_default ' +
        'FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id IS NULL ' +
        'ORDER BY rc.role_id'
      ).all() as { role_id: number; role_name: string; column_id: number | null; is_default: number }[];

      expect(mappings.length).toBe(7);

      // Human User: NULL column_id (unrestricted)
      const humanUser = mappings.find((m) => m.role_name === 'Human User');
      expect(humanUser).toBeDefined();
      expect(humanUser!.column_id).toBeNull();

      // AI architect: todo column
      const architect = mappings.find((m) => m.role_name === 'AI architect');
      expect(architect).toBeDefined();
      expect(architect!.column_id).not.toBeNull();
      expect(architect!.is_default).toBe(1);

      // AI code developer: implementation column
      const developer = mappings.find((m) => m.role_name === 'AI code developer');
      expect(developer).toBeDefined();
      expect(developer!.column_id).not.toBeNull();
    });
  });

  describe('seedProjectRolesColumns', () => {
    it('should copy global roles_columns to a project with remapped column IDs', () => {
      seedGlobalDefaults();

      const db = getDb();
      const result = ProjectService.create('RC Project', 'rc-project');
      expect(result.project).toBeDefined();

      // seedProjectColumns already creates role-column mappings via insertRoleColumnMappings.
      // Clear them to test seedProjectRolesColumns independently.
      db.prepare('DELETE FROM roles_columns WHERE project_id = ?').run(result.project!.id);

      // Build global column ID → project column ID mapping
      const globalCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL'
      ).all() as { id: number }[];
      const projectCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result.project!.id) as { id: number }[];

      const globalToProjectMap = new Map<number, number>();
      for (let i = 0; i < globalCols.length; i++) {
        globalToProjectMap.set(globalCols[i].id, projectCols[i].id);
      }

      // Seed project roles_columns from global defaults
      const count = seedProjectRolesColumns(result.project!.id, globalToProjectMap);
      expect(count).toBe(7);

      // Verify project has roles_columns entries
      const projectRc = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
      ).get(result.project!.id) as { total: number };
      expect(projectRc.total).toBe(7);
    });

    it('should remap column IDs from global to project scope', () => {
      seedGlobalDefaults();

      const db = getDb();
      const result = ProjectService.create('RC Remap', 'rc-remap');
      expect(result.project).toBeDefined();

      // Get global architect column
      const globalArchitect = db.prepare(
        'SELECT rc.role_id, rc.column_id FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id IS NULL AND r.name = ?'
      ).get('AI architect') as { role_id: number; column_id: number | null };

      expect(globalArchitect.column_id).not.toBeNull();

      // Build column ID mapping
      const globalCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL'
      ).all() as { id: number }[];
      const projectCols = db.prepare(
        'SELECT id, slug FROM kanban_columns WHERE project_id = ?'
      ).all(result.project!.id) as { id: number; slug: string }[];

      // Find the 'todo' column in the project (architect's default)
      const projectTodo = projectCols.find((c) => c.slug === 'todo');
      expect(projectTodo).toBeDefined();

      // Build the mapping
      const globalToProjectMap = new Map<number, number>();
      for (let i = 0; i < globalCols.length; i++) {
        globalToProjectMap.set(globalCols[i].id, projectCols[i].id);
      }

      // Seed roles_columns
      seedProjectRolesColumns(result.project!.id, globalToProjectMap);

      // Verify the project architect role has the project's todo column (not the global one)
      const projectArchitect = db.prepare(
        'SELECT rc.column_id FROM roles_columns rc ' +
        'WHERE rc.project_id = ? AND rc.role_id = ?'
      ).get(result.project!.id, globalArchitect.role_id) as { column_id: number | null };

      expect(projectArchitect.column_id).toBe(projectTodo!.id);
      expect(projectArchitect.column_id).not.toBe(globalArchitect.column_id);
    });

    it('should not overwrite existing project roles_columns (idempotent)', () => {
      seedGlobalDefaults();

      const db = getDb();
      const result = ProjectService.create('RC Idempotent', 'rc-idempotent');
      expect(result.project).toBeDefined();

      // seedProjectColumns already creates role-column mappings.
      // Clear them to test seedProjectRolesColumns independently.
      db.prepare('DELETE FROM roles_columns WHERE project_id = ?').run(result.project!.id);

      // Build column mapping
      const globalCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL'
      ).all() as { id: number }[];
      const projectCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result.project!.id) as { id: number }[];
      const globalToProjectMap = new Map<number, number>();
      for (let i = 0; i < globalCols.length; i++) {
        globalToProjectMap.set(globalCols[i].id, projectCols[i].id);
      }

      // Seed once
      const count1 = seedProjectRolesColumns(result.project!.id, globalToProjectMap);
      expect(count1).toBe(7);

      // Seed again — should not create duplicates
      const count2 = seedProjectRolesColumns(result.project!.id, globalToProjectMap);
      expect(count2).toBe(0);

      // Verify still exactly 7
      const total = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
      ).get(result.project!.id) as { total: number };
      expect(total.total).toBe(7);
    });

    it('should preserve NULL column_id for unrestricted roles', () => {
      seedGlobalDefaults();

      const db = getDb();
      const result = ProjectService.create('RC Null', 'rc-null');
      expect(result.project).toBeDefined();

      // Build column mapping
      const globalCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id IS NULL'
      ).all() as { id: number }[];
      const projectCols = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ?'
      ).all(result.project!.id) as { id: number }[];
      const globalToProjectMap = new Map<number, number>();
      for (let i = 0; i < globalCols.length; i++) {
        globalToProjectMap.set(globalCols[i].id, projectCols[i].id);
      }

      seedProjectRolesColumns(result.project!.id, globalToProjectMap);

      // Human User should have NULL column_id (unrestricted)
      const humanUser = db.prepare(
        'SELECT rc.column_id FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id = ? AND r.name = ?'
      ).get(result.project!.id, 'Human User') as { column_id: number | null };

      expect(humanUser.column_id).toBeNull();
    });
  });

  describe('Project creation includes roles_columns from global defaults', () => {
    it('should have project-level roles_columns after ProjectService.create() with global defaults', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('RC Project', 'rc-project');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectRc = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
      ).get(result.project!.id) as { total: number };
      expect(projectRc.total).toBe(7);
    });

    it('should map global roles_columns column IDs to project column IDs', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('RC Mapped', 'rc-mapped');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectId = result.project!.id;

      // Get project columns
      const projectCols = db.prepare(
        'SELECT id, slug FROM kanban_columns WHERE project_id = ?'
      ).all(projectId) as { id: number; slug: string }[];
      const projectColMap = new Map(projectCols.map((c) => [c.slug, c.id]));

      // Verify AI architect maps to project's todo column
      const architectEntry = db.prepare(
        'SELECT rc.column_id FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id = ? AND r.name = ?'
      ).get(projectId, 'AI architect') as { column_id: number | null };

      expect(architectEntry.column_id).toBe(projectColMap.get('todo'));
    });

    it('should have roles_columns from seedProjectColumns even without global defaults (fallback)', () => {
      // Do NOT call seedGlobalDefaults() — just initDb which only seeds roles
      // ProjectService.create() in fallback mode calls seedProjectColumns,
      // which calls insertRoleColumnMappings and creates 7 role-column mappings
      const result = ProjectService.create('RC No Global', 'rc-no-global');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectRc = db.prepare(
        'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
      ).get(result.project!.id) as { total: number };
      // seedProjectColumns creates role-column mappings regardless of global defaults
      expect(projectRc.total).toBe(7);
    });
  });

  describe('Roles_Columns: project override vs global default', () => {
    it('should allow project-level override of global roles_columns', () => {
      seedGlobalDefaults();

      const result = ProjectService.create('RC Override', 'rc-override');
      expect(result.project).toBeDefined();

      const db = getDb();
      const projectId = result.project!.id;

      // Get project columns
      const projectCols = db.prepare(
        'SELECT id, slug FROM kanban_columns WHERE project_id = ?'
      ).all(projectId) as { id: number; slug: string }[];

      // Get global architect mapping
      const globalArchitect = db.prepare(
        'SELECT rc.column_id FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id IS NULL AND r.name = ?'
      ).get('AI architect') as { column_id: number | null };

      // Override: set AI architect to "done" instead of "todo"
      const doneColId = projectCols.find((c) => c.slug === 'done')!.id;
      db.prepare(
        'INSERT INTO roles_columns (project_id, role_id, column_id, is_default) ' +
        'VALUES (?, (SELECT id FROM roles WHERE name = ?), ?, 0) ' +
        'ON CONFLICT(role_id, project_id) DO UPDATE SET column_id = ?, is_default = 0'
      ).run(projectId, 'AI architect', doneColId, doneColId);

      // Verify the override
      const overrideEntry = db.prepare(
        'SELECT rc.column_id, rc.is_default FROM roles_columns rc ' +
        'JOIN roles r ON rc.role_id = r.id ' +
        'WHERE rc.project_id = ? AND r.name = ?'
      ).get(projectId, 'AI architect') as { column_id: number | null; is_default: number };

      expect(overrideEntry.column_id).toBe(doneColId);
      expect(overrideEntry.column_id).not.toBe(globalArchitect.column_id);
    });
  });
});
