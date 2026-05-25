import { getDb } from '../database.js';
import { COLUMNS } from '../../types/columns.js';

// ============================================================================
// Types
// ============================================================================

export interface GlobalColumn {
  id: number;
  project_id: number | null;
  slug: string;
  name: string;
  order: number;
  is_global: number;
  is_default: number;
}

export interface GlobalWorkflowTransition {
  id: number;
  project_id: number | null;
  column_from: number;
  column_to: number;
  requires_comment: number;
  is_global: number;
  entire_ticket_group: number;
  allowed_role_ids?: string; // comma-separated list of role IDs
}

export interface GlobalAccessRule {
  id: number;
  project_id: number | null;
  column_id: number;
  role_id: number;
  action_type: string;
  is_global: number;
}

export interface SeedColumnMapping {
  globalColumnId: number;
  projectId: number;
  newColumnId: number;
}

export interface SeedData {
  columns: GlobalColumn[];
  workflows: GlobalWorkflowTransition[];
  accessRules: GlobalAccessRule[];
}

// ============================================================================
// Global Columns Queries
// ============================================================================

/**
 * Get all global columns (project_id IS NULL), ordered by "order".
 */
export function getGlobalColumns(): GlobalColumn[] {
  const db = getDb();
  return db.prepare<[], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
  ).all();
}

/**
 * Get global columns unioned with project-specific columns for a given project.
 * Returns columns WHERE project_id IS NULL OR project_id = ?
 */
export function getGlobalColumnsWithProject(projectId: number): GlobalColumn[] {
  const db = getDb();
  return db.prepare<[number], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE project_id IS NULL OR project_id = ? ORDER BY "order"'
  ).all(projectId);
}

/**
 * Create a global column (project_id = NULL).
 * Returns the created column or undefined on failure.
 */
export function createGlobalColumn(
  slug: string,
  name: string,
  order: number,
  isDefault: boolean = false
): GlobalColumn | undefined {
  const db = getDb();
  db.prepare(
    `INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default)
     VALUES (NULL, ?, ?, ?, 1, ?)`
  ).run(slug, name, order, isDefault ? 1 : 0);

  return db.prepare<[string], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE project_id IS NULL AND slug = ?'
  ).get(slug);
}

/**
 * Update a global column by ID. Only updates provided fields.
 * Returns the updated column or undefined if not found.
 */
export function updateGlobalColumn(
  columnId: number,
  slug?: string,
  name?: string,
  order?: number
): GlobalColumn | undefined {
  const db = getDb();
  const column = db.prepare<[number], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE id = ?'
  ).get(columnId);

  if (!column) return undefined;

  // Verify it's a global column
  if (column.project_id !== null) {
    return undefined;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (slug !== undefined) {
    updates.push('slug = ?');
    params.push(slug);
  }

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }

  if (order !== undefined) {
    updates.push('"order" = ?');
    params.push(order);
  }

  if (updates.length === 0) return column;

  const sql = `UPDATE kanban_columns SET ${updates.join(', ')} WHERE id = ?`;
  params.push(columnId);
  db.prepare(sql).run(...(params as any[]));

  return db.prepare<[number], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE id = ?'
  ).get(columnId)!;
}

/**
 * Delete a global column by ID.
 * Returns true if deleted, false if not found or has tickets.
 * Prevents deletion of default columns (is_default = 1) and protected columns ('todo' and 'done').
 */
export function deleteGlobalColumn(columnId: number): boolean {
  const db = getDb();
  const column = db.prepare<[number], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE id = ?'
  ).get(columnId);

  if (!column) return false;

  // Prevent deletion of default columns
  if (column.is_default === 1) {
    return false;
  }

  // Prevent deletion of protected columns by slug
  if (column.slug === COLUMNS.TODO || column.slug === COLUMNS.DONE) {
    return false;
  }

  // Check if column has tickets
  const ticketCount = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) as total FROM tickets WHERE column_id = ?'
  ).get(columnId)!;

  if (ticketCount.total > 0) {
    return false;
  }

  // Clean up dependent records to avoid foreign key constraint violations
  // Delete global access rules referencing this column
  db.prepare(
    'DELETE FROM ticket_access_rules WHERE column_id = ? AND project_id IS NULL'
  ).run(columnId);

  // Delete global roles_columns referencing this column
  db.prepare(
    'DELETE FROM roles_columns WHERE column_id = ? AND project_id IS NULL'
  ).run(columnId);

  // Delete global workflows referencing this column (both as source and target)
  // This also cascades to transition_allowed_roles via ON DELETE CASCADE
  db.prepare(
    'DELETE FROM workflow_transitions WHERE (column_from = ? OR column_to = ?) AND project_id IS NULL'
  ).run(columnId, columnId);

  // Delete ticket_status_history records referencing this column (both from and to)
  db.prepare(
    'DELETE FROM ticket_status_history WHERE from_column_id = ? OR to_column_id = ?'
  ).run(columnId, columnId);

  // Delete the column itself
  db.prepare('DELETE FROM kanban_columns WHERE id = ?').run(columnId);
  return true;
}

