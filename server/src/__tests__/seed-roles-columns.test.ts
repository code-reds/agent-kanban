import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import {
  seedDefaultRoles,
  seedGlobalDefaults,
  seedRolesColumns,
  seedProjectRolesColumns,
  seedProjectColumns,
} from '../db/seed.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { createColumn } from '../db/queries/kanban.js';

/**
 * Create standard project columns without calling insertRoleColumnMappings.
 * This is needed for seedProjectRolesColumns tests so that
 * seedProjectRolesColumns can create new entries (not overwritten by
 * insertRoleColumnMappings).
 */
function createProjectColumns(projectId: number): void {
  const columns = [
    { slug: 'todo', name: 'To Do', order: 0 },
    { slug: 'implementation', name: 'Implementation', order: 1 },
    { slug: 'unit_review', name: 'Unit Review', order: 2 },
    { slug: 'integration_testing', name: 'Integration Testing', order: 3 },
    { slug: 'final_review', name: 'Final Review', order: 4 },
    { slug: 'done', name: 'Done', order: 5 },
    { slug: 'human_feedback', name: 'Human Feedback', order: 6 },
  ];
  for (const col of columns) {
    createColumn(projectId, col.slug, col.name, col.order, true);
  }
}

// =========================================================================
// seed.ts — Roles_Columns Seeding Tests
// =========================================================================

describe('seedRolesColumns', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    // Seed global defaults first (creates global columns needed by seedRolesColumns)
    seedGlobalDefaults();
    // Create a project to provide project-level kanban_columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-seed');
    const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-seed') as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));
  });

  it('should create 7 global roles_columns entries (one per role)', () => {
    seedRolesColumns();

    const entries = getDb().prepare<
      [],
      { role_id: number; column_id: number | null; is_default: number }
    >('SELECT role_id, column_id, is_default FROM roles_columns WHERE project_id IS NULL ORDER BY role_id').all();

    expect(entries).toHaveLength(7);

    // Verify each role has an entry
    const roleNames = ['Human User', 'AI teamleader', 'AI architect', 'AI code developer', 'AI code reviewer', 'AI integration tester', 'AI feature reviewer'];
    for (const name of roleNames) {
      const role = getDb().prepare<[string]>(
        'SELECT id FROM roles WHERE name = ?'
      ).get(name) as { id: number } | undefined;
      if (role) {
        const entry = entries.find((e) => e.role_id === role!.id);
        expect(entry).toBeDefined();
      }
    }
  });

  it('should set is_default = 1 for AI architect (todo) and NULL for Human User/teamleader', () => {
    seedRolesColumns();

    const entries = getDb().prepare<
      [],
      { role_id: number; column_id: number | null; is_default: number }
    >('SELECT role_id, column_id, is_default FROM roles_columns WHERE project_id IS NULL ORDER BY role_id').all();

    // Human User (role 1) should have NULL column_id
    const humanUser = entries.find((e) => e.role_id === 1);
    expect(humanUser?.column_id).toBeNull();
    expect(humanUser?.is_default).toBe(0);

  // AI architect should have a non-NULL column_id and is_default = 1
    const architect = entries.find((e) => e.role_id === 3);
    expect(architect).toBeDefined();
    // column_id should be a number (global column ID for 'todo'), not null
    expect(architect!.column_id).not.toBeNull();
    expect(architect!.column_id).toBeGreaterThan(0);
    expect(architect!.is_default).toBe(1);
  });

  it('should be idempotent — calling twice produces same result', () => {
    seedRolesColumns();
    const count1 = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    seedRolesColumns();
    const count2 = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    expect(count1).toBe(7);
    expect(count2).toBe(7); // Should not increase
  });

  it('should look up column IDs dynamically from kanban_columns table', () => {
    seedRolesColumns();

    const entries = getDb().prepare<
      [],
      { role_id: number; column_id: number | null }
    >('SELECT role_id, column_id FROM roles_columns WHERE project_id IS NULL').all();

    for (const entry of entries) {
      if (entry.column_id !== null) {
        // Verify the column_id exists in kanban_columns WHERE project_id IS NULL
        const col = getDb().prepare<[number], { id: number }>(
          'SELECT id FROM kanban_columns WHERE id = ? AND project_id IS NULL'
        ).get(entry.column_id);
        expect(col).toBeDefined();
      }
    }
  });

  it('should skip if global roles_columns already exist', () => {
    // Seed first time
    seedRolesColumns();

    // Verify 7 entries created
    const countAfterFirst = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;
    expect(countAfterFirst).toBe(7);

    // Seed again — should NOT create duplicate entries
    seedRolesColumns();

    const countAfterSecond = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    expect(countAfterSecond).toBe(7); // Should remain 7
  });
});

describe('seedGlobalDefaults (roles_columns)', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    // Create a project to provide project-level kanban_columns
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-seed-global');
    const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-seed-global') as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));
  });

  it('should seed global roles_columns as part of seedGlobalDefaults', () => {
    const countBefore = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    seedGlobalDefaults();

    const countAfter = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    expect(countAfter).toBe(7); // 7 entries from seedRolesColumns
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  it('should still seed roles_columns when global columns already exist', () => {
    // Seed once
    seedGlobalDefaults();
    const count1 = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    // Seed again — should not create duplicates
    seedGlobalDefaults();
    const count2 = getDb().prepare<[], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id IS NULL'
    ).get()!.total;

    expect(count1).toBe(7);
    expect(count2).toBe(7); // No duplicates
  });
});

