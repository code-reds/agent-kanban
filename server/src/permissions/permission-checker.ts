import { getDb } from '../db/database.js';
import { isRoleUnrestricted } from '../db/queries/projects.js';
import { canTransition as canTransitionEngine, getAllowedTransitions as getAllowedTransitionsEngine } from '../workflow/engine.js';

export interface Role {
  id: number;
  name: string;
  description?: string;
}

export interface ColumnInfo {
  id: number;
  project_id: number;
  slug: string;
  name: string;
  order: number;
  is_default: number;
}

export interface WorkflowInfo {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  requires_comment: number;
  entire_ticket_group: number;
  from_slug: string;
  to_slug: string;
  allowed_role_ids: string;
}

export interface AccessRuleRow {
  id: number;
  project_id: number;
  column_id: number;
  role_id: number;
  action_type: string;
  column_slug: string;
}

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

/** Parse comma-separated role IDs string into array */
function parseAllowedRoleIds(allowedRoleIdsStr: string): number[] {
  if (!allowedRoleIdsStr) return [];
  return allowedRoleIdsStr.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

export interface TicketWithColumn {
  id: number;
  column_id: number;
  project_id: number;
}

/**
 * Shared permission checker that uses direct database access.
 * Used by both the REST API and MCP server for permission validation.
 *
 * Constructor requires projectId and roleId — no caching or HTTP dependencies.
 */
export class PermissionChecker {
  private projectId: number;
  private roleId: number;

  constructor(projectId: number, roleId: number) {
    this.projectId = projectId;
    this.roleId = roleId;
  }

  /** Get role details from the database */
  getRole(): Role | null {
    const db = getDb();
    return db.prepare(
      `SELECT r.id, r.name, r.description
       FROM roles r
       JOIN project_roles pr ON r.id = pr.role_id
       WHERE pr.project_id = ? AND r.id = ?`
    ).get(this.projectId, this.roleId) as Role | null;
  }

  /** Get column slug by column ID */
  getColumnSlug(columnId: number): string | null {
    const db = getDb();
    const result = db.prepare(
      'SELECT slug FROM kanban_columns WHERE id = ? AND project_id = ?'
    ).get(columnId, this.projectId) as { slug: string } | undefined;
    return result?.slug ?? null;
  }

  /** Get column ID by column slug */
  getColumnId(columnSlug: string): number | null {
    const db = getDb();
    const result = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(columnSlug, this.projectId) as { id: number } | undefined;
    return result?.id ?? null;
  }

  /** Check if the current role can perform an action on a ticket/column */
  checkPermission(
    action: 'list_tickets' | 'get_ticket' | 'create_ticket' | 'update_ticket' | 'delete_ticket' | 'move_ticket' |
    'add_comment' | 'add_dependency' | 'remove_dependency' | 'list_dependencies',
    columnSlug?: string
  ): PermissionCheck {
    // All roles have read access to their project
    if (action === 'list_tickets' || action === 'get_ticket' || action === 'list_dependencies') {
      return { allowed: true };
    }

    if (!columnSlug) {
      return { allowed: false, reason: 'Column context required for this action' };
    }

    // Map actions to permission levels — edit and delete are separate
    const actionToPermissionLevel: Record<string, string> = {
      create_ticket: 'create',
      update_ticket: 'edit',
      delete_ticket: 'delete',
      move_ticket: 'edit',
      add_comment: 'edit',
      add_dependency: 'edit',
      remove_dependency: 'edit',
    };

    const requiredLevel = actionToPermissionLevel[action];

    if (!requiredLevel) {
      return { allowed: false, reason: `Unknown action: ${action}` };
    }

    // Check access rules for the column
    const db = getDb();
    const columnId = this.getColumnId(columnSlug);

    if (!columnId) {
      return { allowed: false, reason: `Column '${columnSlug}' not found` };
    }

    // For 'edit' permission level, also check for 'delete' permission (edit covers delete)
    const rule = db.prepare(`
      SELECT id FROM ticket_access_rules
      WHERE project_id = ? AND column_id = ? AND role_id = ? AND action_type = ?
    `).get(this.projectId, columnId, this.roleId, requiredLevel);

    if (!rule) {
      return {
        allowed: false,
        reason: `Role ${this.roleId} does not have ${requiredLevel} permission for column '${columnSlug}'`,
      };
    }

    return { allowed: true };
  }

  /** Check if role can transition a ticket from one column to another */
  canTransition(fromColumn: string, toColumn: string): PermissionCheck {
    const engineResult = canTransitionEngine(this.projectId, fromColumn, toColumn, this.roleId);
    if (!engineResult.allowed) {
      return { allowed: false, reason: engineResult.error };
    }
    return { allowed: true };
  }

  /** Check if comment is required for a transition */
  isCommentRequired(fromColumn: string, toColumn: string): boolean {
    const db = getDb();

    const fromCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(fromColumn, this.projectId) as { id: number } | undefined;

    const toCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(toColumn, this.projectId) as { id: number } | undefined;

    if (!fromCol || !toCol) return false;

    const transition = db.prepare(`
      SELECT requires_comment
      FROM workflow_transitions
      WHERE project_id = ? AND column_from = ? AND column_to = ?
    `).get(this.projectId, fromCol.id, toCol.id) as { requires_comment: number } | undefined;

    return transition?.requires_comment === 1 || false;
  }

  /** Check if a column exists for this project */
  validateColumn(slug: string): boolean {
    const db = getDb();
    const result = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(slug, this.projectId) as { id: number } | undefined;
    return !!result;
  }

  /** Check if a role is allowed for a specific transition */
  isRoleAllowedForTransition(fromColumn: string, toColumn: string): boolean {
    const db = getDb();

    const fromCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(fromColumn, this.projectId) as { id: number } | undefined;

    const toCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(toColumn, this.projectId) as { id: number } | undefined;

    if (!fromCol || !toCol) return false;

    const transition = db.prepare(`
      SELECT wa.role_id
      FROM workflow_transitions wt
      LEFT JOIN transition_allowed_roles wa ON wt.id = wa.transition_id
      WHERE wt.project_id = ? AND wt.column_from = ? AND wt.column_to = ?
    `).all(this.projectId, fromCol.id, toCol.id) as { role_id: number | null }[];

    return transition.some((t) => t.role_id === this.roleId);
  }

  /** Get all allowed transitions from a column for this role */
  getAllowedTransitions(columnSlug: string): Array<{ toColumnSlug: string; requiresComment: boolean; entire_ticket_group: number }> {
    const engineResult = getAllowedTransitionsEngine(this.projectId, columnSlug, this.roleId);
    // Map engine result (entireTicketGroup camelCase) to legacy snake_case field
    return engineResult.map((t) => ({
      toColumnSlug: t.toColumnSlug,
      requiresComment: t.requiresComment,
      entire_ticket_group: t.entireTicketGroup ? 1 : 0,
    }));
  }
}

// Re-export the old workflow/rules functions as thin wrappers for backward compatibility
import { canCreate as _canCreate, canEdit as _canEdit, canDelete as _canDelete, hasAnyAccess as _hasAnyAccess } from '../workflow/rules.js';

export function canCreate(projectId: number, columnId: number, roleId: number): boolean {
  return _canCreate(projectId, columnId, roleId);
}

export function canEdit(projectId: number, columnId: number, roleId: number): boolean {
  return _canEdit(projectId, columnId, roleId);
}

export function canDelete(projectId: number, columnId: number, roleId: number): boolean {
  return _canDelete(projectId, columnId, roleId);
}

export function hasAnyAccess(projectId: number, columnId: number, roleId: number): boolean {
  return _hasAnyAccess(projectId, columnId, roleId);
}
