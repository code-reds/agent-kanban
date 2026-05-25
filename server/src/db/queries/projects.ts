import { getDb } from '../database.js';

export interface ProjectRow {
  id: number;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithRelations extends ProjectRow {
  columns?: ColumnRow[];
  roles?: RoleRow[];
  workflows?: WorkflowRow[];
  access_rules?: AccessRuleRow[];
}

export interface ColumnRow {
  id: number;
  project_id: number;
  slug: string;
  name: string;
  order: number;
  is_default: number;
}

export interface RoleRow {
  id: number;
  name: string;
  description?: string;
}

export interface WorkflowRow {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  requires_comment: number;
  entire_ticket_group: number;
  allowed_role_ids: string; // comma-separated list of role IDs
}

export interface AccessRuleRow {
  id: number;
  project_id: number;
  column_id: number;
  role_id: number;
  action_type: string;
}

export function getAllProjects(searchQuery?: string): ProjectRow[] {
  const db = getDb();

  if (searchQuery) {
    return db.prepare<unknown[], ProjectRow>(
      `SELECT * FROM projects WHERE name LIKE ? OR slug LIKE ? ORDER BY name`
    ).all(`%${searchQuery}%`, `%${searchQuery}%`);
  }

  return db.prepare<[], ProjectRow>(
    'SELECT * FROM projects ORDER BY name'
  ).all();
}

export function getProjectBySlug(slug: string): ProjectRow | undefined {
  const db = getDb();
  return db.prepare<[string], ProjectRow>(
    'SELECT * FROM projects WHERE slug = ?'
  ).get(slug)!;
}

export function getProjectBySlugWithRelations(slug: string): ProjectWithRelations | undefined {
  const db = getDb();
  const project = db.prepare<[string], ProjectWithRelations>(
    'SELECT * FROM projects WHERE slug = ?'
  ).get(slug)!;

  if (!project) return undefined;

  project.columns = db.prepare<[number], ColumnRow>(
    'SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
  ).all(project.id);

  project.roles = db.prepare<[], RoleRow>(
    'SELECT * FROM roles ORDER BY id'
  ).all();

 project.workflows = db.prepare<[number], WorkflowRow>(`
    SELECT wt.id, wt.project_id, wt.column_from, wt.column_to, wt.requires_comment,
            wt.entire_ticket_group, kc_from.slug AS from_slug, kc_to.slug AS to_slug,
            GROUP_CONCAT(tar.role_id) AS allowed_role_ids
    FROM workflow_transitions wt
    JOIN kanban_columns kc_from ON wt.column_from = kc_from.id
    JOIN kanban_columns kc_to ON wt.column_to = kc_to.id
    LEFT JOIN transition_allowed_roles tar ON tar.transition_id = wt.id
    WHERE wt.project_id = ?
    GROUP BY wt.id
  `).all(project.id);

  project.access_rules = db.prepare<[number], AccessRuleRow>(`
    SELECT tar.*, kc.slug AS column_slug
    FROM ticket_access_rules tar
    JOIN kanban_columns kc ON tar.column_id = kc.id
    WHERE tar.project_id = ?
  `).all(project.id);

  return project;
}

export function createProject(name: string, slug: string): ProjectRow {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO projects (name, slug) VALUES (?, ?) RETURNING *'
  ).run(name, slug);

  const id = Number(result.lastInsertRowid);
  return db.prepare<[number], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id)!;
}

