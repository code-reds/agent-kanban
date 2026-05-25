import { getDb } from '../db/database.js';
import { createRole, deleteRole, seedRoleForProjects, getRoleById, updateRole, getProjectBySlug, removeAllTransitionAllowedByRole, removeAllStatusHistoryByRole, removeAllCommentsByRole, countStatusHistoryByRole, countCommentsByRole } from '../db/queries/projects.js';
import {
  seedGlobalRoleColumnMapping,
  seedRoleColumnMappingsForAllProjects,
} from '../db/seed.js';
import { revokeTokensByRole, removeAccessRulesByRole, reassignTicketsToRole } from '../db/queries/projects.js';
import { HUMAN_USER_ROLE_NAME } from './domain-validation.js';

/**
 * Map access level values to the set of allowed action types.
 */
const ACCESS_LEVEL_ACTIONS: Record<string, string[]> = {
  admin: ['create', 'edit', 'delete'],
  edit: ['create', 'edit'],
  report: ['create'],
  'read only': [],
};

/**
 * Seed ticket_access_rules for a new role based on access level.
 * Creates global rules (project_id IS NULL) and project-level rules
 * for all existing projects.
 */
function seedAccessRulesForRole(
  roleId: number,
  accessLevel: string,
  projectId: number | null = null
): void {
  const db = getDb();
  const actions = ACCESS_LEVEL_ACTIONS[accessLevel];
  if (!actions || actions.length === 0) return;

  // Get all columns that the role should have access to
  const columns = projectId === null
    ? db.prepare('SELECT id FROM kanban_columns WHERE project_id IS NULL').all() as { id: number }[]
    : db.prepare('SELECT id FROM kanban_columns WHERE project_id = ?').all([projectId]) as { id: number }[];

  for (const column of columns) {
    for (const action of actions) {
      // Check if rule already exists
      const existing = projectId === null
        ? db.prepare<[number, number, string]>(
            'SELECT id FROM ticket_access_rules WHERE column_id = ? AND role_id = ? AND action_type = ? AND project_id IS NULL'
          ).get(column.id, roleId, action)
        : db.prepare<[number, number, string, number]>(
            'SELECT id FROM ticket_access_rules WHERE column_id = ? AND role_id = ? AND action_type = ? AND project_id = ?'
          ).get(column.id, roleId, action, projectId);

      if (!existing) {
        db.prepare<[number, number, string, number | null]>(
          'INSERT INTO ticket_access_rules (column_id, role_id, action_type, project_id) VALUES (?, ?, ?, ?)'
        ).run(column.id, roleId, action, projectId);
      }
    }
  }
}

/**
 * Result type for operations that can fail.
 */
export interface Result<T> {
  data?: T;
  error?: string;
  errorCode?: string;
  statusCode?: number;
}

/**
 * Shared role service that orchestrates role operations.
 * Used by both REST API and MCP tools.
 */
