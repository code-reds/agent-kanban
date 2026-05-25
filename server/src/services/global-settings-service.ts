import { getDb } from '../db/database.js';
import {
  getGlobalColumns,
  getGlobalColumnsWithProject,
  createGlobalColumn,
  updateGlobalColumn,
  deleteGlobalColumn,
  getGlobalWorkflows,
  createGlobalWorkflow,
  updateGlobalWorkflow,
  deleteGlobalWorkflow,
  getGlobalAccessRules,
  replaceGlobalAccessRules,
  getProjectSeedData,
  seedNewProjectColumns,
  seedNewProjectWorkflows,
  seedNewProjectAccessRules,
  deleteAllGlobalSettings,
  type GlobalColumn,
  type GlobalWorkflowTransition,
  type GlobalAccessRule,
  type SeedData,
  type SeedColumnMapping,
  getGlobalRolesColumns as getGlobalRolesColumnsQuery,
  upsertGlobalRolesColumn as upsertGlobalRolesColumnQuery,
  deleteGlobalRolesColumn as deleteGlobalRolesColumnQuery,
} from '../db/queries/global-settings.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { seedGlobalDefaults } from '../db/seed.js';
import { getColumnById as getColumnByIdQuery } from '../db/queries/kanban.js';
import { VALID_ACTION_TYPES } from './domain-validation.js';
import { addTransitionAllowedRole, removeTransitionAllowedRole } from '../db/queries/tickets.js';

/**
 * GlobalSettingsService — manages global settings CRUD operations.
 * Used by both REST API and MCP tools.
 *
 * Global settings are settings with project_id = NULL in the database.
 * They act as instance-wide defaults that new projects copy from.
 */
export class GlobalSettingsService {
  // =========================================================================
  // Column CRUD
  // =========================================================================

  /**
   * List all global columns, ordered.
   */
  static listColumns(): { columns: GlobalColumn[] } {
    const columns = getGlobalColumns();
    return { columns };
  }