export function updateProject(slug: string, name?: string, description?: string): ProjectRow | undefined {
  const db = getDb();
  const project = db.prepare<[string], ProjectRow>('SELECT * FROM projects WHERE slug = ?').get(slug)!;
  if (!project) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }

  updates.push('updated_at = datetime(\'now\')');
  params.push(slug);

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE slug = ?`).run(...(params as any[]));

  return db.prepare<[string], ProjectRow>('SELECT * FROM projects WHERE slug = ?').get(slug)!;
}

export function deleteProject(slug: string): boolean {
  const db = getDb();
  const project = db.prepare<[string], { id: number }>('SELECT id FROM projects WHERE slug = ?').get(slug)!;
  if (!project) return false;

  db.prepare('DELETE FROM projects WHERE slug = ?').run(slug);
  return true;
}

export function updateRole(roleId: number, name?: string, description?: string): RoleRow | undefined {
  const db = getDb();
  const role = db.prepare<[number], RoleRow>('SELECT * FROM roles WHERE id = ?').get(roleId);
  if (!role) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }

  if (updates.length === 0) return role;

  const sql = `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`;
  params.push(roleId);
  db.prepare(sql).run(...(params as any[]));

  return db.prepare<[number], RoleRow>('SELECT * FROM roles WHERE id = ?').get(roleId)!;
}

export function getRoleById(roleId: number): RoleRow | undefined {
  const db = getDb();
  return db.prepare<[number], RoleRow>('SELECT * FROM roles WHERE id = ?').get(roleId);
}

export interface RoleColumnMapping {
  role_id: number;
  column_id: number | null;
}

/**
 * Get the default column ID for a role in a project.
 * Returns null if the role has unrestricted access (NULL column) or no mapping exists.
 */
export function getRoleDefaultColumn(roleId: number, projectId: number): number | null {
  const db = getDb();
  const row = db.prepare<[number, number], { column_id: number | null }>(
    `SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?`
  ).get(roleId, projectId);
  return row?.column_id ?? null;
}

/**
 * Get all role-to-column ID mappings for a project.
 * Returns roles where column_id IS NULL (unrestricted) or a specific column ID.
 */
export function getRoleColumnMappings(projectId: number): { role_id: number; column_id: number | null }[] {
  const db = getDb();
  return db.prepare<[number], { role_id: number; column_id: number | null }>(
    `SELECT role_id, column_id FROM roles_columns WHERE project_id = ?`
  ).all(projectId);
}

/**
 * Check if a role has unrestricted access (no column restriction) in a project.
 */
export function isRoleUnrestricted(roleId: number, projectId: number): boolean {
  const db = getDb();
  const row = db.prepare<[number, number], { column_id: number | null }>(
    `SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ? AND column_id IS NULL`
  ).get(roleId, projectId);
  return !!row;
}

/**
 * Insert role-to-column mappings for all roles in a project.
 * Human User and AI teamleader get unrestricted access (NULL column).
 * Other roles get their designated column by column_id.
 */
export function insertRoleColumnMappings(
  projectId: number,
  mappings: { roleId: number; columnId: number | null }[]
): void {
  const db = getDb();
  for (const m of mappings) {
    db.prepare(
      `INSERT OR IGNORE INTO roles_columns (role_id, project_id, column_id) VALUES (?, ?, ?)`
    ).run(m.roleId, projectId, m.columnId);
  }
}



// ============================================================================
// Roles_Columns Queries (project-level)
// ============================================================================

export interface ProjectRolesColumn {
  id: number;
  project_id: number;
  role_id: number;
  column_id: number;
  is_default: number;
}

/**
 * Get project-level roles_columns entries (project_id = ?).
 */
export function getProjectRolesColumns(projectId: number): ProjectRolesColumn[] {
  const db = getDb();
  return db.prepare<[number], ProjectRolesColumn>(
    'SELECT * FROM roles_columns WHERE project_id = ? ORDER BY role_id'
  ).all(projectId);
}

/**
 * Seed project roles_columns from global defaults.
 * Maps global role names → project role IDs, and global column IDs → project column IDs.
 * Only seeds entries where the global definition has project_id IS NULL.
 *
 * @param projectId - The target project ID.
 * @param roleIdMapping - Map of global role name → project role ID.
 * @param colIdMapping - Map of global column ID → project column ID.
 * @returns The number of rows inserted.
 */
export function seedProjectRolesColumns(
  projectId: number,
  roleIdMapping: Map<string, number>,
  colIdMapping: Map<number, number>
): number {
  const db = getDb();
  const globalMappings = db.prepare<[], { role_id: number; column_id: number | null; is_default: number }>(
    `SELECT role_id, column_id, is_default FROM roles_columns WHERE project_id IS NULL`
  ).all();

  // Get all roles in this project context (all roles are shared)
  const allRoles = db.prepare<[], { id: number; name: string }>(
    'SELECT id, name FROM roles ORDER BY id'
  ).all();

  // Since project roles are the same as global roles (shared table),
  // build a name → project ID map
  const nameToProjectRoleId = new Map<string, number>();
  for (const role of allRoles) {
    nameToProjectRoleId.set(role.name, role.id);
  }

  // Insert project-specific role-column mappings from global defaults
  let count = 0;
  for (const global of globalMappings) {
    // Find the global role name by looking up in allRoles
    const globalRole = allRoles.find((r) => r.id === global.role_id);
    if (!globalRole) continue;

    // Find the project role ID (should be the same as global role ID since roles are shared)
    const projectRoleId = nameToProjectRoleId.get(globalRole.name);
    if (projectRoleId === undefined) continue;

    // Remap column_id if not null
    const projectColumnId = global.column_id !== null
      ? colIdMapping.get(global.column_id) ?? global.column_id
      : null;

    // Upsert (skip if already exists for this role in this project)
    const existing = db.prepare<[number, number]>(
      'SELECT id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(projectRoleId, projectId);

    if (!existing) {
      db.prepare(
        `INSERT INTO roles_columns (project_id, role_id, column_id, is_default)
         VALUES (?, ?, ?, ?)`
      ).run(projectId, projectRoleId, projectColumnId, global.is_default);
      count++;
    }
  }

  return count;
}

/**
 * Upsert a project roles_columns entry (INSERT ... ON CONFLICT DO UPDATE).
 * Returns the row id of the inserted or updated row.
 * Idempotent — safe to call multiple times with the same parameters.
 */
export function upsertProjectRolesColumn(
  projectId: number,
  role_id: number,
  column_id: number | null,
  is_default: number
): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO roles_columns (project_id, role_id, column_id, is_default)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(role_id, project_id) DO UPDATE SET
       column_id = excluded.column_id,
       is_default = excluded.is_default`
  ).run(projectId, role_id, column_id, is_default);
  return result.lastInsertRowid as number;
}