// ============================================================================
// Global Workflows Queries
// ============================================================================

/**
 * Get all global workflow transitions (project_id IS NULL).
 */
export function getGlobalWorkflows(): GlobalWorkflowTransition[] {
  const db = getDb();
  return db.prepare<[], GlobalWorkflowTransition>(`
    SELECT wt.id, wt.project_id, wt.column_from, wt.column_to, wt.requires_comment,
           wt.is_global, wt.entire_ticket_group,
           GROUP_CONCAT(tar.role_id) AS allowed_role_ids
    FROM workflow_transitions wt
    LEFT JOIN transition_allowed_roles tar ON tar.transition_id = wt.id
    WHERE wt.project_id IS NULL
    GROUP BY wt.id
  `).all();
}

/**
 * Create a global workflow transition (project_id = NULL).
 * Returns the created transition ID or undefined on failure.
 */
export function createGlobalWorkflow(
  columnFrom: number,
  columnTo: number,
  requiresComment: boolean = false,
  entireTicketGroup: boolean = false
): { id: number } | undefined {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment, is_global, entire_ticket_group)
     VALUES (NULL, ?, ?, ?, 1, ?)`
  ).run(columnFrom, columnTo, requiresComment ? 1 : 0, entireTicketGroup ? 1 : 0);

  return db.prepare<[], { id: number }>(
    'SELECT last_insert_rowid() as id'
  ).get()!;
}

/**
 * Update a global workflow transition by ID.
 * Returns true if updated, false if not found.
 */
export function updateGlobalWorkflow(
  transitionId: number,
  requiresComment?: boolean,
  entireTicketGroup?: boolean
): boolean {
  const db = getDb();
  const existing = db.prepare<[number], { id: number }>(
    'SELECT id FROM workflow_transitions WHERE id = ? AND project_id IS NULL'
  ).get(transitionId);

  if (!existing) return false;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (requiresComment !== undefined) {
    updates.push('requires_comment = ?');
    params.push(requiresComment ? 1 : 0);
  }

  if (entireTicketGroup !== undefined) {
    updates.push('entire_ticket_group = ?');
    params.push(entireTicketGroup ? 1 : 0);
  }

  if (updates.length === 0) return true;

  const sql = `UPDATE workflow_transitions SET ${updates.join(', ')} WHERE id = ?`;
  params.push(transitionId);
  db.prepare(sql).run(...(params as any[]));

  return true;
}

/**
 * Delete a global workflow transition by ID.
 * Returns true if deleted, false if not found.
 */
export function deleteGlobalWorkflow(transitionId: number): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM workflow_transitions WHERE id = ? AND project_id IS NULL'
  ).run(transitionId);
  return result.changes > 0;
}

// ============================================================================
// Reset / Delete All Global Settings
// ============================================================================

/**
 * Delete ALL global settings (columns, workflows, and access rules)
 * by removing all rows with project_id IS NULL.
 * This is used for the "Reset to Defaults" feature.
 *
 * Returns true if any rows were deleted.
 */
export function deleteAllGlobalSettings(): boolean {
   const db = getDb();

   // Delete global access rules first (to avoid FK issues)
   const rulesDeleted = db.prepare(
     'DELETE FROM ticket_access_rules WHERE project_id IS NULL'
   ).run();

   // Delete global roles_columns before columns (FK: roles_columns.column_id -> kanban_columns.id)
   const rolesColumnsDeleted = db.prepare(
     'DELETE FROM roles_columns WHERE project_id IS NULL'
   ).run();

   // Delete global workflows (cascade deletes transition_allowed_roles)
   const workflowsDeleted = db.prepare(
     'DELETE FROM workflow_transitions WHERE project_id IS NULL'
   ).run();

   // Delete global columns (delete last since workflows reference them)
   const columnsDeleted = db.prepare(
     'DELETE FROM kanban_columns WHERE project_id IS NULL'
   ).run();

   const totalDeleted = rulesDeleted.changes + rolesColumnsDeleted.changes + workflowsDeleted.changes + columnsDeleted.changes;
   return totalDeleted > 0;
}

// ============================================================================
// Global Access Rules Queries
// ============================================================================

/**
 * Get all global access rules (project_id IS NULL).
 */
export function getGlobalAccessRules(): GlobalAccessRule[] {
  const db = getDb();
  return db.prepare<[], GlobalAccessRule>(
    'SELECT * FROM ticket_access_rules WHERE project_id IS NULL'
  ).all();
}

/**
 * Replace all global access rules (project_id IS NULL) with the given set.
 * Clears existing rules first, then inserts new ones.
 */
export function replaceGlobalAccessRules(
  rules: { column_id: number; role_id: number; action_type: string }[]
): void {
  const db = getDb();
  // Clear existing global access rules
  db.prepare('DELETE FROM ticket_access_rules WHERE project_id IS NULL').run();

  // Insert new rules
  for (const rule of rules) {
    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type, is_global) VALUES (NULL, ?, ?, ?, 1)'
    ).run(rule.column_id, rule.role_id, rule.action_type);
  }
}

// ============================================================================
// Global Roles_Columns Queries
// ============================================================================

export interface GlobalRolesColumn {
  id: number;
  project_id: number | null;
  role_id: number;
  column_id: number;
  is_default: number;
}

/**
 * Get all global roles_columns entries (project_id IS NULL).
 * Returns role-to-column mappings that apply across all projects.
 */
export function getGlobalRolesColumns(): GlobalRolesColumn[] {
  const db = getDb();
  return db.prepare<[], GlobalRolesColumn>(
    'SELECT * FROM roles_columns WHERE project_id IS NULL ORDER BY role_id'
  ).all();
}

/**
 * Upsert a global roles_columns entry (INSERT ... ON CONFLICT DO UPDATE).
 * Returns the row id of the inserted or updated row.
 * Idempotent — safe to call multiple times with the same parameters.
 *
 * Note: Uses a check-then-update approach because SQLite treats NULLs as
 * distinct values in UNIQUE constraints, so ON CONFLICT(role_id, project_id)
 * does not trigger when project_id IS NULL.
 */
export function upsertGlobalRolesColumn(
  role_id: number,
  column_id: number | null,
  is_default: number
): number {
  const db = getDb();

  // Check if global entry already exists
  const existing = db.prepare<[number], { id: number }>(
    'SELECT id FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
  ).get(role_id);

  if (existing) {
    db.prepare(
      'UPDATE roles_columns SET column_id = ?, is_default = ? WHERE role_id = ? AND project_id IS NULL'
    ).run(column_id, is_default, role_id);
    return existing.id;
  }

  // Insert new global entry
  const result = db.prepare(
    'INSERT INTO roles_columns (project_id, role_id, column_id, is_default) VALUES (NULL, ?, ?, ?)'
  ).run(role_id, column_id, is_default);
  return result.lastInsertRowid as number;
}

/**
 * Delete a global roles_columns entry by role_id (project_id IS NULL).
 * Returns true if deleted, false if not found.
 */
export function deleteGlobalRolesColumn(role_id: number): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM roles_columns WHERE role_id = ? AND project_id IS NULL'
  ).run(role_id);
  return result.changes > 0;
}

// ============================================================================
// Project Seeding Queries
// ============================================================================

/**
 * Get all global settings for project seeding.
 * Returns global columns, workflows, and access rules.
 */
export function getProjectSeedData(): SeedData {
  const db = getDb();
  const columns = db.prepare<[], GlobalColumn>(
    'SELECT * FROM kanban_columns WHERE project_id IS NULL ORDER BY "order"'
  ).all();

  const workflows = db.prepare<[], GlobalWorkflowTransition>(
    'SELECT * FROM workflow_transitions WHERE project_id IS NULL'
  ).all();

  const accessRules = db.prepare<[], GlobalAccessRule>(
    'SELECT * FROM ticket_access_rules WHERE project_id IS NULL'
  ).all();

  return { columns, workflows, accessRules };
}

/**
 * Copy global columns to a new project, returning a mapping from global IDs to new IDs.
 * Uses a transaction for atomicity.
 */
export function seedNewProjectColumns(
  projectId: number,
  globalColumns: GlobalColumn[]
): SeedColumnMapping[] {
  const db = getDb();
  const mappings: SeedColumnMapping[] = [];

  for (const globalCol of globalColumns) {
    // Check if column already exists in project
    const existing = db.prepare<[number, string], { id: number }>(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(projectId, globalCol.slug);

    if (existing) {
      mappings.push({
        globalColumnId: globalCol.id,
        projectId,
        newColumnId: existing.id,
      });
      continue;
    }

    // Insert copy of the column for this project
    db.prepare(
      `INSERT INTO kanban_columns (project_id, slug, name, "order", is_global, is_default)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(projectId, globalCol.slug, globalCol.name, globalCol.order, globalCol.is_default);

    const newRow = db.prepare<[], { id: number }>(
      'SELECT last_insert_rowid() as id'
    ).get();
    const newId = newRow?.id ?? 0;

    mappings.push({
      globalColumnId: globalCol.id,
      projectId,
      newColumnId: newId,
    });
  }

  return mappings;
}

