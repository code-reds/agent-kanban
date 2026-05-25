import {
  getWorkflowForProject,
  createTransition as createTransitionQuery,
  deleteTransition as deleteTransitionQuery,
  addTransitionAllowedRole as addTransitionAllowedRoleQuery,
  removeTransitionAllowedRole as removeTransitionAllowedRoleQuery,
  updateTransition as updateTransitionQuery,
  syncTransitionAllowedRoles as syncTransitionAllowedRolesQuery,
  getTransitionById as getTransitionByIdQuery,
} from '../db/queries/tickets.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { getColumnById as getColumnByIdQuery } from '../db/queries/kanban.js';
import { getDb } from '../db/database.js';

interface TransitionWithSlugs {
  id: number;
  project_id: number;
  column_from: number;
  column_to: number;
  from_slug: string | undefined;
  to_slug: string | undefined;
  requires_comment: boolean;
  entire_ticket_group: boolean;
  allowed_roles: number[];
}

/**
 * Shared workflow service that orchestrates transition operations.
 * Used by both REST API and MCP tools.
 */
export class WorkflowService {
  /**
   * Get workflow transitions enriched with column slugs and allowed roles.
   */
  static list(projectSlug: string) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { transitions: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const transitions = getWorkflowForProject(project.id);

    const enriched: TransitionWithSlugs[] = transitions.map((t) => {
      const fromCol = getColumnByIdQuery(t.column_from);
      const toCol = getColumnByIdQuery(t.column_to);
      const db = getDb();
      const allowedRoles = db.prepare(
        'SELECT role_id FROM transition_allowed_roles WHERE transition_id = ?'
      ).all(t.id) as { role_id: number }[];

      return {
        id: t.id,
        project_id: t.project_id,
        column_from: t.column_from,
        column_to: t.column_to,
        from_slug: fromCol?.slug,
        to_slug: toCol?.slug,
        requires_comment: t.requires_comment === 1,
        entire_ticket_group: t.entire_ticket_group === 1,
        allowed_roles: allowedRoles.map((r) => r.role_id),
      };
    });

    return { transitions: enriched };
  }

  /**
   * Create a new workflow transition.
   */
  static create(
    projectSlug: string,
    params: {
      column_from: number;
      column_to: number;
      requires_comment?: boolean;
      entire_ticket_group?: boolean;
      allowed_roles?: number[];
    }
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { transition: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (params.column_from === undefined || params.column_to === undefined) {
      return { transition: undefined, error: 'column_from and column_to are required', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Validate column IDs belong to this project
    const fromCol = getColumnByIdQuery(params.column_from);
    const toCol = getColumnByIdQuery(params.column_to);

    if (!fromCol || fromCol.project_id !== project.id) {
      return { transition: undefined, error: `Column '${params.column_from}' not found in project`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!toCol || toCol.project_id !== project.id) {
      return { transition: undefined, error: `Column '${params.column_to}' not found in project`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const result = createTransitionQuery(
      project.id,
      params.column_from,
      params.column_to,
      params.requires_comment || false,
      params.entire_ticket_group || false
    );

    if (!result) {
      return { transition: undefined, error: 'Failed to create transition', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    // Add allowed roles
    if (params.allowed_roles && Array.isArray(params.allowed_roles)) {
      for (const roleId of params.allowed_roles) {
        addTransitionAllowedRoleQuery(result.id, roleId);
      }
    }

    return { transition: { ...result, requires_comment: params.requires_comment || false, entire_ticket_group: params.entire_ticket_group || false } };
  }

  /**
   * Delete a workflow transition.
   */
  static remove(projectSlug: string, transitionId: number) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, id: transitionId, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const deleted = deleteTransitionQuery(transitionId);
    if (!deleted) {
      return { success: false, id: transitionId, error: `Transition '${transitionId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    return { success: true, id: transitionId };
  }

  /**
   * Update a workflow transition's properties.
   * Supports partial updates for requires_comment, entire_ticket_group, and allowed_roles.
   */
  static update(
    projectSlug: string,
    transitionId: number,
    params: {
      requires_comment?: boolean;
      entire_ticket_group?: boolean;
      allowed_roles?: number[];
    }
  ) {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { transition: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Validate transition exists AND belongs to the project
    const transition = getTransitionByIdQuery(transitionId);
    if (!transition) {
      return { transition: undefined, error: `Transition '${transitionId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (transition.project_id !== project.id) {
      return { transition: undefined, error: `Transition '${transitionId}' does not belong to project '${projectSlug}'`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Check that at least one update field is provided
    const fieldsProvided =
      params.requires_comment !== undefined ||
      params.entire_ticket_group !== undefined ||
      params.allowed_roles !== undefined;

    if (!fieldsProvided) {
      return { transition: undefined, error: 'No update fields provided', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Update requires_comment and entire_ticket_group
    if (params.requires_comment !== undefined || params.entire_ticket_group !== undefined) {
      const current = getTransitionByIdQuery(transitionId)!;
      const requiresComment = params.requires_comment !== undefined ? params.requires_comment : current.requires_comment === 1;
      const entireTicketGroup = params.entire_ticket_group !== undefined ? params.entire_ticket_group : current.entire_ticket_group === 1;
      updateTransitionQuery(transitionId, requiresComment, entireTicketGroup);
    }

    // Update allowed_roles (full replacement via diff-based sync)
    if (params.allowed_roles !== undefined) {
      syncTransitionAllowedRolesQuery(transitionId, params.allowed_roles);
    }

    // Return the full updated transition with enriched allowed_roles
    const updatedTransition = getTransitionByIdQuery(transitionId)!;
    const db = getDb();
    const allowedRoles = db.prepare(
      'SELECT role_id FROM transition_allowed_roles WHERE transition_id = ?'
    ).all(transitionId) as { role_id: number }[];

    return {
      transition: {
        id: updatedTransition.id,
        project_id: updatedTransition.project_id,
        column_from: updatedTransition.column_from,
        column_to: updatedTransition.column_to,
        requires_comment: updatedTransition.requires_comment === 1,
        entire_ticket_group: updatedTransition.entire_ticket_group === 1,
        allowed_roles: allowedRoles.map((r) => r.role_id),
      },
    };
  }
}