/**
 * Delete a project roles_columns entry (project_id = ?).
 * Returns true if deleted, false if not found.
 */
export function deleteProjectRolesColumn(
  projectId: number,
  role_id: number
): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM roles_columns WHERE role_id = ? AND project_id = ?'
  ).run(role_id, projectId);
  return result.changes > 0;
}

// ============================================================================
// Role Management Cleanup Functions
// ============================================================================

/**
 * Reassign tickets from one role to another.
 * Updates tickets.created_by_role_id from oldRoleId to newRoleId.
 * Used to migrate ticket ownership when deleting a role.
 *
 * @param oldRoleId - The role ID to reassign from.
 * @param newRoleId - The role ID to reassign to.
 * @returns The number of tickets reassigned.
 */
export function reassignTicketsToRole(
  oldRoleId: number,
  newRoleId: number
): number {
  const db = getDb();
  const result = db.prepare<[number, number]>(
    'UPDATE tickets SET created_by_role_id = ? WHERE created_by_role_id = ?'
  ).run(newRoleId, oldRoleId);
  return result.changes;
}

/**
 * Revoke (delete) all API tokens for a given role.
 * This is the application-level cleanup for api_tokens references
 * since the FK does not have ON DELETE CASCADE.
 *
 * @param roleId - The role ID whose tokens should be revoked.
 * @returns The number of tokens revoked.
 */
export function revokeTokensByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM api_tokens WHERE role_id = ?'
  ).run(roleId);
  return result.changes;
}

/**
 * Remove all access rules for a given role.
 * This is the application-level cleanup for ticket_access_rules references
 * since they are logical references without FK constraints.
 *
 * @param roleId - The role ID whose access rules should be removed.
 * @returns The number of access rules removed.
 */
export function removeAccessRulesByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM ticket_access_rules WHERE role_id = ?'
  ).run(roleId);
  return result.changes;
}

// ============================================================================
// Role CRUD Query Functions
// ============================================================================

/**
 * Create a new role in the database.
 * Inserts into the roles table and returns the created role.
 * Note: accessLevel is accepted for backwards compatibility but not persisted.
 *
 * @param name - The role name (must be unique).
 * @param description - Optional description.
 * @param _accessLevel - Accepted but not persisted (access levels are derived from role names/IDs).
 * @returns The created RoleRow, or undefined if a role with the same name already exists.
 */
export function createRole(
  name: string,
  description: string,
  _accessLevel?: string
): RoleRow | undefined {
  const db = getDb();
  const result = db.prepare<[string, string | null]>(
    'INSERT INTO roles (name, description) VALUES (?, ?)'
  ).run(name, description || null);
  return db.prepare<[number], RoleRow>(
    'SELECT * FROM roles WHERE id = ?'
  ).get(result.lastInsertRowid as number);
}

/**
 * Delete a role by ID.
 * This is a raw database operation — caller should handle cascading
 * cleanup for related tables before calling this.
 * Checks for FK-constrained records and returns an error if any exist.
 *
 * @param roleId - The role ID to delete.
 * @returns Object with success flag and optional error message.
 */
