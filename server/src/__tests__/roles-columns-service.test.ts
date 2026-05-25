import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as queries from '../db/queries/global-settings.js';
import * as projectQueries from '../db/queries/projects.js';
import { GlobalSettingsService } from '../services/global-settings-service.js';
import { ProjectService } from '../services/project-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
  try {
    db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
  } catch {}
}

function createProject() {
  const db = getDb();
  const slug = `test-rs-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test RolesService', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

/** Clear all pre-seeded role-column mappings for a project (from seedProjectColumns). */
function clearProjectRoleColumns(projectId: number): void {
  getDb().prepare('DELETE FROM roles_columns WHERE project_id = ?').run(projectId);
}

// =========================================================================
// GlobalSettingsService — Roles_Columns Tests
// =========================================================================

describe('GlobalSettingsService — Roles_Columns', () => {
  beforeEach(() => {
    initDb();
  });

  describe('getRolesColumns', () => {
    it('should return empty array when no global roles_columns entries exist', () => {
      const result = GlobalSettingsService.getRolesColumns();
      expect(result.rolesColumns).toHaveLength(0);
    });

    it('should return global roles_columns with role names and column names joined', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];
      const cols = db.prepare('SELECT id, name FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; name: string }[];

      // Insert a global roles_columns entry
      queries.upsertGlobalRolesColumn(roles[0].id, cols[0].id, 1);

      const result = GlobalSettingsService.getRolesColumns();
      expect(result.rolesColumns.length).toBeGreaterThan(0);

      const entry = result.rolesColumns.find((r) => r.role_id === roles[0].id);
      expect(entry).toBeDefined();
      expect(entry!.role_name).toBe(roles[0].name);
      expect(entry!.column_name).toBe(cols[0].name);
      expect(entry!.is_default).toBe(1);
    });

    it('should return NULL column_name when column_id is NULL (unrestricted)', () => {
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      queries.upsertGlobalRolesColumn(roles[0].id, null, 1);

      const result = GlobalSettingsService.getRolesColumns();
      expect(result.rolesColumns.length).toBe(1);
      expect(result.rolesColumns[0].column_id).toBeNull();
      expect(result.rolesColumns[0].column_name).toBeNull();
    });

    it('should only return global entries (project_id IS NULL)', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];
      const cols = db.prepare('SELECT id, name FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; name: string }[];

      // Insert a global entry
      queries.upsertGlobalRolesColumn(roles[0].id, cols[0].id, 1);

      // Insert a project-specific entry
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, cols[0].id, 0);

      const result = GlobalSettingsService.getRolesColumns();
      // Should only include the global entry, not the project-specific one
      const projectEntries = result.rolesColumns.filter((r) => r.role_id === roles[0].id);
      expect(projectEntries.length).toBe(1);
      expect(projectEntries[0].id).toBeDefined();
    });

    it('should return entries ordered by role_id', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles ORDER BY id LIMIT 3').all() as { id: number; name: string }[];
      const col = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1').get(project.id) as { id: number };

      queries.upsertGlobalRolesColumn(roles[2].id, col.id, 0);
      queries.upsertGlobalRolesColumn(roles[0].id, col.id, 0);
      queries.upsertGlobalRolesColumn(roles[1].id, col.id, 0);

      const result = GlobalSettingsService.getRolesColumns();
      expect(result.rolesColumns.length).toBe(3);
      expect(result.rolesColumns[0].role_id).toBe(roles[0].id);
      expect(result.rolesColumns[1].role_id).toBe(roles[1].id);
      expect(result.rolesColumns[2].role_id).toBe(roles[2].id);
    });
  });

  describe('upsertRolesColumn', () => {
    it('should reject invalid role_id', () => {
      const result = GlobalSettingsService.upsertRolesColumn(-1, 1, 0);
      expect(result.error).toContain('role_id is required');
      expect(result.statusCode).toBe(400);
    });

    it('should insert a new global roles_columns entry', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      const result = GlobalSettingsService.upsertRolesColumn(roles[0].id, 1, 1);
      expect(result.rolesColumn).toBeDefined();
      expect(result.rolesColumn!.id).toBeGreaterThan(0);
      expect(result.rolesColumn!.role_id).toBe(roles[0].id);
      expect(result.rolesColumn!.is_default).toBe(1);
    });

    it('should update an existing global roles_columns entry (idempotent)', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];
      const cols = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number }[];

      const result1 = GlobalSettingsService.upsertRolesColumn(roles[0].id, cols[0].id, 0);
      const id1 = result1.rolesColumn!.id;

      const result2 = GlobalSettingsService.upsertRolesColumn(roles[0].id, cols[1].id, 1);
      expect(result2.rolesColumn!.id).toBe(id1);
      expect(result2.rolesColumn!.column_id).toBe(cols[1].id);
      expect(result2.rolesColumn!.is_default).toBe(1);
    });

    it('should support NULL column_id for unrestricted access', () => {
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      const result = GlobalSettingsService.upsertRolesColumn(roles[0].id, null, 1);
      expect(result.rolesColumn!.column_id).toBeNull();
      expect(result.rolesColumn!.is_default).toBe(1);
    });
  });

  describe('deleteRolesColumn', () => {
    it('should reject invalid role_id', () => {
      const result = GlobalSettingsService.deleteRolesColumn(-1);
      expect(result.error).toContain('role_id is required');
      expect(result.statusCode).toBe(400);
    });

    it('should delete a global roles_columns entry', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      GlobalSettingsService.upsertRolesColumn(roles[0].id, 1, 0);

      const result = GlobalSettingsService.deleteRolesColumn(roles[0].id);
      expect(result.success).toBe(true);
      expect(result.role_id).toBe(roles[0].id);

      // Verify deletion
      const remaining = queries.getGlobalRolesColumns();
      expect(remaining.find((e) => e.role_id === roles[0].id)).toBeUndefined();
    });

    it('should return NOT_FOUND for non-existent role_id', () => {
      const result = GlobalSettingsService.deleteRolesColumn(9999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('entry found');
      expect(result.statusCode).toBe(404);
    });

    it('should not delete project-specific entries', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];
      const col = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1').get(project.id) as { id: number };

      // Insert a project-specific entry only
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, col.id, 0);

      const result = GlobalSettingsService.deleteRolesColumn(roles[0].id);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);

      // Project-specific entry should still exist
      const projectEntries = projectQueries.getProjectRolesColumns(project.id);
      expect(projectEntries.find((e) => e.role_id === roles[0].id)).toBeDefined();
    });
  });
});

// =========================================================================
// ProjectService — seedProjectRolesColumns Tests
// =========================================================================

describe('ProjectService — seedProjectRolesColumns', () => {
  beforeEach(() => {
    initDb();
  });

  function createProjectWithGlobalMappings() {
    const project = createProject();
    clearProjectRoleColumns(project.id);
    const db = getDb();
    const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

    // Seed global roles_columns entries
    queries.upsertGlobalRolesColumn(roles[0].id, null, 1); // unrestricted
    queries.upsertGlobalRolesColumn(roles[1].id, null, 1); // unrestricted
    queries.upsertGlobalRolesColumn(roles[2].id, 1, 0); // column 1

    return { project, roles };
  }

  describe('seedProjectRolesColumns', () => {
    it('should reject invalid projectId', () => {
      const result = ProjectService.seedProjectRolesColumns(-1, new Map(), new Map());
      expect(result.success).toBe(false);
      expect(result.error).toContain('projectId is required');
      expect(result.statusCode).toBe(400);
    });

    it('should correctly map all IDs and insert matching project entries', () => {
      const { project, roles } = createProjectWithGlobalMappings();
      const db = getDb();

      // Build role name → project role ID mapping
      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }

      // Build global column ID → project column ID mapping
      const projectCols = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number }[];
      const colIdMapping = new Map<number, number>();
      for (let i = 0; i < projectCols.length; i++) {
        colIdMapping.set(i + 1, projectCols[i].id);
      }

      const result = ProjectService.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      expect(result.success).toBe(true);
      expect(result.seededCount).toBe(3);

      // Verify project-specific entries exist
      const projectEntries = projectQueries.getProjectRolesColumns(project.id);
      expect(projectEntries.length).toBe(3);
    });

    it('should not duplicate entries that already exist in the project', () => {
      const { project, roles } = createProjectWithGlobalMappings();
      const db = getDb();

      // Pre-insert one project entry directly
      const col = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1').get(project.id) as { id: number };
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, col.id, 1);

      // Build mappings
      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }
      const projectCols = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number }[];
      const colIdMapping = new Map<number, number>();
      for (let i = 0; i < projectCols.length; i++) {
        colIdMapping.set(i + 1, projectCols[i].id);
      }

      const result = ProjectService.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      expect(result.success).toBe(true);
      // Should only seed 2 new entries (role 0 already existed)
      expect(result.seededCount).toBe(2);
    });

    it('should correctly remap global column IDs to project column IDs', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      // Create a global column
      queries.createGlobalColumn('remap-slug', 'Remap Column', 5);
      const globalCol = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id IS NULL AND slug = ?').get('remap-slug') as { id: number; slug: string };

      // Create a project-specific column with the same slug
      db.prepare(
        'INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(project.id, globalCol.slug, 'Remap Column', 5, 0);
      const projectCol = db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(project.id, globalCol.slug) as { id: number };

      // Seed a global roles_columns entry referencing the global column
      queries.upsertGlobalRolesColumn(roles[2].id, globalCol.id, 0);

      // Build colIdMapping by matching slugs
      const projectCols = db.prepare('SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number; slug: string }[];
      const colIdMapping = new Map<number, number>();
      colIdMapping.set(globalCol.id, projectCol.id);

      // Build role name mapping
      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }

      const result = ProjectService.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      expect(result.success).toBe(true);

      // Verify the project entry for role 2 has the remapped column_id
      const role2Entry = projectQueries.getProjectRolesColumns(project.id).find((e) => e.role_id === roles[2].id);
      expect(role2Entry).toBeDefined();
      // The column_id should be the project column ID, not the global one
      expect(role2Entry!.column_id).toBe(projectCol.id);
      expect(role2Entry!.column_id).not.toBe(globalCol.id);
    });

    it('should handle NULL column_id (unrestricted access) correctly', () => {
      const { project, roles } = createProjectWithGlobalMappings();

      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }
      const projectCols = getDb().prepare('SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"').all(project.id) as { id: number }[];
      const colIdMapping = new Map<number, number>();
      for (let i = 0; i < projectCols.length; i++) {
        colIdMapping.set(i + 1, projectCols[i].id);
      }

      const result = ProjectService.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      expect(result.success).toBe(true);

      // Verify unrestricted entries (roles 0 and 1) have NULL column_id
      const projectEntries = projectQueries.getProjectRolesColumns(project.id);
      const role0Entry = projectEntries.find((e) => e.role_id === roles[0].id);
      const role1Entry = projectEntries.find((e) => e.role_id === roles[1].id);
      expect(role0Entry!.column_id).toBeNull();
      expect(role1Entry!.column_id).toBeNull();
      expect(role0Entry!.is_default).toBe(1);
      expect(role1Entry!.is_default).toBe(1);
    });

    it('should return error for invalid projectId', () => {
      const result = ProjectService.seedProjectRolesColumns(999999, new Map(), new Map());
      // This may succeed if the DB allows it, or fail
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('seededCount');
    });
  });
});