export class RoleService {
  /**
   * Get all roles with access levels derived from role names.
   * Requires a valid project slug for permission checking.
   */
  static listWithAccessLevels(projectSlug: string) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { roles: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const db = getDb();
    const roles = db.prepare(
      'SELECT id, name, description FROM roles ORDER BY id'
    ).all() as { id: number; name: string; description: string | null }[];

    const enrichedRoles = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
    }));

    return { roles: enrichedRoles };
  }

  /**
   * Get all global roles without requiring a project slug.
   * Used by the global settings page.
   */
  static listGlobalRoles() {
    const db = getDb();
    const roles = db.prepare(
      'SELECT id, name, description FROM roles ORDER BY id'
    ).all() as { id: number; name: string; description: string | null }[];

    const enrichedRoles = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
    }));

    return { roles: enrichedRoles } as const;
  }

  /**
   * Update a role's name and/or description.
   * Requires a valid project slug for permission checking.
   */
  static update(
    projectSlug: string,
    roleId: number,
    params: { name?: string; description?: string }
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { role: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const updated = updateRole(roleId, params.name, params.description);

    if (!updated) {
      return { role: undefined, error: `Role with id '${roleId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { role: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
    } };
  }

  /**
   * Update a global role without requiring a project slug.
   * Used by the global settings page.
   */
  static updateGlobal(
    roleId: number,
    params: { name?: string; description?: string }
  ) {
    const updated = updateRole(roleId, params.name, params.description);

    if (!updated) {
      return { role: undefined, error: `Role with id '${roleId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { role: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
    } };
  }

  // =========================================================================
  // Create Role
  // =========================================================================

 /**
    * Create a new global role.
    * - Validates params
    * - Creates role in database
    * - Creates global roles_columns entry (NULL column = unrestricted)
    * - Seeds roles_columns for all existing projects
    * - Initializes default ticket_access_rules based on accessLevel
    * - Wraps in a database transaction (all-or-nothing)
    *
    * @param params - Role creation parameters.
    * @returns Result with the created Role or error details.
    */
   static create(
     params: { name: string; description?: string; accessLevel?: string }
   ): Result<{ id: number; name: string; description: string | null }> {
     const db = getDb();

     // --- Validation ---

     // Name required
     if (!params.name || typeof params.name !== 'string' || params.name.trim().length === 0) {
       return {
         error: 'Role name is required and must be a non-empty string',
         errorCode: 'VALIDATION_ERROR',
         statusCode: 400,
       };
     }

     // Check for duplicate name
     const existingRoles = db.prepare<[string], { id: number }[]>(
       'SELECT id FROM roles WHERE name = ?'
     ).all(params.name.trim());

     if (existingRoles.length > 0) {
       return {
         error: `Role '${params.name.trim()}' already exists`,
         errorCode: 'CONFLICT',
         statusCode: 409,
       };
     }

     // --- Transaction: Create role + seed mappings + create access rules ---

     db.prepare('BEGIN TRANSACTION').run();

     try {
       // 1. Create the role (access_level column no longer persisted)
       const createdRole = createRole(
         params.name.trim(),
         params.description || ''
       );

       if (!createdRole) {
         throw new Error('Failed to create role');
       }

       const roleId = createdRole.id;

       // 2. Create global roles_columns entry (NULL column = unrestricted)
       seedGlobalRoleColumnMapping(roleId, null);

       // 3. Seed roles_columns for all existing projects
       seedRoleColumnMappingsForAllProjects(roleId, null);

       // 4. Seed default access rules based on accessLevel (not stored in DB)
       if (params.accessLevel) {
         // Seed global access rules
         seedAccessRulesForRole(roleId, params.accessLevel, null);

         // Seed project-level access rules for all existing projects
         const projects = db.prepare<[], { id: number }>(
           'SELECT id FROM projects'
         ).all();
         for (const project of projects) {
           seedAccessRulesForRole(roleId, params.accessLevel, project.id);
         }
       }

      // Commit
      db.prepare('COMMIT').run();

      return {
        data: {
          id: createdRole.id,
          name: createdRole.name,
          description: createdRole.description || null,
        },
      };
    } catch (error) {
      // Rollback on error
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback errors
      }

      return {
        error: `Failed to create role: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  // =========================================================================
  // Delete Role
  // =========================================================================

  /**
   * Delete a role and cascade cleanup through all related tables.
   * - Guards against deleting "Human User" (id=1)
   * - Checks for tickets created by this role
   * - Cascades cleanup through 9 table types
   *
   * @param roleId - The role ID to delete.
   * @returns Result with deletion count or error details.
   */
  static delete(roleId: number): Result<{ deleted: number }> {
    const db = getDb();

    // --- Guard: Cannot delete Human User ---
    const role = getRoleById(roleId);

    if (!role) {
      return {
        error: `Role with id '${roleId}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    if (role.name === HUMAN_USER_ROLE_NAME && roleId === 1) {
      return {
        error: `Cannot delete '${HUMAN_USER_ROLE_NAME}' role`,
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    // --- Pre-check: tickets, comments, and history block deletion ---

    // Check for tickets created by this role
    const ticketCount = db.prepare<[number], { count: number }>(
      'SELECT COUNT(*) as count FROM tickets WHERE created_by_role_id = ?'
    ).get(roleId);

    if (ticketCount && ticketCount.count > 0) {
      return {
        error: `Role '${role.name}' has ${ticketCount.count} ticket(s) created. Reassign tickets first.`,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    // Check for comments by this role
    const commentCount = countCommentsByRole(roleId);
    if (commentCount > 0) {
      return {
        error: `Role '${role.name}' has ${commentCount} comment(s). Delete comments first.`,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    // Check for status history entries by this role
    const historyCount = countStatusHistoryByRole(roleId);
    if (historyCount > 0) {
      return {
        error: `Role '${role.name}' has ${historyCount} status history entry(ies). Delete history first.`,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    // --- Transaction: Cascade cleanup ---
    db.prepare('BEGIN TRANSACTION').run();

    try {
      // 1. Revoke API tokens (delete api_tokens where role_id = ?)
      revokeTokensByRole(roleId);

      // 2. Reassign tickets created by this role to Human User (id=1)
      reassignTicketsToRole(roleId, 1);

      // 3. Remove access rules (delete ticket_access_rules where role_id = ?)
      removeAccessRulesByRole(roleId);

      // 4. Remove transition_allowed_roles entries (no ON DELETE CASCADE on FK)
      removeAllTransitionAllowedByRole(roleId);

      // 5. roles_columns — handled by ON DELETE CASCADE (automatic via FK)

      // 6. conversations — handled by ON DELETE CASCADE (automatic via FK)

      // 7. messages — handled by ON DELETE CASCADE (automatic via FK)

      // 10. Finally, delete the role itself
      const result = deleteRole(roleId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete role');
      }

      // Commit
      db.prepare('COMMIT').run();

      return { data: { deleted: roleId } };
    } catch (error) {
      // Rollback on error
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback errors
      }

      return {
        error: `Failed to delete role: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }
}