describe('seedProjectRolesColumns (seed.ts)', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
    // Seed global defaults (creates global columns + global roles_columns)
    seedGlobalDefaults();
    // Create a project but do NOT call seedProjectColumns here —
    // seedProjectColumns already inserts role-column mappings via insertRoleColumnMappings,
    // which would prevent seedProjectRolesColumns from creating new entries.
    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-proj-seed');
  });

  it('should create project entries from global defaults', () => {
    // Create project columns (without role-column mappings)
    createProjectColumns(1);

    // Get global and project columns for mapping
    const globalCols = getDb().prepare<[], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
    ).all();

    const projectCols = getDb().prepare<[number], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(1);

    // Build colIdMapping by matching slugs between global and project columns
    const colIdMapping = new Map<number, number>();
    for (const gCol of globalCols) {
      const pCol = projectCols.find((c) => c.slug === gCol.slug);
      if (pCol) colIdMapping.set(gCol.id, pCol.id);
    }

    // Seed project roles_columns
    const count = seedProjectRolesColumns(1, colIdMapping);

    expect(count).toBe(7); // Should match the 7 global entries

    // Verify project-specific entries exist
    const projectEntries = getDb().prepare<[number], { role_id: number; column_id: number | null }>(
      'SELECT role_id, column_id FROM roles_columns WHERE project_id = ?'
    ).all(1);

    expect(projectEntries.length).toBe(7);
  });

  it('should return 0 when no global roles_columns exist', () => {
    // Reset and set up without global columns
    resetDb();
    const db = getDb();
    runMigrations();
    seedDefaultRoles();

    db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Test', 'test-no-global');
    const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get('test-no-global') as { id: number };
    const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(project.id, roleIds.map((r) => r.id));

    const projectCols = getDb().prepare<[number], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(1);

    const colIdMapping = new Map<number, number>();
    for (let i = 0; i < projectCols.length; i++) {
      colIdMapping.set(i + 1, projectCols[i].id);
    }

    const count = seedProjectRolesColumns(1, colIdMapping);

    expect(count).toBe(0); // No global entries to copy
  });

  it('should be idempotent — calling twice produces same project entry count', () => {
    createProjectColumns(1);

    const globalCols = getDb().prepare<[], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
    ).all();

    const projectCols = getDb().prepare<[number], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(1);

    const colIdMapping = new Map<number, number>();
    for (const gCol of globalCols) {
      const pCol = projectCols.find((c) => c.slug === gCol.slug);
      if (pCol) colIdMapping.set(gCol.id, pCol.id);
    }

    seedProjectRolesColumns(1, colIdMapping);
    const count1 = getDb().prepare<[number], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
    ).get(1)!.total;

    seedProjectRolesColumns(1, colIdMapping);
    const count2 = getDb().prepare<[number], { total: number }>(
      'SELECT COUNT(*) as total FROM roles_columns WHERE project_id = ?'
    ).get(1)!.total;

    expect(count1).toBe(7);
    expect(count2).toBe(7); // No duplicates
  });

  it('should handle NULL column_id (unrestricted access)', () => {
    createProjectColumns(1);

    const globalCols = getDb().prepare<[], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
    ).all();

    const projectCols = getDb().prepare<[number], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(1);

    const colIdMapping = new Map<number, number>();
    for (const gCol of globalCols) {
      const pCol = projectCols.find((c) => c.slug === gCol.slug);
      if (pCol) colIdMapping.set(gCol.id, pCol.id);
    }

    seedProjectRolesColumns(1, colIdMapping);

    // Human User (role 1) should have NULL column_id (unrestricted)
    const humanUserEntry = getDb().prepare<[number, number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(1, 1);
    expect(humanUserEntry!.column_id).toBeNull();

    // AI architect (role 3) should have a column_id
    const architectEntry = getDb().prepare<[number, number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(3, 1);
    expect(architectEntry!.column_id).toBeGreaterThan(0);
  });

  it('should correctly remap column IDs from global to project', () => {
    createProjectColumns(1);

    // Get global column IDs
    const globalCols = getDb().prepare<[], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id IS NULL'
    ).all();

    // Get project column IDs
    const projectCols = getDb().prepare<[number], { id: number; slug: string }>(
      'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
    ).all(1);

    // Build colIdMapping by matching slugs
    const colIdMapping = new Map<number, number>();
    for (const gCol of globalCols) {
      const pCol = projectCols.find((c) => c.slug === gCol.slug);
      if (pCol) colIdMapping.set(gCol.id, pCol.id);
    }

    seedProjectRolesColumns(1, colIdMapping);

    // Verify that project roles_columns entries reference project column IDs, not global ones
    const projectEntries = getDb().prepare<[number], { role_id: number; column_id: number }>(
      'SELECT role_id, column_id FROM roles_columns WHERE project_id = ? AND column_id IS NOT NULL'
    ).all(1);

    for (const entry of projectEntries) {
      // The column_id should be a project column ID
      const projectCol = projectCols.find((c) => c.id === entry.column_id);
      expect(projectCol).toBeDefined();
    }
  });
});
