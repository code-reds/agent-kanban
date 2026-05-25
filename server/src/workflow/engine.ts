import { getDb } from '../db/database.js';
import { isRoleUnrestricted } from '../db/queries/projects.js';
import { COLUMNS } from '../types/columns.js';

interface TransitionRow {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  requires_comment: number;
  entire_ticket_group: number;
}

interface AllowedRoleRow {
  role_id: number;
}

export interface TransitionResult {
  allowed: boolean;
  requiresComment: boolean;
  entireTicketGroup: boolean;
  error?: string;
}

export function canTransition(
  projectId: number,
  fromColumnSlug: string,
  toColumnSlug: string,
  roleId: number
): TransitionResult {
  const db = getDb();

  // Check if from column exists for this project
  const fromColumn = db.prepare(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, fromColumnSlug) as { id: number } | undefined;

  if (!fromColumn) {
    return { allowed: false, requiresComment: false, entireTicketGroup: false, error: `Column '${fromColumnSlug}' not found for project` };
  }

  // Check if to column exists for this project
  const toColumn = db.prepare(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, toColumnSlug) as { id: number } | undefined;

  if (!toColumn) {
    return { allowed: false, requiresComment: false, entireTicketGroup: false, error: `Column '${toColumnSlug}' not found for project` };
  }

  // Human feedback bypass: unrestricted roles can go from human_feedback to any column
  if (fromColumnSlug === COLUMNS.HUMAN_FEEDBACK && isRoleUnrestricted(roleId, projectId)) {
    return { allowed: true, requiresComment: false, entireTicketGroup: false };
  }

  // Look up the transition in the workflow table
  const transition = db.prepare(`
    SELECT wt.*, wa.role_id
    FROM workflow_transitions wt
    LEFT JOIN transition_allowed_roles wa ON wt.id = wa.transition_id
    WHERE wt.project_id = ? AND wt.column_from = ? AND wt.column_to = ?
  `).all(projectId, fromColumn.id, toColumn.id) as unknown as (TransitionRow & AllowedRoleRow)[];

  if (transition.length === 0) {
    return {
      allowed: false,
      requiresComment: false,
      entireTicketGroup: false,
      error: `No transition defined from '${fromColumnSlug}' to '${toColumnSlug}'`,
    };
  }

  // Check if the role is allowed
  const hasPermission = transition.some((t) => t.role_id === roleId);
  if (!hasPermission) {
    return {
      allowed: false,
      requiresComment: false,
      entireTicketGroup: false,
      error: `Role ${roleId} is not allowed to transition from '${fromColumnSlug}' to '${toColumnSlug}'`,
    };
  }

  const requiresComment = transition[0].requires_comment === 1;
  const entireTicketGroup = transition[0].entire_ticket_group === 1;
  return { allowed: true, requiresComment, entireTicketGroup };
}

export function getAllowedTransitions(
  projectId: number,
  columnSlug: string,
  roleId: number
): { toColumnSlug: string; requiresComment: boolean; entireTicketGroup: boolean }[] {
  const db = getDb();

  const column = db.prepare(
    'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
  ).get(projectId, columnSlug) as { id: number } | undefined;

  if (!column) return [];

  // Human feedback bypass: unrestricted roles can go to any column
  if (columnSlug === COLUMNS.HUMAN_FEEDBACK && isRoleUnrestricted(roleId, projectId)) {
    const allColumns = db.prepare(
      'SELECT slug FROM kanban_columns WHERE project_id = ? AND slug != ?'
    ).all(projectId, columnSlug) as { slug: string }[];

    return allColumns.map((c) => ({
      toColumnSlug: c.slug,
      requiresComment: false,
      entireTicketGroup: false,
    }));
  }

  const transitions = db.prepare(`
    SELECT kc.slug AS to_column_slug, wt.requires_comment, wt.entire_ticket_group
    FROM workflow_transitions wt
    JOIN kanban_columns kc ON wt.column_to = kc.id
    LEFT JOIN transition_allowed_roles wa ON wt.id = wa.transition_id
    WHERE wt.project_id = ? AND wt.column_from = ? AND (wa.role_id = ? OR ? IN (SELECT role_id FROM roles_columns WHERE project_id = ? AND column_id IS NULL))
  `).all(projectId, column.id, roleId, roleId, projectId) as { to_column_slug: string; requires_comment: number; entire_ticket_group: number }[];

  return transitions.map((t) => ({
    toColumnSlug: t.to_column_slug,
    requiresComment: t.requires_comment === 1,
    entireTicketGroup: t.entire_ticket_group === 1,
  }));
}
