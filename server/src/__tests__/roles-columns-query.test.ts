import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import * as globalQueries from '../db/queries/global-settings.js';
import * as projectQueries from '../db/queries/projects.js';

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
  const slug = `test-rc-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test RolesColumns', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map((r) => r.id));
  return project;
}

/** Clear all pre-seeded role-column mappings for a project (from seedProjectColumns). */
function clearProjectRoleColumns(projectId: number): void {
  getDb().prepare('DELETE FROM roles_columns WHERE project_id = ?').run(projectId);
}

describe('Global Roles_Columns Query Functions', () => {
  beforeEach(() => {
    initDb();
  });

  describe('getGlobalRolesColumns', () => {
    it('should return empty array when no global roles_columns entries exist', () => {
      const entries = globalQueries.getGlobalRolesColumns();
      expect(entries).toHaveLength(0);
    });

    it('should return only global entries (project_id IS NULL)', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      // Insert a global entry
      globalQueries.upsertGlobalRolesColumn(roles[0].id, 1, 1);

      // Insert a project-specific entry (use INSERT OR IGNORE to avoid pre-seeded conflict)
      const colId = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id) as { id: number };
      db.prepare(
        'INSERT OR IGNORE INTO roles_columns (project_id, role_id, column_id, is_default) VALUES (?, ?, ?, ?)'
      ).run(project.id, roles[0].id, colId.id, 0);

      const entries = globalQueries.getGlobalRolesColumns();
      expect(entries).toHaveLength(1);
      expect(entries[0].project_id).toBeNull();
    });

    it('should return entries ordered by role_id', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles ORDER BY id LIMIT 3').all() as { id: number }[];

      // Get the first column ID from the project
      const colId = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id) as { id: number };

      globalQueries.upsertGlobalRolesColumn(roles[2].id, colId.id, 0);
      globalQueries.upsertGlobalRolesColumn(roles[0].id, colId.id, 0);
      globalQueries.upsertGlobalRolesColumn(roles[1].id, colId.id, 0);

      const entries = globalQueries.getGlobalRolesColumns();
      expect(entries).toHaveLength(3);
      expect(entries[0].role_id).toBe(roles[0].id);
      expect(entries[1].role_id).toBe(roles[1].id);
      expect(entries[2].role_id).toBe(roles[2].id);
    });
  });

  describe('upsertGlobalRolesColumn', () => {
    it('should insert a new global roles_columns entry', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const rowsBefore = db.prepare<[], { cnt: number }>(
        'SELECT COUNT(*) as cnt FROM roles_columns WHERE project_id IS NULL'
      ).get()!;

      // Get the first column ID from the project for the foreign key
      const colId = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id) as { id: number };

      const id = globalQueries.upsertGlobalRolesColumn(roles[0].id, colId.id, 1);
      expect(id).toBeGreaterThan(0);

      const rowsAfter = db.prepare<[], { cnt: number }>(
        'SELECT COUNT(*) as cnt FROM roles_columns WHERE project_id IS NULL'
      ).get()!;
      expect(rowsAfter.cnt).toBe(rowsBefore.cnt + 1);
    });

it('should update an existing global roles_columns entry (idempotent)', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      // Get column IDs from the project for foreign key references
      const cols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      // Insert first
      globalQueries.upsertGlobalRolesColumn(roles[0].id, cols[0].id, 0);

      // Upsert again with different values
      const id = globalQueries.upsertGlobalRolesColumn(roles[0].id, cols[1].id, 1);

      // Should have the new values
      const row = db.prepare<[number], { column_id: number; is_default: number }>(
        'SELECT column_id, is_default FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
      ).get(roles[0].id)!;
      expect(row.column_id).toBe(cols[1].id);
      expect(row.is_default).toBe(1);
    });

    it('should support NULL column_id for unrestricted access', () => {
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      globalQueries.upsertGlobalRolesColumn(roles[0].id, null, 1);

      const row = db.prepare<[number], { column_id: number | null }>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
      ).get(roles[0].id)!;
      expect(row.column_id).toBeNull();
    });
  });

  describe('deleteGlobalRolesColumn', () => {
    it('should delete a global roles_columns entry', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      // Get column ID from project for FK reference
      const colId = db.prepare(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id) as { id: number };

      globalQueries.upsertGlobalRolesColumn(roles[0].id, colId.id, 0);

      const result = globalQueries.deleteGlobalRolesColumn(roles[0].id);
      expect(result).toBe(true);

      const remaining = globalQueries.getGlobalRolesColumns();
      expect(remaining.find((e) => e.role_id === roles[0].id)).toBeUndefined();
    });

    it('should return false for non-existent role_id', () => {
      const result = globalQueries.deleteGlobalRolesColumn(9999);
      expect(result).toBe(false);
    });

    it('should not delete project-specific entries', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const colId = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id)!;

      // Insert a project-specific entry
      db.prepare(
        'INSERT INTO roles_columns (project_id, role_id, column_id, is_default) VALUES (?, ?, ?, ?)'
      ).run(project.id, roles[0].id, colId.id, 0);

      const result = globalQueries.deleteGlobalRolesColumn(roles[0].id);
      expect(result).toBe(false);

      // Project-specific entry should still exist
      const remaining = db.prepare<[number, number], { cnt: number }>(
        'SELECT COUNT(*) as cnt FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roles[0].id, project.id)!;
      expect(remaining.cnt).toBe(1);
    });
  });

  // =========================================================================
  // Project Roles_Columns Query Functions
  // =========================================================================

  describe('getProjectRolesColumns', () => {
    it('should return empty array when no project roles_columns entries exist', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const entries = projectQueries.getProjectRolesColumns(project.id);
      expect(entries).toHaveLength(0);
    });

    it('should return only project-specific entries', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const colId = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id)!;

      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, colId.id, 1);

      const entries = projectQueries.getProjectRolesColumns(project.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].project_id).toBe(project.id);
      expect(entries[0].role_id).toBe(roles[0].id);
      expect(entries[0].is_default).toBe(1);
    });
  });

  describe('seedProjectRolesColumns', () => {
    it('should seed project roles_columns from global defaults with role name mapping', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      // Seed global roles_columns entries
      globalQueries.upsertGlobalRolesColumn(roles[0].id, null, 1); // Human User - unrestricted
      globalQueries.upsertGlobalRolesColumn(roles[1].id, null, 1); // AI teamleader - unrestricted
      globalQueries.upsertGlobalRolesColumn(roles[2].id, 1, 0); // AI architect -> column 1 (todo)

      // Get project columns
      const projectCols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      // Build role name → project role ID mapping
      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }

      // Build global column ID → project column ID mapping
      const colIdMapping = new Map<number, number>();
      for (let i = 0; i < projectCols.length; i++) {
        colIdMapping.set(i + 1, projectCols[i].id);
      }

      const count = projectQueries.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      // Should have seeded 3 entries from global
      expect(count).toBe(3);

      // Verify project-specific entries exist
      const projectEntries = projectQueries.getProjectRolesColumns(project.id);
      expect(projectEntries.length).toBe(3);
    });

    it('should not duplicate entries that already exist in the project', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      // Seed global roles_columns (3 entries: roles 0, 1, 2)
      globalQueries.upsertGlobalRolesColumn(roles[0].id, null, 1);
      globalQueries.upsertGlobalRolesColumn(roles[1].id, null, 1);
      globalQueries.upsertGlobalRolesColumn(roles[2].id, 1, 0);

      // Seed project entries directly (simulate pre-existing project entry for role 0)
      const colId = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id)!;
      db.prepare(
        'INSERT INTO roles_columns (project_id, role_id, column_id, is_default) VALUES (?, ?, ?, ?)'
      ).run(project.id, roles[0].id, colId.id, 1);

      // Build mappings
      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }
      const projectCols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);
      const colIdMapping = new Map<number, number>();
      for (let i = 0; i < projectCols.length; i++) {
        colIdMapping.set(i + 1, projectCols[i].id);
      }

      const count = projectQueries.seedProjectRolesColumns(
        project.id,
        roleIdMapping,
        colIdMapping
      );

      // Should only seed the new entries, not duplicate the existing one
      // After seeding global: 3 entries (roles 0, 1, 2)
      // 1 already exists (role 0), so only 2 new should be added
      expect(count).toBe(2);
    });

    it('should correctly remap global column IDs to project column IDs', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id, name FROM roles').all() as { id: number; name: string }[];

      // Get global column IDs
      const globalCols = db.prepare<[], { id: number; slug: string }>(
        'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL'
      ).all();

      // Build global column ID → project column ID mapping
      const projectCols = db.prepare<[number], { id: number; slug: string }>(
        'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      const colIdMapping = new Map<number, number>();
      for (const gCol of globalCols) {
        const pCol = projectCols.find((c) => c.slug === gCol.slug);
        if (pCol) {
          colIdMapping.set(gCol.id, pCol.id);
        }
      }

      // Seed a global roles_columns entry referencing a global column
      if (globalCols.length > 0) {
        globalQueries.upsertGlobalRolesColumn(roles[2].id, globalCols[0].id, 0);
      }

      const roleIdMapping = new Map<string, number>();
      for (const role of roles) {
        roleIdMapping.set(role.name, role.id);
      }

      projectQueries.seedProjectRolesColumns(project.id, roleIdMapping, colIdMapping);

      // Verify the project entry has the remapped column_id (project column ID, not global)
      const projectEntries = projectQueries.getProjectRolesColumns(project.id);
      for (const entry of projectEntries) {
        if (entry.column_id !== null) {
          // The column_id should be a project column ID, not a global one
          const projectCol = projectCols.find((c) => c.id === entry.column_id);
          expect(projectCol).toBeDefined();
        }
      }
    });
  });

  describe('upsertProjectRolesColumn', () => {
    it('should insert a new project roles_columns entry', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const colId = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id)!;

      const id = projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, colId.id, 1);
      expect(id).toBeGreaterThan(0);

      const row = db.prepare<[number, number], { column_id: number; is_default: number }>(
        'SELECT column_id, is_default FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roles[0].id, project.id)!;
      expect(row.column_id).toBe(colId.id);
      expect(row.is_default).toBe(1);
    });

    it('should update an existing project roles_columns entry (idempotent)', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const cols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      // Insert first
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, cols[0].id, 0);

      // Upsert with different values
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, cols[1].id, 1);

      // Should have the new values
      const row = db.prepare<[number, number], { column_id: number; is_default: number }>(
        'SELECT column_id, is_default FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roles[0].id, project.id)!;
      expect(row.column_id).toBe(cols[1].id);
      expect(row.is_default).toBe(1);
    });

    it('should support NULL column_id for unrestricted access', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, null, 1);

      const row = db.prepare<[number, number], { column_id: number | null }>(
        'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
      ).get(roles[0].id, project.id)!;
      expect(row.column_id).toBeNull();
    });
  });

  describe('deleteProjectRolesColumn', () => {
    it('should delete a project roles_columns entry', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const colId = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order" LIMIT 1'
      ).get(project.id)!;

      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, colId.id, 0);

      const result = projectQueries.deleteProjectRolesColumn(project.id, roles[0].id);
      expect(result).toBe(true);

      const remaining = projectQueries.getProjectRolesColumns(project.id);
      expect(remaining.find((e) => e.role_id === roles[0].id)).toBeUndefined();
    });

    it('should return false for non-existent role_id', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const result = projectQueries.deleteProjectRolesColumn(project.id, 9999);
      expect(result).toBe(false);
    });

    it('should not affect global entries', () => {
      const project = createProject();
      clearProjectRoleColumns(project.id);
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      // Insert a global entry
      globalQueries.upsertGlobalRolesColumn(roles[0].id, 1, 0);

      // Delete using project-level delete
      const result = projectQueries.deleteProjectRolesColumn(project.id, roles[0].id);
      expect(result).toBe(false);

      // Global entry should still exist
      const globalEntries = globalQueries.getGlobalRolesColumns();
      expect(globalEntries.find((e) => e.role_id === roles[0].id)).toBeDefined();
    });
  });

  // =========================================================================
  // Integration: Existing role-column functions work with new schema
  // =========================================================================

  describe('Existing role-column functions with new schema', () => {
    it('isRoleUnrestricted should work with column_id IS NULL', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];

      // Clear pre-seeded mappings and set unrestricted (NULL column_id)
      clearProjectRoleColumns(project.id);
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, null, 1);

      expect(projectQueries.isRoleUnrestricted(roles[0].id, project.id)).toBe(true);
    });

    it('getRoleDefaultColumn should return column_id', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const cols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      // Clear pre-seeded mappings
      clearProjectRoleColumns(project.id);
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, cols[0].id, 0);

      const result = projectQueries.getRoleDefaultColumn(roles[0].id, project.id);
      expect(result).toBe(cols[0].id);
    });

    it('getRoleColumnMappings should return column_ids', () => {
      const project = createProject();
      const db = getDb();
      const roles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
      const cols = db.prepare<[number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
      ).all(project.id);

      // Clear pre-seeded mappings
      clearProjectRoleColumns(project.id);
      projectQueries.upsertProjectRolesColumn(project.id, roles[0].id, cols[0].id, 0);
      projectQueries.upsertProjectRolesColumn(project.id, roles[1].id, null, 1);

      const mappings = projectQueries.getRoleColumnMappings(project.id);
      expect(mappings.length).toBe(2);
      expect(mappings.find((m) => m.role_id === roles[0].id)?.column_id).toBe(cols[0].id);
      expect(mappings.find((m) => m.role_id === roles[1].id)?.column_id).toBeNull();
    });
  });
});