/**
  * Copy global workflows to a new project, remapping column IDs from the global-to-project mapping.
  * Also copies transition_allowed_roles entries, remapping transition IDs.
  * Uses a transaction for atomicity.
  */
 export function seedNewProjectWorkflows(
   projectId: number,
   globalWorkflows: GlobalWorkflowTransition[],
   columnIdMap: Map<number, number>
 ): Map<number, number> {
   const db = getDb();
   const transitionIdMap: Map<number, number> = new Map();

   for (const globalWorkflow of globalWorkflows) {
     const fromColId = columnIdMap.get(globalWorkflow.column_from);
     const toColId = columnIdMap.get(globalWorkflow.column_to);

     if (fromColId === undefined || toColId === undefined) continue;

     // Check if transition already exists
     const existing = db.prepare<[number, number, number], { id: number }>(
       'SELECT id FROM workflow_transitions WHERE project_id = ? AND column_from = ? AND column_to = ?'
     ).get(projectId, fromColId, toColId);

     if (existing) {
       transitionIdMap.set(globalWorkflow.id, existing.id);
       continue;
     }

     // Insert the transition with remapped column IDs
     db.prepare(
       `INSERT INTO workflow_transitions (project_id, column_from, column_to, requires_comment, is_global, entire_ticket_group)
        VALUES (?, ?, ?, ?, 0, ?)`
     ).run(projectId, fromColId, toColId, globalWorkflow.requires_comment, globalWorkflow.entire_ticket_group);

     const newRow = db.prepare<[], { id: number }>(
       'SELECT last_insert_rowid() as id'
     ).get();
     const newTransitionId = newRow?.id ?? 0;

     transitionIdMap.set(globalWorkflow.id, newTransitionId);

     // Copy allowed roles for this transition
     const allowedRoles = db.prepare<[number]>(
       'SELECT role_id FROM transition_allowed_roles WHERE transition_id = ?'
     ).all(globalWorkflow.id) as { role_id: number }[];

     for (const role of allowedRoles) {
       db.prepare(
         'INSERT INTO transition_allowed_roles (transition_id, role_id) VALUES (?, ?)'
       ).run(newTransitionId, role.role_id);
     }
   }

   return transitionIdMap;
 }

/**
 * Copy global access rules to a new project, remapping column IDs from the global-to-project mapping.
 */
export function seedNewProjectAccessRules(
  projectId: number,
  globalRules: GlobalAccessRule[],
  columnIdMap: Map<number, number>
): void {
  const db = getDb();

  for (const globalRule of globalRules) {
    const columnId = columnIdMap.get(globalRule.column_id);
    if (columnId === undefined) continue;

    // Check if rule already exists
    const existing = db.prepare<[number, number, number, string]>(
      'SELECT id FROM ticket_access_rules WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = ?'
    ).get(projectId, columnId, globalRule.role_id, globalRule.action_type);

    if (existing) continue;

    // Insert the rule for this project
    db.prepare(
      'INSERT INTO ticket_access_rules (project_id, column_id, role_id, action_type, is_global) VALUES (?, ?, ?, ?, 0)'
    ).run(projectId, columnId, globalRule.role_id, globalRule.action_type);
  }
}
