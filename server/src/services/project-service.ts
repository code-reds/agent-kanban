import {
  getAllProjects,
  getProjectBySlug,
  getProjectBySlugWithRelations,
  createProject as createProjectQuery,
  updateProject as updateProjectQuery,
  deleteProject as deleteProjectQuery,
  seedProjectRolesColumns as seedProjectRolesColumnsQuery,
  upsertProjectRolesColumn as upsertProjectRolesColumnQuery,
  deleteProjectRolesColumn as deleteProjectRolesColumnQuery,
  type ProjectRow,
  type ProjectWithRelations,
} from '../db/queries/projects.js';
import { seedDefaultRoles, seedProjectColumns, seedProjectTokens, seedGlobalDefaults, seedProjectRolesColumns as seedProjectRolesColumnsSeed } from '../db/seed.js';
import { getDb } from '../db/database.js';
import { validateSlugFormat } from './domain-validation.js';
import { GlobalSettingsService } from './global-settings-service.js';

/**
 * Shared project service that orchestrates all project operations.
 * Used by both REST API and MCP tools.
 */
export class ProjectService {
  /**
   * List all projects with optional search.
   */
  static list(searchQuery?: string) {
    const projects = getAllProjects(searchQuery);
    return { projects };
  }

  /**
   * Get a single project by slug with all relations.
   */
  static get(slug: string) {
    const project = getProjectBySlugWithRelations(slug);

    if (!project) {
      return { project: undefined, error: `Project '${slug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { project };
  }

 /**
    * Create a new project with full seeding (roles, columns, workflow, tokens).
    * Orchestrates the sequence: seed roles -> create project -> seed columns
    * -> seed roles_columns -> seed tokens.
    */
   static create(name: string, slug: string) {
     if (!name || typeof name !== 'string') {
       return { project: undefined, error: 'Name is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
     }

     if (!slug || typeof slug !== 'string') {
       return { project: undefined, error: 'Slug is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
     }

     if (!validateSlugFormat(slug)) {
       return { project: undefined, error: 'Slug must be lowercase alphanumeric with hyphens', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
     }

     // Check for duplicate slug
     const existing = getProjectBySlug(slug);
     if (existing) {
       return { project: undefined, error: `Project with slug '${slug}' already exists`, errorCode: 'CONFLICT', statusCode: 409 };
     }

     // Seed default roles first (idempotent)
     seedDefaultRoles();

     const project = createProjectQuery(name, slug);

     if (!project) {
       return { project: undefined, error: 'Failed to create project', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
     }

     // Get all roles and build name → id mapping
     const roles = getDb().prepare('SELECT id, name FROM roles ORDER BY id').all() as { id: number; name: string }[];
     const roleIds = roles.map((r) => r.id);
     const roleIdMapping = new Map<string, number>();
     for (const role of roles) {
       roleIdMapping.set(role.name, role.id);
     }

     // Seed columns and workflow from global defaults (if available),
     // falling back to hardcoded defaults for first project on the system
     const seedResult = GlobalSettingsService.getProjectSeedData();
     const hasGlobalDefaults = seedResult.data.columns.length > 0;

     // Capture column mapping for roles_columns seeding
     const colIdMapping = new Map<number, number>();

     if (hasGlobalDefaults) {
       // Seed project from global defaults with ID remapping
       const seeded = GlobalSettingsService.seedProject(project.id);
       if (seeded.success) {
         // Build colIdMap from seeded column mappings
         for (const mapping of seeded.columnMappings) {
           colIdMapping.set(mapping.globalColumnId, mapping.newColumnId);
         }
       } else {
         // Fallback: if global seeding fails, use hardcoded seeding
         seedProjectColumns(project.id, roleIds);
         // Build colIdMap from project columns
         const projectCols = getDb().prepare(
           'SELECT id, slug FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
         ).all(project.id) as { id: number; slug: string }[];
         for (const gCol of seedResult.data.columns) {
           const pCol = projectCols.find((c) => c.slug === gCol.slug);
           if (pCol) colIdMapping.set(gCol.id, pCol.id);
         }
       }
     } else {
       // No global defaults — use existing hardcoded seeding (first project)
       seedProjectColumns(project.id, roleIds);
       // Build colIdMap from project columns
       const projectCols = getDb().prepare(
         'SELECT id FROM kanban_columns WHERE project_id = ? ORDER BY "order"'
       ).all(project.id) as { id: number }[];
       for (let i = 0; i < projectCols.length; i++) {
         colIdMapping.set(i + 1, projectCols[i].id);
       }
     }

     // Seed project-level roles_columns from global defaults
     seedProjectRolesColumnsSeed(project.id, colIdMapping);

     // Seed tokens for each AI agent role
     seedProjectTokens(project.id, roleIds);

     return { project };
   }

  /**
   * Update a project's name and/or description.
   */
  static update(
    slug: string,
    params: {
      name?: string;
      description?: string;
    }
  ) {
    const existing = getProjectBySlug(slug);
    if (!existing) {
      return { project: undefined, error: `Project '${slug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const updated = updateProjectQuery(slug, params.name, params.description);

    if (!updated) {
      return { project: undefined, error: `Project '${slug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { project: updated };
  }

  /**
   * Delete a project (cascade delete).
   */
  static remove(slug: string) {
    const deleted = deleteProjectQuery(slug);

    if (!deleted) {
      return { success: false, slug, error: `Project '${slug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { success: true, slug };
  }

  /**
   * Seed project roles_columns from global defaults.
   * Called during project creation to copy global role-to-column mappings
   * into the project with remapped IDs.
   *
   * @param projectId - The target project ID.
   * @param roleIdMapping - Map of role name → project role ID.
   * @param colIdMapping - Map of global column ID → project column ID.
   */
  static seedProjectRolesColumns(
    projectId: number,
    roleIdMapping: Map<string, number>,
    colIdMapping: Map<number, number>
  ): { success: boolean; seededCount: number; error?: string; errorCode?: string; statusCode?: number } {
    if (projectId === undefined || projectId <= 0) {
      return {
        success: false,
        seededCount: 0,
        error: 'projectId is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    try {
      const count = seedProjectRolesColumnsQuery(projectId, roleIdMapping, colIdMapping);
      return { success: true, seededCount: count };
    } catch (error) {
      return {
        success: false,
        seededCount: 0,
        error: `Failed to seed project roles_columns: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  // =========================================================================
  // Roles_Columns CRUD (Project-Level)
  // =========================================================================

  /**
   * Get combined project-level + global default roles_columns entries.
   * Project-specific overrides take precedence over global defaults.
   * Uses a LEFT JOIN to merge project-level mappings with global defaults
   * for roles that don't have project-specific overrides.
   *
   * @param slug - The project slug
   * @returns Combined roles_columns data with is_override flag
   */
  static getRolesColumns(slug: string): {
    rolesColumns: Array<{
      id: number;
      role_id: number;
      role_name: string;
      column_id: number | null;
      column_name: string | null;
      is_default: number;
      is_override: number;
    }>;
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(slug);

    if (!project) {
      return {
        rolesColumns: [],
        error: `Project '${slug}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    const db = getDb();
    const entries = db.prepare<[number], {
      id: number;
      role_id: number;
      role_name: string;
      column_id: number | null;
      column_name: string | null;
      is_default: number;
      is_override: number;
    }>(
      `SELECT
        COALESCE(prc.id, grc.id) AS id,
        COALESCE(prc.role_id, grc.role_id) AS role_id,
        r.name AS role_name,
        COALESCE(prc.column_id, grc.column_id) AS column_id,
        kc.name AS column_name,
        COALESCE(prc.is_default, grc.is_default) AS is_default,
        CASE WHEN prc.id IS NOT NULL THEN 1 ELSE 0 END AS is_override
      FROM roles r
      LEFT JOIN roles_columns prc
        ON prc.role_id = r.id AND prc.project_id = ?
      LEFT JOIN roles_columns grc
        ON grc.role_id = r.id AND grc.project_id IS NULL
      LEFT JOIN kanban_columns kc
        ON COALESCE(prc.column_id, grc.column_id) = kc.id
      ORDER BY r.id`
    ).all(project.id);

    return { rolesColumns: entries };
  }

  /**
   * Create or update a project-specific roles_columns override.
   *
   * @param slug - The project slug
   * @param role_id - The role ID
   * @param column_id - The column ID
   * @param is_default - Whether this is the default column (0 or 1)
   * @returns The upserted roles_columns entry
   */
  static upsertRolesColumn(
    slug: string,
    role_id: number,
    column_id: number | null,
    is_default: number
  ): {
    rolesColumn: { id: number; role_id: number; column_id: number | null; is_default: number };
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(slug);

    if (!project) {
      return {
        rolesColumn: undefined as any,
        error: `Project '${slug}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    if (role_id === undefined || role_id <= 0) {
      return {
        rolesColumn: undefined as any,
        error: 'role_id is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    try {
      const id = upsertProjectRolesColumnQuery(project.id, role_id, column_id, is_default);
      return {
        rolesColumn: { id, role_id, column_id, is_default },
      };
    } catch (error) {
      return {
        rolesColumn: undefined as any,
        error: `Failed to upsert project roles_column: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  /**
   * Update an existing project-specific roles_columns override.
   *
   * @param slug - The project slug
   * @param role_id - The role ID
   * @param column_id - The new column ID
   * @param is_default - Whether this is the default column (0 or 1)
   * @returns The updated roles_columns entry
   */
  static updateRolesColumn(
    slug: string,
    role_id: number,
    column_id: number | null,
    is_default: number
  ): {
    rolesColumn: { id: number; role_id: number; column_id: number | null; is_default: number };
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(slug);

    if (!project) {
      return {
        rolesColumn: undefined as any,
        error: `Project '${slug}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    if (role_id === undefined || role_id <= 0) {
      return {
        rolesColumn: undefined as any,
        error: 'role_id is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    try {
      const id = upsertProjectRolesColumnQuery(project.id, role_id, column_id, is_default);
      return {
        rolesColumn: { id, role_id, column_id, is_default },
      };
    } catch (error) {
      return {
        rolesColumn: undefined as any,
        error: `Failed to update project roles_column: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INTERNAL_ERROR',
        statusCode: 500,
      };
    }
  }

  /**
   * Delete a project-specific roles_columns override.
   * This reverts the role to the global default.
   *
   * @param slug - The project slug
   * @param role_id - The role ID to delete the override for
   * @returns Success status with deleted count
   */
  static deleteRolesColumn(
    slug: string,
    role_id: number
  ): {
    success: boolean;
    deleted: boolean;
    role_id: number;
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(slug);

    if (!project) {
      return {
        success: false,
        deleted: false,
        role_id,
        error: `Project '${slug}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    if (role_id === undefined || role_id <= 0) {
      return {
        success: false,
        deleted: false,
        role_id,
        error: 'role_id is required and must be a positive number',
        errorCode: 'VALIDATION_ERROR',
        statusCode: 400,
      };
    }

    const deleted = deleteProjectRolesColumnQuery(project.id, role_id);

    if (!deleted) {
      return {
        success: false,
        deleted: false,
        role_id,
        error: `No project-specific roles_column override found for role_id '${role_id}' in project '${slug}'`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
      };
    }

    return { success: true, deleted: true, role_id };
  }
}