export function deleteRole(roleId: number): { success: boolean; error?: string } {
  const db = getDb();

  // Protect the Human User role
  const role = db.prepare<[number], { name: string }>(
    'SELECT name FROM roles WHERE id = ?'
  ).get(roleId);

  if (!role) {
    return { success: false, error: `Role with id '${roleId}' not found` };
  }

  if (role.name === 'Human User' && roleId === 1) {
    return { success: false, error: "Cannot delete 'Human User' role" };
  }

  // Check for FK-constrained records that must be cleaned up first.
  // Per requirements: tickets, comments, and history items block deletion.
  // Access rules, tokens, and transitions are cleaned up by the caller
  // and should not block deletion.

  // Check tickets — blocks deletion
  const ticketCount = db.prepare<[number]>(
    'SELECT COUNT(*) as count FROM tickets WHERE created_by_role_id = ?'
  ).get(roleId) as { count: number };
  if (ticketCount.count > 0) {
    return { success: false, error: `Cannot delete role: ${ticketCount.count} ticket(s) created by this role` };
  }

  // Check comments — blocks deletion
  const commentCount = db.prepare<[number]>(
    'SELECT COUNT(*) as count FROM ticket_comments WHERE author_role_id = ?'
  ).get(roleId) as { count: number };
  if (commentCount.count > 0) {
    return { success: false, error: `Cannot delete role: ${commentCount.count} comment(s) by this role` };
  }

  // Check status history — blocks deletion
  const statusHistoryCount = db.prepare<[number]>(
    'SELECT COUNT(*) as count FROM ticket_status_history WHERE actor_role_id = ?'
  ).get(roleId) as { count: number };
  if (statusHistoryCount.count > 0) {
    return { success: false, error: `Cannot delete role: ${statusHistoryCount.count} status history entry(ies) reference this role` };
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
  return { success: true };
}

/**
 * Seed a roles_columns entry for a newly created role in a specific project.
 * Idempotent — does not create duplicate entries.
 *
 * @param roleId - The role ID.
 * @param projectId - The project ID.
 * @param defaultColumnId - The column ID to assign, or null for unrestricted access.
 * @returns true if a new mapping was created, false if it already existed (or was updated).
 */
export function seedRoleForProjects(
  roleId: number,
  projectId: number,
  defaultColumnId: number | null = null
): boolean {
  const db = getDb();

  // Check if mapping already exists for this role in this project
  const existing = db.prepare<[number, number]>(
    'SELECT id FROM roles_columns WHERE role_id = ? AND project_id = ?'
  ).get(roleId, projectId);

  if (existing) {
    // Update existing mapping if column_id differs
    const current = db.prepare<[number, number], { column_id: number | null }>(
      'SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?'
    ).get(roleId, projectId);
    if (!current || current.column_id !== defaultColumnId) {
      db.prepare<[number | null, number, number]>(
        'UPDATE roles_columns SET column_id = ? WHERE role_id = ? AND project_id = ?'
      ).run(defaultColumnId, roleId, projectId);
    }
    return false; // already existed
  }

  // Insert new mapping
  db.prepare<[number, number, number | null]>(
    'INSERT INTO roles_columns (role_id, project_id, column_id) VALUES (?, ?, ?)'
  ).run(roleId, projectId, defaultColumnId);
  return true; // newly created
}

/**
 * Delete all transition_allowed_roles entries referencing a given role.
 * Used during role deletion cleanup.
 *
 * @param roleId - The role ID whose transition roles should be removed.
 * @returns The number of entries removed.
 */
export function removeAllTransitionAllowedByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM transition_allowed_roles WHERE role_id = ?'
  ).run(roleId);
  return result.changes;
}

/**
 * Delete all ticket_status_history entries referencing a given role as actor.
 * Used during role deletion cleanup.
 *
 * @param roleId - The role ID whose status history should be removed.
 * @returns The number of entries removed.
 */
export function removeAllStatusHistoryByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM ticket_status_history WHERE actor_role_id = ?'
  ).run(roleId);
  return result.changes;
}

/**
 * Delete all ticket_comments entries referencing a given role as author.
 * Used during role deletion cleanup.
 *
 * @param roleId - The role ID whose comments should be removed.
 * @returns The number of entries removed.
 */
export function removeAllCommentsByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'DELETE FROM ticket_comments WHERE author_role_id = ?'
  ).run(roleId);
  return result.changes;
}

/**
 * Count ticket_status_history entries referencing a given role as actor.
 *
 * @param roleId - The role ID to check.
 * @returns The count of status history entries.
 */
export function countStatusHistoryByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'SELECT COUNT(*) as count FROM ticket_status_history WHERE actor_role_id = ?'
  ).get(roleId) as { count: number };
  return result.count;
}

/**
 * Count ticket_comments entries referencing a given role as author.
 *
 * @param roleId - The role ID to check.
 * @returns The count of comments.
 */
export function countCommentsByRole(roleId: number): number {
  const db = getDb();
  const result = db.prepare<[number]>(
    'SELECT COUNT(*) as count FROM ticket_comments WHERE author_role_id = ?'
  ).get(roleId) as { count: number };
  return result.count;
}
