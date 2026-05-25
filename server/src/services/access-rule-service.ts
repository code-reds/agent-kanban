import {
  getAccessRulesByProject,
  upsertAccessRules,
  type AccessRule,
} from '../db/queries/tickets.js';
import {
  getColumnsByProject,
  type KanbanColumn,
} from '../db/queries/kanban.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { getDb } from '../db/database.js';
import { VALID_ACTION_TYPES } from './domain-validation.js';

interface AccessRuleRow {
  id: number;
  project_id: number;
  column_id: number;
  role_id: number;
  action_type: string;
}

interface EnrichedAccessRule {
  id: number;
  column_id: number;
  column_slug: string;
  column_name: string;
  role_id: number;
  role_name: string;
  action_type: string;
}

/**
 * Shared access rule service that orchestrates access rule CRUD.
 * Used by both REST API and MCP tools.
 */
export class AccessRuleService {
  /**
   * Get all access rules enriched with column/role names.
   */
  static list(projectSlug: string) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { rules: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const rules = getAccessRulesByProject(project.id) as AccessRuleRow[];
    const columns = getColumnsByProject(project.id);

    const columnMap = new Map<number, { slug: string; name: string }>();
    for (const col of columns) {
      columnMap.set(col.id, { slug: col.slug, name: col.name });
    }

    const db = getDb();
    const roles = db.prepare(
      'SELECT id, name FROM roles ORDER BY id'
    ).all() as { id: number; name: string }[];

    const roleMap = new Map<number, string>();
    for (const role of roles) {
      roleMap.set(role.id, role.name);
    }

    const enriched: EnrichedAccessRule[] = rules.map((rule) => ({
      id: rule.id,
      column_id: rule.column_id,
      column_slug: columnMap.get(rule.column_id)?.slug ?? `column-${rule.column_id}`,
      column_name: columnMap.get(rule.column_id)?.name ?? `Column ${rule.column_id}`,
      role_id: rule.role_id,
      role_name: rule.role_id !== null ? (roleMap.get(rule.role_id) ?? `Role ${rule.role_id}`) : 'All Roles',
      action_type: rule.action_type,
    }));

    return { rules: enriched };
  }

  /**
   * Bulk update access rules with validation and reconciliation.
   */
  static update(
    projectSlug: string,
    rules: Array<{ column_id: number; role_id: number; action_type: string }>
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { rules: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!rules || !Array.isArray(rules)) {
      return { rules: [], error: 'rules array is required', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Validate all rules reference valid columns
    const columns = getColumnsByProject(project.id);
    const columnIds = new Set(columns.map((c) => c.id));

    for (const rule of rules) {
      if (rule.column_id === undefined || !columnIds.has(rule.column_id)) {
        return { rules: [], error: `Invalid column_id: ${rule.column_id}`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
      }
      if (rule.action_type === undefined || !VALID_ACTION_TYPES.includes(rule.action_type as typeof VALID_ACTION_TYPES[number])) {
        return { rules: [], error: `Invalid action_type: ${rule.action_type}`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
      }
    }

    // Get existing rules for reconciliation
    const existingRules = getAccessRulesByProject(project.id) as AccessRuleRow[];

    // Map snake_case request body to camelCase for upsertAccessRules
    const mappedRules = rules.map((rule) => ({
      columnId: rule.column_id,
      roleId: rule.role_id,
      actionType: rule.action_type,
    }));

    // Upsert rules
    upsertAccessRules(project.id, mappedRules, existingRules);

    // Fetch updated rules with enriched data
    const updatedRules = getAccessRulesByProject(project.id) as AccessRuleRow[];

    const columnMap = new Map<number, { slug: string; name: string }>();
    for (const col of columns) {
      columnMap.set(col.id, { slug: col.slug, name: col.name });
    }

    const db = getDb();
    const roles = db.prepare(
      'SELECT id, name FROM roles ORDER BY id'
    ).all() as { id: number; name: string }[];

    const roleMap = new Map<number, string>();
    for (const role of roles) {
      roleMap.set(role.id, role.name);
    }

    const enriched: EnrichedAccessRule[] = updatedRules.map((rule) => ({
      id: rule.id,
      column_id: rule.column_id,
      column_slug: columnMap.get(rule.column_id)?.slug ?? `column-${rule.column_id}`,
      column_name: columnMap.get(rule.column_id)?.name ?? `Column ${rule.column_id}`,
      role_id: rule.role_id,
      role_name: rule.role_id !== null ? (roleMap.get(rule.role_id) ?? `Role ${rule.role_id}`) : 'All Roles',
      action_type: rule.action_type,
    }));

    return { rules: enriched };
  }
}