  /**
   * List global columns unioned with project-specific columns for a given project.
   */
  static listColumnsWithProject(projectSlug: string): { columns: GlobalColumn[]; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { columns: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const columns = getGlobalColumnsWithProject(project.id);
    return { columns };
  }

  /**
   * Create a global column.
   */
  static createColumn(
    params: { slug: string; name: string; order: number; is_default?: boolean }
  ): { column: GlobalColumn; error?: string; errorCode?: string; statusCode?: number } {
    if (!params.slug || typeof params.slug !== 'string') {
      return { column: undefined as any, error: 'Column slug is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (!params.name || typeof params.name !== 'string') {
      return { column: undefined as any, error: 'Column name is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (params.order === undefined || typeof params.order !== 'number') {
      return { column: undefined as any, error: 'Column order is required and must be a number', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Check for duplicate global column slug
    const existingColumns = getGlobalColumns();
    const duplicate = existingColumns.find((c) => c.slug === params.slug);
    if (duplicate) {
      return { column: undefined as any, error: `Global column slug '${params.slug}' already exists`, errorCode: 'CONFLICT', statusCode: 409 };
    }

    const column = createGlobalColumn(params.slug, params.name, params.order, params.is_default || false);

    if (!column) {
      return { column: undefined as any, error: 'Failed to create global column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    return { column };
  }

  /**
   * Update a global column.
   */
  static updateColumn(
    columnId: number,
    params: { slug?: string; name?: string; order?: number }
  ): { column: GlobalColumn; error?: string; errorCode?: string; statusCode?: number } {
    const column = updateGlobalColumn(columnId, params.slug, params.name, params.order);

    if (!column) {
      return { column: undefined as any, error: `Global column '${columnId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { column };
  }

  /**
   * Delete a global column.
   * Fails if the column is default or has tickets.
   */
  static deleteColumn(columnId: number): { success: boolean; id: number; error?: string; errorCode?: string; statusCode?: number } {
    const column = getColumnByIdQuery(columnId);
    if (!column) {
      return { success: false, id: columnId, error: `Column '${columnId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Check if it's a global column (project_id IS NULL)
    if (column.project_id !== null) {
      return { success: false, id: columnId, error: `Column '${columnId}' is not a global column`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (column.is_default === 1) {
      return { success: false, id: columnId, error: 'Cannot delete default global columns', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const deleted = deleteGlobalColumn(columnId);
    if (!deleted) {
      return { success: false, id: columnId, error: 'Cannot delete global column with existing tickets', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    return { success: true, id: columnId };
  }

  // =========================================================================
  // Workflow CRUD
  // =========================================================================

  /**
   * List all global workflow transitions.
   */
  static listWorkflows(): { transitions: GlobalWorkflowTransition[] } {
    const transitions = getGlobalWorkflows();
    return { transitions };
  }

  /**
   * Create a global workflow transition.
   */
  static createWorkflow(
    params: {
      column_from: number;
      column_to: number;
      requires_comment?: boolean;
      entire_ticket_group?: boolean;
      allowed_roles?: number[];
    }
  ): { transition: GlobalWorkflowTransition; error?: string; errorCode?: string; statusCode?: number } {
    if (params.column_from === undefined || params.column_to === undefined) {
      return { transition: undefined as any, error: 'column_from and column_to are required', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Validate column IDs exist
    const fromCol = getColumnByIdQuery(params.column_from);
    const toCol = getColumnByIdQuery(params.column_to);

    if (!fromCol) {
      return { transition: undefined as any, error: `Column '${params.column_from}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!toCol) {
      return { transition: undefined as any, error: `Column '${params.column_to}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const result = createGlobalWorkflow(
      params.column_from,
      params.column_to,
      params.requires_comment || false,
      params.entire_ticket_group || false
    );

    if (!result) {
      return { transition: undefined as any, error: 'Failed to create global transition', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    // Seed allowed roles for the new transition
    if (params.allowed_roles && Array.isArray(params.allowed_roles)) {
      for (const roleId of params.allowed_roles) {
        addTransitionAllowedRole(result.id, roleId);
      }
    }

    return {
      transition: {
        id: result.id,
        project_id: null,
        column_from: params.column_from,
        column_to: params.column_to,
        requires_comment: params.requires_comment ? 1 : 0,
        is_global: 1,
        entire_ticket_group: params.entire_ticket_group ? 1 : 0,
      },
    };
  }

  /**
   * Update a global workflow transition.
   */
  static updateWorkflow(
    transitionId: number,
    params: {
      requires_comment?: boolean;
      entire_ticket_group?: boolean;
      allowed_roles?: number[];
    }
  ): { success: boolean; error?: string; errorCode?: string; statusCode?: number } {
    // Check that at least one update field is provided
    const fieldsProvided =
      params.requires_comment !== undefined ||
      params.entire_ticket_group !== undefined ||
      params.allowed_roles !== undefined;

    if (!fieldsProvided) {
      return { success: false, error: 'No update fields provided', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Validate transition exists and is global
    const existing = getGlobalWorkflows().find((t) => t.id === transitionId);
    if (!existing) {
      return { success: false, error: `Global transition '${transitionId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Handle allowed_roles sync (full replacement)
    if (params.allowed_roles !== undefined) {
      // Remove all existing allowed roles for this transition
      const existingRules = getDb().prepare<[number]>(
        'SELECT role_id FROM transition_allowed_roles WHERE transition_id = ?'
      ).all(transitionId) as { role_id: number }[];

      for (const rule of existingRules) {
        removeTransitionAllowedRole(transitionId, rule.role_id);
      }

      // Insert new allowed roles
      for (const roleId of params.allowed_roles) {
        addTransitionAllowedRole(transitionId, roleId);
      }
    }

    // Handle requires_comment and entire_ticket_group
    if (params.requires_comment !== undefined || params.entire_ticket_group !== undefined) {
      const updated = updateGlobalWorkflow(
        transitionId,
        params.requires_comment,
        params.entire_ticket_group
      );

      if (!updated) {
        return { success: false, error: `Failed to update global transition '${transitionId}'`, errorCode: 'INTERNAL_ERROR', statusCode: 500 };
      }
    }

    return { success: true };
  }

  /**
   * Delete a global workflow transition.
   */
  static deleteWorkflow(transitionId: number): { success: boolean; id: number; error?: string; errorCode?: string; statusCode?: number } {
    const existing = getGlobalWorkflows().find((t) => t.id === transitionId);
    if (!existing) {
      return { success: false, id: transitionId, error: `Global transition '${transitionId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const deleted = deleteGlobalWorkflow(transitionId);
    if (!deleted) {
      return { success: false, id: transitionId, error: `Failed to delete global transition '${transitionId}'`, errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    return { success: true, id: transitionId };
  }

  // =========================================================================
  // Access Rule CRUD
  // =========================================================================

  /**
   * List all global access rules.
   */
  static listAccessRules(): { rules: GlobalAccessRule[] } {
    const rules = getGlobalAccessRules();
    return { rules };
  }

  /**
   * Bulk update (replace) global access rules with validation.
   */
  static updateAccessRules(
    rules: Array<{ column_id: number; role_id: number; action_type: string }>
  ): { rules: GlobalAccessRule[]; error?: string; errorCode?: string; statusCode?: number } {
    if (!rules || !Array.isArray(rules)) {
      return { rules: [], error: 'rules array is required', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Get global columns for validation
    const globalColumns = getGlobalColumns();
    const columnIds = new Set(globalColumns.map((c) => c.id));

    for (const rule of rules) {
      if (rule.column_id === undefined || !columnIds.has(rule.column_id)) {
        return { rules: [], error: `Invalid column_id: ${rule.column_id} (not a global column)`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
      }
      if (rule.action_type === undefined || !VALID_ACTION_TYPES.includes(rule.action_type as typeof VALID_ACTION_TYPES[number])) {
        return { rules: [], error: `Invalid action_type: ${rule.action_type}`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
      }
    }

    // Replace rules in the database
    replaceGlobalAccessRules(rules);

    // Fetch updated rules
    const updatedRules = getGlobalAccessRules();
    return { rules: updatedRules };
  }

  // =========================================================================
  // Roles_Columns CRUD
  // =========================================================================

  /**
   * List all global roles_columns entries with role names and column names joined.
   */
  static getRolesColumns(): {
    rolesColumns: Array<{
      id: number;
      role_id: number;
      role_name: string;
      column_id: number | null;
      column_name: string | null;
      is_default: number;
    }>;
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const db = getDb();
    const entries = db.prepare<
      [],
      {
        id: number;
        role_id: number;
        role_name: string;
        column_id: number | null;
        column_name: string | null;
        is_default: number;
      }
    >(
      `SELECT rc.id, rc.role_id, r.name AS role_name, rc.column_id, kc.name AS column_name, rc.is_default
       FROM roles_columns rc
       JOIN roles r ON rc.role_id = r.id
       LEFT JOIN kanban_columns kc ON rc.column_id = kc.id
       WHERE rc.project_id IS NULL
       ORDER BY rc.role_id`
    ).all();
    return { rolesColumns: entries };
  }

  /**
   * Upsert a global roles_columns entry.
   * Creates or updates the role-to-column mapping at the global level.
   * Uses a check-then-update pattern because SQLite treats NULLs as distinct in UNIQUE constraints.
   *
   * @param role_id - The role ID
   * @param column_id - The column ID, or NULL for unrestricted access
   * @param is_default - Whether this is the default column for this role (0 or 1)
   * @returns The upserted roles_columns entry
   */
  static upsertRolesColumn(
    role_id: number,
    column_id: number | null,
    is_default: number
  ): {
    rolesColumn: { id: number; role_id: number; column_id: number | null; is_default: number };
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    if (role_id === undefined || role_id <= 0) {
      return {
        rolesColumn: undefined as any,
        error: 'role_id is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    try {
      const id = upsertGlobalRolesColumnQuery(role_id, column_id, is_default);
      return {
        rolesColumn: { id, role_id, column_id, is_default },
      };
    } catch (error) {
      return {
        rolesColumn: undefined as any,
        error: `Failed to upsert roles_column: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  /**
   * Delete a global roles_columns entry by role_id.
   * Only affects entries where project_id IS NULL.
   *
   * @param role_id - The role ID to delete the global mapping for
   */
  static deleteRolesColumn(role_id: number): {
    success: boolean;
    role_id: number;
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    if (role_id === undefined || role_id <= 0) {
      return {
        success: false,
        role_id,
        error: 'role_id is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    const deleted = deleteGlobalRolesColumnQuery(role_id);

    if (!deleted) {
      return {
        success: false,
        role_id,
        error: `No global roles_column entry found for role_id '${role_id}'`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    return { success: true, role_id };
  }

  // =========================================================================
  // Project seeding
  // =========================================================================

  /**
   * Get all global settings for project seeding.
   */
  static getProjectSeedData(): { data: SeedData; error?: string; errorCode?: string; statusCode?: number } {
    const data = getProjectSeedData();
    return { data };
  }

  /**
   * Copy global defaults to a new project (transactional, all-or-nothing).
   * Remaps column IDs so that project-specific references don't point to global IDs.
   */
  static seedProject(projectId: number): {
    success: boolean;
    columnMappings: SeedColumnMapping[];
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const db = getDb();
    const data = getProjectSeedData();

    // Start a transaction
    db.prepare('BEGIN TRANSACTION').run();

    try {
      // 1. Seed columns
      const columnMappings = seedNewProjectColumns(projectId, data.columns);

      // 2. Build column ID remap
      const columnIdMap = new Map<number, number>();
      for (const mapping of columnMappings) {
        columnIdMap.set(mapping.globalColumnId, mapping.newColumnId);
      }

      // 3. Seed workflows (with remapped column IDs and transition_allowed_roles)
      seedNewProjectWorkflows(projectId, data.workflows, columnIdMap);

      // 4. Seed access rules (with remapped column IDs)
      seedNewProjectAccessRules(projectId, data.accessRules, columnIdMap);

      // Commit
      db.prepare('COMMIT').run();

      return { success: true, columnMappings };
    } catch (error) {
      // Rollback on error
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback errors
      }

      return {
        success: false,
        columnMappings: [],
        error: `Failed to seed project: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  // =========================================================================
  // Reset to defaults
  // =========================================================================

  /**
   * Reset all global settings to defaults.
   * Drops all existing global columns, workflows, and access rules,
   * then reseeds with the standard defaults.
   *
   * This is used by the "Reset to Defaults" button in the global settings UI.
   */
  static resetGlobalDefaults(): {
    success: boolean;
    deletedCount: number;
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    try {
      // Delete all existing global settings
      const deleted = deleteAllGlobalSettings();

      // Re-seed with standard defaults
      seedGlobalDefaults();

      return { success: true, deletedCount: deleted ? 1 : 0 };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        error: `Failed to reset global defaults: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }
}
