import {
  getTicketById,
  createTicket as createTicketQuery,
  updateTicket as updateTicketQuery,
  deleteTicket as deleteTicketQuery,
  addComment as addCommentQuery,
  updateComment as updateCommentQuery,
  deleteComment as deleteCommentQuery,
  getCommentById,
  addDependency as addDependencyQuery,
  removeDependency as removeDependencyQuery,
  getDependencies,
  getTicketsByProject,
  addStatusHistory,
  getParentTicketById,
  getDb,
  getDescendantsBlockedByGroup,
  getMostCriticalTickets,

  type TicketRow,
  type TicketWithRelations,
  type DependencyRow,
  type CommentRow,
} from '../db/queries/tickets.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { getColumnBySlug as getColumnBySlugQuery, getColumnById as getColumnByIdQuery } from '../db/queries/kanban.js';
import { PermissionChecker } from '../permissions/permission-checker.js';
import { canTransition as canTransitionEngine, getAllowedTransitions as getAllowedTransitionsEngine } from '../workflow/engine.js';
import { getFallbackRoleId } from '../db/database.js';
import { ticketEvents, TICKET_CREATED, TICKET_UPDATED, TICKET_MOVED, TICKET_DELETED, TICKET_COMMENT_ADDED, TICKET_DEPENDENCY_ADDED, TICKET_DEPENDENCY_REMOVED } from './event-emitter.js';
import { withTransaction } from '../utils/db.js';
import { COLUMNS } from '../types/columns.js';
import { TicketListMode } from '../types/ticket.js';

/**
 * Un-escape literal backslash-n sequences to actual newline characters.
 *
 * The MCP SDK re-escapes newline characters during tool input processing,
 * converting real newlines (`\n`, code point U+000A) into literal two-character
 * sequences (`\` + `n`, code points U+005C U+006E). This function reverses
 * that escaping so the database stores correct newline characters.
 *
 * This is idempotent for the REST API path: real newlines are left unchanged,
 * so existing REST API callers are not affected.
 */
function unescapeNewlines(input: string): string {
  // Replace literal backslash-n (\n) with actual newline character
  return input.replace(/\\n/g, '\n');
}

/** Result of a ticket move operation */
export interface MoveTicketResult {
  success: boolean;
  ticket_id: number;
  to_column: string;
  error?: string;
  blocker_ids?: number[];
  errorCode?: string;
  statusCode?: number;
  tickets_unblocked?: number[];
}

/** Enriched comment with role name */
export interface EnrichedComment {
  id: number;
  ticket_id: number;
  author_role_id: number;
  author_role_name: string | null;
  content: string;
  action_type: string | null;
  action_details: string | null;
  created_at: string;
}

/**
 * Shared ticket service that orchestrates all ticket operations.
 * Used by both REST API and MCP tools.
 */
export class TicketService {
  /**
     * Resolve a project by its slug. Returns the project or undefined.
     * This provides a service-layer entry point for project lookups used by MCP tools.
     */
  static resolveProject(projectSlug: string): { id: number } | undefined {
    return getProjectBySlug(projectSlug);
  }

  /**
    * Resolve a role's default column slug for a project.
    * Returns null for unrestricted roles, or the column ID for restricted roles.
    */
  static getRoleDefaultColumn(roleId: number, projectId: number): number | null {
    const db = getDb();
    const row = db.prepare<[number, number], { column_id: number }>(
      `SELECT column_id FROM roles_columns WHERE role_id = ? AND project_id = ?`
    ).get(roleId, projectId);
    return row?.column_id ?? null;
  }

  /**
    * Validate and retrieve a ticket for a given project.
    * Returns { ticket, project } or null if not found.
    */
  static findTicketForProject(projectSlug: string, ticketId: number): {
    ticket: TicketRow | undefined;
    project: { id: number } | undefined;
  } {
    const project = getProjectBySlug(projectSlug);
    if (!project) return { ticket: undefined, project: undefined };

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { ticket: undefined, project: undefined };
    }

    return { ticket, project };
  }

  /**
   * Resolve the priority for a new ticket, applying inheritance from parent if needed.
   *
   * Priority inheritance rules:
   * - If priority is explicitly set (not undefined), use it as-is
   * - If priority is undefined AND parent_id is set AND parent exists, inherit parent's priority
   * - If no parent or parent doesn't exist, fall back to default (2)
   *
   * Note: The MCP tool schema must use optional() for priority (not default(3)) so that
   * "not specified" is distinguishable from "explicitly set to 3". This method is the
   * single source of truth for priority resolution.
   */
  static resolvePriority(
    priority: number | undefined,
    parentId: number | null | undefined,
    projectId: number
  ): number {
    // No parent — no inheritance possible, use provided or default
    if (!parentId) {
      return priority !== undefined ? priority : 2;
    }

    // Parent is set — if priority is explicitly provided, use it
    if (priority !== undefined) {
      return priority;
    }

    // Priority is undefined and parent is set — inherit from parent
    const parent = getParentTicketById(Number(parentId));

    // If parent doesn't exist, fall back to default
    if (!parent) {
      return 2;
    }

    return parent.priority;
  }

  /**
   * Create a new ticket with validation and permission checking.
   */
  static create(
    projectSlug: string,
    params: {
      title: string;
      column: string;
      description?: string;
      labels?: string;
      priority?: number;
      estimate?: number | string | null;
      parent_id?: number | null;
      role_id?: number;
    }
  ): { ticket: TicketRow | undefined; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { ticket: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!params.title || typeof params.title !== 'string') {
      return { ticket: undefined, error: 'Title is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    if (!params.column || typeof params.column !== 'string') {
      return { ticket: undefined, error: 'Column slug is required', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const columnData = getColumnBySlugQuery(params.column, project.id);
    if (!columnData) {
      return { ticket: undefined, error: `Column '${params.column}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    const pc = new PermissionChecker(project.id, roleId);
    const permCheck = pc.checkPermission('create_ticket', params.column);
    if (!permCheck.allowed) {
      return { ticket: undefined, error: permCheck.reason || `Role ${roleId} cannot create tickets in column '${params.column}'`, errorCode: 'PERMISSION_DENIED', statusCode: 403 };
    }

    // Priority inheritance: if priority is not explicitly set and a parent is specified,
    // inherit the parent's priority. The MCP schema uses optional() so undefined means
    // "not specified". REST API also passes undefined when priority is omitted from the body.
    const priorityInherited = this.resolvePriority(params.priority, params.parent_id, project.id);

    const estimateValue = params.estimate !== undefined && params.estimate !== null
      ? String(params.estimate)
      : null;

    const ticket = createTicketQuery(
      project.id,
      columnData.id,
      params.title,
      unescapeNewlines(params.description || ''),
      params.labels || '[]',
      priorityInherited,
      estimateValue,
      params.parent_id || null,
      roleId
    );

    if (!ticket) {
      return { ticket: undefined, error: 'Failed to create ticket', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    ticketEvents.emit(TICKET_CREATED, { ticket, project_slug: projectSlug });

    return { ticket };
  }

  /**
   * Update a ticket with permission checking.
   */
  static update(
    projectSlug: string,
    ticketId: number,
    params: {
      title?: string;
      description?: string;
      labels?: string;
      priority?: number;
      estimate?: number | string | null;
      parent_id?: number | null;
      role_id?: number;
    }
  ): { ticket: TicketRow | undefined; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { ticket: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { ticket: undefined, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Validate parent_id: reject self-reference
    if (params.parent_id !== undefined && params.parent_id !== null && params.parent_id === ticketId) {
      return { ticket: undefined, error: 'Ticket cannot be its own parent', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Validate parent_id: if non-null, verify parent ticket exists and is in the same project
    if (params.parent_id !== undefined && params.parent_id !== null) {
      const parentTicket = getTicketById(params.parent_id);
      if (!parentTicket) {
        return { ticket: undefined, error: `Parent ticket '${params.parent_id}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
      }
      if (parentTicket.project_id !== project.id) {
        return { ticket: undefined, error: `Parent ticket '${params.parent_id}' is not in the same project`, errorCode: 'VALIDATION_ERROR', statusCode: 400 };
      }
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    const pc = new PermissionChecker(project.id, roleId);
    const columnSlug = pc.getColumnSlug(ticket.column_id);
    if (!columnSlug) {
      return { ticket: undefined, error: 'Ticket has invalid column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    const updatePermCheck = pc.checkPermission('update_ticket', columnSlug);
    if (!updatePermCheck.allowed) {
      return { ticket: undefined, error: updatePermCheck.reason || `Role ${roleId} cannot edit tickets in this column`, errorCode: 'PERMISSION_DENIED', statusCode: 403 };
    }

    const estimateValue = params.estimate !== undefined && params.estimate !== null
      ? String(params.estimate)
      : undefined;

    const parentId = params.parent_id !== undefined ? params.parent_id : undefined;

    const updated = updateTicketQuery(
      ticketId,
      params.title,
      params.description !== undefined ? unescapeNewlines(params.description) : undefined,
      params.labels,
      params.priority,
      estimateValue,
      parentId
    );

    if (!updated) {
      return { ticket: undefined, error: 'Failed to update ticket', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    ticketEvents.emit(TICKET_UPDATED, { ticket: updated, project_slug: projectSlug });

    return { ticket: updated };
  }

  /**
   * Move a ticket between columns.
   * This is the core business logic: validates transition, updates column,
   * sets closed_at for 'done', records status history, and adds a move comment.
   */
  static move(
    projectSlug: string,
    ticketId: number,
    toColumn: string,
    params: {
      comment?: string;
      role_id?: number;
    }
  ): MoveTicketResult {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: `Project '${projectSlug}' not found` };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: `Ticket '${ticketId}' not found` };
    }

    if (!toColumn || typeof toColumn !== 'string') {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: 'Target column slug is required', errorCode: 'VALIDATION_ERROR' };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    // Get from column slug
    const fromCol = getDb().prepare(
      'SELECT slug FROM kanban_columns WHERE id = ?'
    ).get(ticket.column_id) as { slug: string } | undefined;

    if (!fromCol) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: 'Ticket has invalid column' };
    }

    // Validate transition using engine
    const transitionResult = canTransitionEngine(project.id, fromCol.slug, toColumn, roleId);

    if (!transitionResult.allowed) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: transitionResult.error || 'Transition not allowed' };
    }

    if (transitionResult.requiresComment && !params.comment) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: 'Comment is required for this transition' };
    }

    // Get target column ID
    const toCol = getDb().prepare(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(project.id, toColumn) as { id: number } | undefined;

    if (!toCol) {
      return { success: false, ticket_id: ticketId, to_column: toColumn, error: `Column '${toColumn}' not found` };
    }

    // Check blockers for ALL transitions 
    // Only block forward transitions, not backward moves (allow devs to pull back for fixes)
    const fromColOrder = (getDb().prepare('SELECT "order" FROM kanban_columns WHERE id = ?').get(ticket.column_id) as { "order": number } | undefined)?.["order"] ?? 0;
    const toColOrder = (getDb().prepare('SELECT "order" FROM kanban_columns WHERE id = ?').get(toCol.id) as { "order": number } | undefined)?.["order"] ?? 0;
    if (toColOrder > fromColOrder && TicketService.isTicketBlocked(ticketId)) {
      const blockerIds = TicketService.getUnresolvedDependencyIds(ticketId);
      const blockerList = blockerIds.map((id) => `#${id}`).join(', ');
      return {
        success: false,
        ticket_id: ticketId,
        to_column: toColumn,
        error: `Cannot move blocked ticket: unresolved dependency(ies) blocking transition (blocked by ${blockerList}).`,
        blocker_ids: blockerIds,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    // Check entire_ticket_group validation (runs before closure validation for cascade transitions)
    if (transitionResult.entireTicketGroup) {
      if (ticket.parent_id !== null && fromColOrder <= toColOrder) {
        const parentColOrder = getDb().prepare<[number], number | null>('SELECT kanban_columns."order" FROM tickets JOIN kanban_columns ON kanban_columns.id = tickets.column_id WHERE tickets.id = ?').get(ticket.parent_id) ?? 0;
        if (parentColOrder <= fromColOrder) {
          return {
            success: false,
            ticket_id: ticketId,
            to_column: toColumn,
            error: `Entire-ticket-group transition failed: cannot move child tickets without their parent. Moving the parent ticket #${ticket.parent_id} will also move the child #${ticketId}. `,
            errorCode: 'CONFLICT',
            statusCode: 409,
          };
        }
      }

      // Entire-ticket-group path: validate group, cascade moves parent+children atomically,
      // THEN validate closure (children should be closed now)
      const groupCheck = TicketService.checkEntireTicketGroupMove(ticketId, toColumn, project.id);
      if (!groupCheck.valid) {
        return {
          success: false,
          ticket_id: ticketId,
          to_column: toColumn,
          error: groupCheck.error || 'Entire-ticket-group move validation failed',
          errorCode: (groupCheck as any).errorCode || 'CONFLICT',
          statusCode: (groupCheck as any).statusCode || 409,
        };
      }

      // Validate before cascade move (prevents partial mutations if validation fails)
      if (toColumn === COLUMNS.DONE) {
        const db = getDb();
        const sourceColId = ticket.column_id;

        // Children in the source column will be cascade-closed; children in other columns must already be closed
        const openNonSourceColumnChildIds = db.prepare<unknown[], { id: number }>(
          `SELECT id FROM tickets WHERE parent_id = ? AND column_id != ? AND closed_at IS NULL`
        ).all([ticketId, sourceColId]);

        if (openNonSourceColumnChildIds.length > 0) {
          const childList = openNonSourceColumnChildIds.map((c) => `#${c.id}`).join(', ');
          return {
            success: false,
            ticket_id: ticketId,
            to_column: toColumn,
            error: `Cannot close parent when children in other columns are not closed. Open child ticket(s): ${childList}.`,
            errorCode: 'CONFLICT',
            statusCode: 409,
          };
        }
      }

      // Capture tickets that were blocked only by this root BEFORE the move
      // (before the database state changes via the cascade)
      const cascadeBlockedBeforeIds = TicketService.getTicketsBlockedByRoot(ticketId, project.id);

      // Let the cascade handle the entire move (parent + all descendants) in one transaction
      const cascadeResult = TicketService.getCascadeMoveTicketGroup(ticketId, toCol.id, toColumn, roleId, params.comment);
      if (!cascadeResult.success) {
        return {
          success: false,
          ticket_id: ticketId,
          to_column: toColumn,
          error: cascadeResult.error || 'Cascade move failed',
          errorCode: 'INTERNAL_ERROR',
          statusCode: 500,
        };
      }

      ticketEvents.emit(TICKET_MOVED, { ticket_id: ticketId, from_column: fromCol.slug, to_column: toColumn, project_slug: projectSlug });

      // Calculate tickets that were unblocked by this cascade move
      // Cascade moves apply to top-level tickets, so ticketId is the root
      const ticketsUnblocked = TicketService.getTicketsUnblockedByCascadeMove(ticketId, cascadeBlockedBeforeIds, project.id);

      return { success: true, ticket_id: ticketId, to_column: toColumn, tickets_unblocked: ticketsUnblocked };
    }

    // Perform move (no cascade)
    const db = getDb();

    // Capture tickets that were blocked only by this ticket BEFORE the move
    const nonCascadeBlockedBeforeIds = TicketService.getTicketsBlockedOnlyBy(ticketId, project.id);

    // 1. Update ticket column
    db.prepare('UPDATE tickets SET column_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(toCol.id, ticketId);

    // 2. If moving to done: set closed_at
    const toColData = getDb().prepare(
      'SELECT slug FROM kanban_columns WHERE id = ?'
    ).get(toCol.id) as { slug: string } | undefined;

    if (toColData && toColData.slug === COLUMNS.DONE) {
      db.prepare('UPDATE tickets SET closed_at = datetime(\'now\') WHERE id = ?').run(ticketId);
    } else if (fromCol && fromCol.slug === COLUMNS.DONE) {
      db.prepare('UPDATE tickets SET closed_at = NULL WHERE id = ?').run(ticketId);
    }

    // 3. Insert status history
    const fromColId = ticket.column_id;
    addStatusHistory(ticketId, fromColId, toCol.id, roleId, null);

    // 4. Insert comment (action_type='move')
    const moveComment = params.comment || `Moved from '${fromCol.slug}' to '${toColumn}'`;
    addCommentQuery(ticketId, roleId, unescapeNewlines(moveComment), 'move');

    ticketEvents.emit(TICKET_MOVED, { ticket_id: ticketId, from_column: fromCol.slug, to_column: toColumn, project_slug: projectSlug });

    // Calculate tickets that were unblocked by this move
    const ticketsUnblocked = TicketService.getTicketsUnblockedByMove(ticketId, nonCascadeBlockedBeforeIds, project.id);

    return { success: true, ticket_id: ticketId, to_column: toColumn, tickets_unblocked: ticketsUnblocked };
  }

  /**
   * Add a comment to a ticket.
   */
  static addComment(
    projectSlug: string,
    ticketId: number,
    content: string,
    params: {
      role_id?: number;
    }
  ): { comment: EnrichedComment | undefined; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { comment: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { comment: undefined, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!content || typeof content !== 'string') {
      return { comment: undefined, error: 'Content is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;
    const comment = addCommentQuery(ticketId, roleId, unescapeNewlines(content));

    if (!comment) {
      return { comment: undefined, error: 'Failed to add comment', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    // Enrich comment with role name
    const db = getDb();
    const role = db.prepare<[number], { name: string }>(
      'SELECT name FROM roles WHERE id = ?'
    ).get(roleId);

    const enriched: EnrichedComment = {
      ...comment,
      author_role_name: role?.name ?? null,
    };

    ticketEvents.emit(TICKET_COMMENT_ADDED, { ticket_id: ticketId, comment: enriched, project_slug: projectSlug });

    return { comment: enriched };
  }

  /**
   * Update a comment on a ticket. Only the comment author can update their own comment.
   */
  static updateComment(
    projectSlug: string,
    ticketId: number,
    commentId: number,
    content: string,
    params: {
      role_id?: number;
    }
  ): { comment: EnrichedComment | undefined; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { comment: undefined, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { comment: undefined, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return { comment: undefined, error: 'Content is required and must be a non-empty string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const commentData = getCommentById(commentId);
    if (!commentData) {
      return { comment: undefined, error: `Comment '${commentId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (commentData.ticket_id !== ticketId) {
      return { comment: undefined, error: `Comment '${commentId}' does not belong to ticket '${ticketId}'`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    // Permission check: only the comment author can update, or Human User (role_id 1) can do anything
    const isAuthor = commentData.author_role_id === roleId;
    const isHumanUser = roleId === 1;

    if (!isAuthor && !isHumanUser) {
      return { comment: undefined, error: `Only the comment author can update this comment`, errorCode: 'PERMISSION_DENIED', statusCode: 403 };
    }

    const updated = updateCommentQuery(commentId, unescapeNewlines(content));

    if (!updated) {
      return { comment: undefined, error: 'Failed to update comment', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    // Enrich comment with role name
    const db = getDb();
    const role = db.prepare<[number], { name: string }>(
      'SELECT name FROM roles WHERE id = ?'
    ).get(roleId);

    const enriched: EnrichedComment = {
      ...updated,
      author_role_name: role?.name ?? null,
    };

    return { comment: enriched };
  }

  /**
   * Delete a comment on a ticket. Only the comment author can delete their own comment.
   */
  static deleteComment(
    projectSlug: string,
    ticketId: number,
    commentId: number,
    params: {
      role_id?: number;
    }
  ): { success: boolean; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { success: false, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const commentData = getCommentById(commentId);
    if (!commentData) {
      return { success: false, error: `Comment '${commentId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (commentData.ticket_id !== ticketId) {
      return { success: false, error: `Comment '${commentId}' does not belong to ticket '${ticketId}'`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    // Permission check: only the comment author can delete, or Human User (role_id 1) can do anything
    const isAuthor = commentData.author_role_id === roleId;
    const isHumanUser = roleId === 1;

    if (!isAuthor && !isHumanUser) {
      return { success: false, error: `Only the comment author can delete their own comment`, errorCode: 'PERMISSION_DENIED', statusCode: 403 };
    }

    const deleted = deleteCommentQuery(commentId);

    if (!deleted) {
      return { success: false, error: 'Failed to delete comment', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    return { success: true };
  }

  /**
   * Add a dependency between tickets.
   * 
   * Cycle Detection:
   * Uses Tarjan's Strongly Connected Components (SCC) algorithm to detect if adding
   * the dependency would create a cycle. If a cycle is detected, the dependency is
   * not added and an error is returned.
   * 
   * Parent-Child Detection:
   * Uses the `ticket_roots` SQL view to detect if the dependency would create a
   * child→parent or ancestor→descendant relationship (which is always invalid).
   */
  static addDependency(
    projectSlug: string,
    ticketId: number,
    dependsOnId: number,
    relationType: string
  ): { success: boolean; ticket_id: number; depends_on_id: number; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const depTicket = getTicketById(dependsOnId);
    if (!depTicket || depTicket.project_id !== project.id) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: `Dependency ticket '${dependsOnId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    if (ticketId === dependsOnId) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: 'Ticket cannot depend on itself', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    // Check for cycle using Tarjan's algorithm before adding the dependency
    if (TicketService.wouldCreateCycle(project.id, ticketId, dependsOnId)) {
      return {
        success: false,
        ticket_id: ticketId,
        depends_on_id: dependsOnId,
        error: `Adding dependency from #${ticketId} to #${dependsOnId} would create a circular dependency`,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    // Check for parent-child/ancestor-descendant relationship using ticket_roots view
    if (TicketService.isParentChildDependency(ticketId, dependsOnId, project.id)) {
      return {
        success: false,
        ticket_id: ticketId,
        depends_on_id: dependsOnId,
        error: `Cannot create dependency between related tickets: #${ticketId} and #${dependsOnId} are in the same ticket hierarchy`,
        errorCode: 'CONFLICT',
        statusCode: 409,
      };
    }

    const added = addDependencyQuery(ticketId, dependsOnId, relationType);

    if (!added) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: 'Failed to add dependency (may already exist)', errorCode: 'CONFLICT', statusCode: 409 };
    }

    ticketEvents.emit(TICKET_DEPENDENCY_ADDED, { ticket_id: ticketId, depends_on_id: dependsOnId, relation_type: relationType, project_slug: projectSlug });

    return { success: true, ticket_id: ticketId, depends_on_id: dependsOnId };
  }

  /**
   * Check if adding a dependency would create a cycle using Tarjan's SCC algorithm.
   * 
   * Builds a directed graph from all dependencies in the project, then finds all
   * strongly connected components. If ticketId and dependsOnId would end up in the
   * same SCC (with size > 1), adding the edge creates a cycle.
   */
  private static wouldCreateCycle(projectId: number, ticketId: number, dependsOnId: number): boolean {
    const db = getDb();

    // Get all dependencies in the project (excluding the one being added, if it exists)
    const deps = db.prepare<[number, number], { ticket_id: number; depends_on_id: number }>(
      `SELECT DISTINCT ticket_id, depends_on_id FROM ticket_dependencies
         WHERE ticket_id IN (
           SELECT id FROM tickets WHERE project_id = ?
           UNION
           SELECT id FROM tickets WHERE project_id = ?
         )`
    ).all(projectId, projectId);

    // Build adjacency list: ticket_id -> [depends_on_id, ...]
    const adj = new Map<number, number[]>();
    for (const d of deps) {
      if (!adj.has(d.ticket_id)) adj.set(d.ticket_id, []);
      adj.get(d.ticket_id)!.push(d.depends_on_id);
    }

    // Add the prospective edge (ticketId -> dependsOnId)
    if (!adj.has(ticketId)) adj.set(ticketId, []);
    adj.get(ticketId)!.push(dependsOnId);

    // Run Tarjan's SCC algorithm on the graph
    const indices: Map<number, number> = new Map();
    const lowlinks: Map<number, number> = new Map();
    const onStack: Set<number> = new Set();
    const stack: number[] = [];
    let indexCounter = 0;
    let hasCycle = false;

    function strongConnect(v: number): void {
      indices.set(v, indexCounter);
      lowlinks.set(v, indexCounter);
      indexCounter++;
      stack.push(v);
      onStack.add(v);

      const neighbors = adj.get(v) ?? [];
      for (const w of neighbors) {
        if (!indices.has(w)) {
          // w has not been visited
          strongConnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          // w is on the stack, so it's in the current SCC
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }

      // If v is a root node, pop the SCC
      if (lowlinks.get(v) === indices.get(v)) {
        let sccSize = 0;
        while (true) {
          const w = stack.pop()!;
          onStack.delete(w);
          sccSize++;
          if (w === v) break;
        }
        // SCC with size > 1 means there's a cycle
        if (sccSize > 1) {
          hasCycle = true;
        }
      }
    }

    // Run Tarjan's from both endpoints (they might not be reachable from each other yet)
    if (!indices.has(ticketId)) strongConnect(ticketId);
    if (hasCycle) return true;
    if (!indices.has(dependsOnId)) strongConnect(dependsOnId);

    return hasCycle;
  }

  /**
   * Check if the dependency would create a parent-child or ancestor-descendant relationship.
   * Uses the `ticket_roots` SQL view to determine if two tickets are in the same hierarchy.
   * 
   * A parent-child/ancestor-descendant dependency is always invalid because:
   * - A child should not depend on its parent (the parent's status controls the child)
   * - A parent should not depend on its child (circular hierarchy)
   */
  private static isParentChildDependency(ticketId: number, dependsOnId: number, projectId: number): boolean {
    const db = getDb();

    // Check if both tickets are in the same hierarchy tree using ticket_roots view
    // The view maps each ticket to its root ancestor
    const rows = db.prepare<[number, number], { ticket_id: number; root_id: number }>(
      `SELECT DISTINCT ticket_id, root_id FROM ticket_roots
       WHERE ticket_id IN (?, ?)`
    ).all(ticketId, dependsOnId) as { ticket_id: number; root_id: number }[];

    // Group by root_id to check if both tickets share the same root
    const rootsByTicket = new Map<number, number>();
    for (const row of rows) {
      rootsByTicket.set(row.ticket_id, row.root_id);
    }

    // If both tickets have the same root, they're in the same hierarchy
    const ticketRoot = rootsByTicket.get(ticketId);
    const depRoot = rootsByTicket.get(dependsOnId);

    if (ticketRoot !== undefined && depRoot !== undefined && ticketRoot === depRoot) {
      // They share the same root — check the hierarchical relationship
      // Check if ticketId is an ancestor of dependsOnId (ticketId appears as parent_id in the chain from dependsOnId to root)
      const isDescendantOf = db.prepare<[number, number]>(
        `SELECT COUNT(*) as cnt FROM ticket_roots
          WHERE ticket_id = ? AND root_id = ?`
      ).get(ticketId, dependsOnId) as { cnt: number };

      // Check if dependsOnId is an ancestor of ticketId (dependsOnId appears as parent_id in the chain from ticketId to root)
      const isAncestorOf = db.prepare<[number, number]>(
        `SELECT COUNT(*) as cnt FROM ticket_roots
          WHERE ticket_id = ? AND root_id = ?`
      ).get(dependsOnId, ticketId) as { cnt: number };

      // If ticketId is an ancestor of dependsOnId, dependsOnId is a descendant -> invalid
      // If dependsOnId is an ancestor of ticketId, ticketId is a descendant -> invalid
      return isDescendantOf.cnt > 0 || isAncestorOf.cnt > 0;
    }

    return false;
  }

  /**
   * Remove a dependency between tickets.
   */
  static removeDependency(
    projectSlug: string,
    ticketId: number,
    dependsOnId: number,
    relationType: string
  ): { success: boolean; ticket_id: number; depends_on_id: number; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { success: false, ticket_id: ticketId, depends_on_id: dependsOnId, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    removeDependencyQuery(ticketId, dependsOnId, relationType);

    ticketEvents.emit(TICKET_DEPENDENCY_REMOVED, { ticket_id: ticketId, depends_on_id: dependsOnId, relation_type: relationType, project_slug: projectSlug });

    return { success: true, ticket_id: ticketId, depends_on_id: dependsOnId };
  }

  /**
    * Delete a ticket with permission checking.
   */
  static remove(
    projectSlug: string,
    ticketId: number,
    params: {
      role_id?: number;
    }
  ): { success: boolean; ticket_id: number; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { success: false, ticket_id: ticketId, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { success: false, ticket_id: ticketId, error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const roleId = params.role_id ?? getFallbackRoleId() ?? 0;

    const pc = new PermissionChecker(project.id, roleId);
    const deleteColumnSlug = pc.getColumnSlug(ticket.column_id);
    if (!deleteColumnSlug) {
      return { success: false, ticket_id: ticketId, error: 'Ticket has invalid column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    const deletePermCheck = pc.checkPermission('delete_ticket', deleteColumnSlug);
    if (!deletePermCheck.allowed) {
      return { success: false, ticket_id: ticketId, error: deletePermCheck.reason || `Role ${roleId} cannot delete tickets in this column`, errorCode: 'PERMISSION_DENIED', statusCode: 403 };
    }

    const deleted = deleteTicketQuery(ticketId);

    if (!deleted) {
      return { success: false, ticket_id: ticketId, error: 'Failed to delete ticket', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    ticketEvents.emit(TICKET_DELETED, { ticket_id: ticketId, project_slug: projectSlug });

    return { success: true, ticket_id: ticketId };
  }

  /**
     * Get allowed transitions for a ticket.
     */
  static getTransitions(projectSlug: string, ticketId: number): {
    transitions: { toColumnSlug: string; requiresComment: boolean }[];
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { transitions: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { transitions: [], error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const fromCol = getDb().prepare(
      'SELECT slug FROM kanban_columns WHERE id = ?'
    ).get(ticket.column_id) as { slug: string } | undefined;

    if (!fromCol) {
      return { transitions: [], error: 'Ticket has invalid column', errorCode: 'INTERNAL_ERROR', statusCode: 500 };
    }

    const roleId = getFallbackRoleId() ?? 0;
    const transitions = getAllowedTransitionsEngine(project.id, fromCol.slug, roleId);

    return { transitions };
  }

  /**
     * List tickets with optional filters and pagination.
      */
  static list(
    projectSlug: string,
    params: {
      column?: string;
      priority?: number;
      labels?: string;
      parent_id?: number;
      page?: number;
      per_page?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      all_tickets?: boolean;
      done_limit?: number;
      filterBlocked?: boolean;
      include_closed?: boolean;
    }
  ): { tickets: TicketRow[]; total: number; done_total?: number; error?: string; errorCode?: string; statusCode?: number } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { tickets: [], total: 0, error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    let perPage = params.per_page ?? 20;
    let sortBy = params.sort_by ?? 'created_at';
    let sortOrder = (params.sort_order ?? 'desc') as 'asc' | 'desc';

    // Apply all_tickets logic
    if (params.all_tickets) {
      if (params.column === COLUMNS.DONE) {
        perPage = params.done_limit ?? 8;
        sortBy = 'updated_at';
        sortOrder = 'desc';
      } else if (!params.column) {
        // No column filter: fetch non-done + limited done separately
        const nonDonePerPage = 1000;
        const allTicketsResult = getTicketsByProject(
          project.id, undefined, params.priority, params.labels, params.parent_id,
          1, nonDonePerPage, sortBy, sortOrder
        );
        let nonDoneTickets = allTicketsResult.tickets.filter((t: TicketRow) => t.column_slug !== COLUMNS.DONE);

        const doneResult = getTicketsByProject(
          project.id, COLUMNS.DONE, undefined, undefined, undefined,
          1, params.done_limit ?? 8, 'updated_at', 'desc'
        );
        let doneTickets = doneResult.tickets;

        // Apply include_closed filter to both non-done and done tickets
        if (params.include_closed === false) {
          nonDoneTickets = nonDoneTickets.filter((t: TicketRow) => t.closed_at === null);
          doneTickets = doneTickets.filter((t: TicketRow) => t.closed_at === null);
        }

        const filteredTotal = params.include_closed === false
          ? nonDoneTickets.length + doneTickets.length
          : nonDoneTickets.length + doneResult.total;

        return {
          tickets: [...nonDoneTickets, ...doneTickets],
          total: filteredTotal,
          done_total: doneResult.total,
        };
      } else {
        perPage = 1000;
      }
    }

    // Handle filterBlocked for list() — use EXISTS subquery via ticket_blockers view
    if (params.filterBlocked) {
      const filteredResult = this.getTicketsWithFilter(project.id, {
        column: params.column,
        priority: params.priority,
        labels: params.labels,
        page: params.page ?? 1,
        per_page: params.per_page ?? 20,
        sort_by: sortBy,
        sort_order: sortOrder,
      });
      return { tickets: filteredResult.tickets, total: filteredResult.total };
    }

    // Enforce max per_page of 1000
    perPage = Math.min(perPage, 1000);

    const result = getTicketsByProject(
      project.id,
      params.column,
      params.priority,
      params.labels,
      params.parent_id,
      params.page ?? 1,
      perPage,
      sortBy,
      sortOrder
    );

    // Filter by include_closed if specified (closed_at IS NULL = open)
    let tickets = result.tickets;
    let total = result.total;
    if (params.include_closed === false) {
      tickets = tickets.filter((t: TicketRow) => t.closed_at === null);
      total = tickets.length;
    }

    return { tickets, total };
  }

  /**
      * Get dependencies for a ticket.
      */
  static getDependencies(projectSlug: string, ticketId: number): {
    dependencies: DependencyRow[];
    error?: string;
    errorCode?: string;
    statusCode?: number;
  } {
    const project = getProjectBySlug(projectSlug);
    if (!project) {
      return { dependencies: [], error: `Project '${projectSlug}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket || ticket.project_id !== project.id) {
      return { dependencies: [], error: `Ticket '${ticketId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const dependencies = getDependencies(ticketId);
    return { dependencies };
  }

  /**
     * Check if an entire-ticket-group move is valid for a ticket.
     * Returns valid=true if all group move requirements are met.
     * Returns valid=false with error details if not.
     */
  static checkEntireTicketGroupMove(
    ticketId: number,
    targetColumnSlug: string,
    projectId: number
  ): { valid: true } | { valid: false; error: string; errorCode: string; statusCode: number; ticketIds: number[] } {
    const db = getDb();

    // Get the target column ID
    const targetCol = db.prepare<[string, number], { id: number }>(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(targetColumnSlug, projectId);

    if (!targetCol) {
      return {
        valid: false,
        error: `Column '${targetColumnSlug}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
        ticketIds: [],
      };
    }

    // Get any transition from the ticket's current column to the target column
    // that has entire_ticket_group=true
    const currentColumnId = db.prepare<[number], { column_id: number }>(
      'SELECT column_id FROM tickets WHERE id = ?'
    ).get(ticketId);

    if (!currentColumnId) {
      return {
        valid: false,
        error: `Ticket '${ticketId}' not found`,
        errorCode: 'NOT_FOUND',
        statusCode: 404,
        ticketIds: [],
      };
    }

    const matchingTransition = db.prepare<[number, number, number]>(
      'SELECT id FROM workflow_transitions WHERE project_id = ? AND column_from = ? AND column_to = ? AND entire_ticket_group = 1'
    ).get(projectId, currentColumnId.column_id, targetCol.id);

    if (!matchingTransition) {
      // No entire-ticket-group transition defined — not applicable
      return { valid: true };
    }

    // Run validation query
    const validationError = getDescendantsBlockedByGroup(ticketId, targetCol.id, projectId);

    if (validationError) {
      return {
        valid: false,
        error: validationError.reason,
        errorCode: 'CONFLICT',
        statusCode: 409,
        ticketIds: validationError.ticket_ids,
      };
    }

    return { valid: true };
  }

  /**
     * Internal method to move a single ticket (used for cascade operations).
     * Bypasses top-level-only check and closure validation.
     */
  private static transitionChild(
    ticketId: number,
    targetColumnId: number,
    targetColumnSlug: string,
    roleId: number,
    comment: string
  ): void {
    const db = getDb();

    const currentCol = db.prepare<[number], { column_id: number }>(
      'SELECT column_id FROM tickets WHERE id = ?'
    ).get(ticketId);

    const fromColId = currentCol?.column_id ?? 0;

    // Always update column and closed_at (no early return — ensures atomic behavior)
    db.prepare(
      'UPDATE tickets SET column_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(targetColumnId, ticketId);

    if (targetColumnSlug === COLUMNS.DONE) {
      db.prepare(
        'UPDATE tickets SET closed_at = datetime(\'now\') WHERE id = ?'
      ).run(ticketId);
    }

    addStatusHistory(ticketId, fromColId, targetColumnId, roleId, null);
    addCommentQuery(ticketId, roleId, comment, 'move');
  }

  /**
   * Atomically move a ticket and ALL its descendants to the target column.
   * Only cascades descendants in the SAME column as the parent.
   * For done transitions, cascades bottom-up (deepest descendants first).
   * Uses a database transaction for atomicity.
   */
  static getCascadeMoveTicketGroup(
    ticketId: number,
    targetColumnId: number,
    targetColumnSlug: string,
    roleId: number,
    comment?: string
  ): { success: boolean; moved_count: number; error?: string } {
    const db = getDb();

    // Get the parent's current column
    const parent = db.prepare<[number], { column_id: number }>(
      'SELECT column_id FROM tickets WHERE id = ?'
    ).get(ticketId);

    if (!parent) {
      return { success: false, moved_count: 0, error: 'Parent ticket not found' };
    }

    const parentColumnId = parent.column_id;

    // Get all descendants in the SAME column as the parent, with depth for bottom-up ordering
    const groupTickets = db.prepare<[number, number, number], { id: number; depth: number }>(
      `WITH RECURSIVE ticket_tree(id, depth, col_id) AS (
            SELECT id, 0, column_id FROM tickets WHERE id = ?
            UNION ALL
            SELECT t.id, tt.depth + 1, t.column_id FROM tickets t
            JOIN ticket_tree tt ON t.parent_id = tt.id
          )
          SELECT id, depth FROM ticket_tree
          WHERE id != ?
            AND col_id = ?
          ORDER BY depth DESC`
    ).all(ticketId, ticketId, parentColumnId) as { id: number; depth: number }[];

    const ticketIds = [ticketId, ...groupTickets.map(t => t.id)];

    try {
      withTransaction(db, () => {
        // Cascade children first (bottom-up, already sorted DESC by depth)
        for (const child of groupTickets) {
          TicketService.transitionChild(child.id, targetColumnId, targetColumnSlug, roleId, comment || 'Moved by cascade');
        }

        // Then move the parent
        TicketService.transitionChild(ticketId, targetColumnId, targetColumnSlug, roleId, comment || 'Moved by cascade');
      });
      return { success: true, moved_count: ticketIds.length };
    } catch (err) {
      return { success: false, moved_count: 0, error: `Cascade failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Get open child ticket IDs for a parent ticket.
   * Returns IDs of children that have closed_at IS NULL.
   */
  static getOpenChildTicketIds(parentId: number): number[] {
    const db = getDb();
    const rows = db.prepare<number, { id: number }>(
      'SELECT id FROM tickets WHERE parent_id = ? AND closed_at IS NULL'
    ).all(parentId);
    return rows.map((r) => r.id);
  }

  /**
     * Get unresolved dependency ticket IDs for a ticket.
     * Uses the ticket_blockers view which covers both direct dependencies
     * and entire-ticket-group violations.
     */
  static getUnresolvedDependencyIds(ticketId: number): number[] {
    const db = getDb();
    const rows = db.prepare<number, { depends_on_id: number }>(
      'SELECT depends_on_id FROM ticket_blockers WHERE ticket_id = ?'
    ).all(ticketId);
    return rows.map((r) => r.depends_on_id);
  }

  /**
      * Get blocked ticket IDs for a project (tickets with unresolved blocked_by dependencies
      * AND tickets with entire-ticket-group violations).
      * Uses the ticket_blockers view for a unified, simplified query.
      */
  static getBlockedTicketIds(projectId: number): number[] {
    const db = getDb();
    const rows = db.prepare<number, { ticket_id: number }>(
      'SELECT DISTINCT ticket_id FROM ticket_blockers WHERE project_id = ?'
    ).all(projectId);
    return rows.map((r) => r.ticket_id);
  }

  /**
      * Get the most critical next ticket IDs for a project.
      * Uses the `most_critical_tickets` SQL view which ranks open tickets by
      * blocker proximity, inherited priority, and blocker count.
      * Returns at most 3 ticket IDs in criticality order.
      */
  static getMostCriticalTickets(projectId: number): number[] {
    return getMostCriticalTickets(projectId);
  }

  /**
   * Get top-level ticket IDs (no parent) for a project.
   */
  static getTopLevelTicketIds(projectId: number): number[] {
    const db = getDb();
    const rows = db.prepare<number, { id: number }>(
      'SELECT id FROM tickets WHERE project_id = ? AND parent_id IS NULL'
    ).all(projectId);
    return rows.map((r) => r.id);
  }

  /**
          * Check if a ticket is blocked by any unresolved dependency.
          * Uses the ticket_blockers view which covers both direct dependencies
          * and entire-ticket-group violations.
          */
  static isTicketBlocked(ticketId: number): boolean {
    const db = getDb();
    const row = db.prepare<number, { ticket_id: number }>(
      'SELECT ticket_id FROM ticket_blockers WHERE ticket_id = ? LIMIT 1'
    ).get(ticketId);
    return !!row;
  }

  /**
      * Get tickets blocked ONLY by the given blocker.
      *
      * Uses the ticket_blockers view. A ticket is blocked only by the given blocker if:
      * - It has the given blocker
      * - It has NO other blockers
      */
  private static getTicketsBlockedOnlyBy(blockerId: number, projectId: number): number[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT DISTINCT tb.ticket_id
          FROM ticket_blockers tb
          WHERE tb.depends_on_id = ?
            AND tb.project_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM ticket_blockers tb2
              WHERE tb2.ticket_id = tb.ticket_id
                AND tb2.depends_on_id != ?
            )`
    ).all(blockerId, projectId, blockerId) as { ticket_id: number }[];
    return rows.map((r) => r.ticket_id);
  }

  /**
   * Get tickets blocked ONLY by dependencies belonging to the given root ID.
   *
   * Uses the ticket_blockers view joined with ticket_roots. A ticket is
   * blocked only by the given root if:
   * - It has at least one blocker whose root matches the given root
   * - It has NO blockers whose root is outside the given root
   */
  private static getTicketsBlockedByRoot(rootId: number, projectId: number): number[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT DISTINCT tb.ticket_id
         FROM ticket_blockers tb
         JOIN ticket_roots blockerRoot ON blockerRoot.ticket_id = tb.depends_on_id
         WHERE blockerRoot.root_id = ?
           AND tb.project_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM ticket_blockers tb2
             JOIN ticket_roots tb2Root ON tb2Root.ticket_id = tb2.depends_on_id
             WHERE tb2.ticket_id = tb.ticket_id
               AND tb2Root.root_id != ?
           )`
    ).all(rootId, projectId, rootId) as { ticket_id: number }[];
    return rows.map((r) => r.ticket_id);
  }

  /**
       * Get tickets that were unblocked by moving a single ticket.
       *
       * @param blockerId The ID of the ticket that was moved
       * @param blockedBeforeIds List of ticket IDs that were blocked only by the blocker (captured before the move)
       * @param projectId The project ID for filtering
       * @returns List of ticket IDs that were unblocked by the move
       */
  static getTicketsUnblockedByMove(blockerId: number, blockedBeforeIds: number[], projectId: number): number[] {
    if (blockedBeforeIds.length === 0) {
      return [];
    }

    // After the move (column/closed_at updated), check which tickets are
    // still blocked only by the same blocker using the ticket_blockers view
    const blockedAfter = TicketService.getTicketsBlockedOnlyBy(blockerId, projectId);

    // Tickets that were unblocked: in blockedBeforeIds but not in blockedAfter
    const blockedAfterSet = new Set(blockedAfter);
    const unblocked: number[] = [];
    for (const id of blockedBeforeIds) {
      if (!blockedAfterSet.has(id)) {
        unblocked.push(id);
      }
    }

    return unblocked;
  }

  /**
    * Get tickets that were unblocked by a cascade move of a root ticket.
    *
    * Uses the ticket_roots view to determine that tickets blocked by dependencies
    * within the moved root's hierarchy are unblocked, rather than passing individual
    * cascade ticket IDs.
    *
    * @param rootId The root (top-level) ticket ID that was cascade-moved
    * @param blockedBeforeIds List of ticket IDs that were blocked only by the root's hierarchy (captured before the move)
    * @param projectId The project ID for filtering
    * @returns List of ticket IDs that were unblocked by the cascade move
    */
  static getTicketsUnblockedByCascadeMove(rootId: number, blockedBeforeIds: number[], projectId: number): number[] {
    if (blockedBeforeIds.length === 0) {
      return [];
    }

    // After the move: query the ticket_blockers view for tickets still blocked
    // only by dependencies in this root's hierarchy
    const blockedAfter = TicketService.getTicketsBlockedByRoot(rootId, projectId);

    // Tickets that were unblocked: in blockedBeforeIds but not in blockedAfter
    const blockedAfterSet = new Set(blockedAfter);
    const unblocked: number[] = [];
    for (const id of blockedBeforeIds) {
      if (!blockedAfterSet.has(id)) {
        unblocked.push(id);
      }
    }

    return unblocked;
  }

  /**
   * Get non-closed ticket IDs for a specific column that are not in the done column.
   */
  static getNonClosedColumnTicketIds(projectId: number, columnSlugs: string | string[]): number[] {
    const db = getDb();
    const slugs = Array.isArray(columnSlugs) ? columnSlugs : [columnSlugs];
    const doneCol = db.prepare<[string, number], { id: number }>(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(COLUMNS.DONE, projectId);

    if (!doneCol) return [];

    const placeholders = slugs.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT t.id FROM tickets t
        WHERE t.project_id = ? AND t.column_id != ?
        AND t.column_id IN (SELECT id FROM kanban_columns WHERE slug IN (${placeholders}) AND project_id = ?)
       `
    ).all(projectId, doneCol.id, ...slugs, projectId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  /**
    * Get all ticket IDs (including closed) for a specific column.
    */
  static getAllColumnTicketIds(projectId: number, columnSlugs: string | string[]): number[] {
    const db = getDb();
    const slugs = Array.isArray(columnSlugs) ? columnSlugs : [columnSlugs];
    const placeholders = slugs.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT t.id FROM tickets t
         WHERE t.project_id = ?
         AND t.column_id IN (SELECT id FROM kanban_columns WHERE slug IN (${placeholders}) AND project_id = ?)
        `
    ).all(projectId, ...slugs, projectId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  /**
   * Get tickets by mode with optional filters.
   */
  static listByMode(
    projectId: number,
    mode: TicketListMode,
    params: {
      column?: string;
      priority?: number;
      labels?: string;
      ticket_ids?: number[];
      page?: number;
      per_page?: number;
      all_tickets?: boolean;
      done_limit?: number;
      include_closed?: boolean;
    }
  ): { tickets: TicketRow[]; total: number; done_total?: number } {
    const db = getDb();

    if (mode === 'todo-list' && params.ticket_ids) {
      // Filter by pre-computed ticket IDs (already excludes blocked tickets)
      // Also exclude closed tickets and human_feedback column as per requirement
      const placeholders = params.ticket_ids.map(() => '?').join(',');
      const notFeedbackCol = db.prepare<[string, number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
      ).get(COLUMNS.HUMAN_FEEDBACK, projectId);

      // include_closed: when true, include closed tickets; when false/null, exclude them (default)
      const includeClosed = params.include_closed ?? false;

      let baseQuery = `
        SELECT t.*, kc.slug as column_slug
        FROM tickets t
        JOIN kanban_columns kc ON t.column_id = kc.id
        WHERE t.project_id = ?
          AND t.id IN (${placeholders})
      `;
      const params_list: unknown[] = [projectId, ...(params.ticket_ids as unknown[])];

      // Exclude closed tickets (unless include_closed is true)
      if (!includeClosed) {
        baseQuery += ' AND t.closed_at IS NULL';
      }

      // Exclude human_feedback column
      if (notFeedbackCol) {
        baseQuery += ' AND t.column_id != ?';
        params_list.push(notFeedbackCol.id);
      }

      // Apply priority filter
      if (params.priority) {
        baseQuery += ' AND t.priority = ?';
        params_list.push(params.priority);
      }

      // Apply labels filter
      if (params.labels) {
        const labelList = params.labels.split(',').map((l) => l.trim()).filter((l) => l);
        if (labelList.length > 0) {
          const labelConditions = labelList.map(() => `t.labels LIKE ?`).join(' OR ');
          baseQuery += ` AND (${labelConditions})`;
          for (const label of labelList) {
            params_list.push(`%${label}%`);
          }
        }
      }

      baseQuery += ' ORDER BY t.priority DESC, t.created_at ASC';

      // Apply pagination
      const page = params.page ?? 1;
      const perPage = params.per_page ?? 20;
      const offset = (page - 1) * perPage;
      baseQuery += ' LIMIT ? OFFSET ?';
      params_list.push(perPage, offset);

      const tickets = db.prepare<unknown[]>(baseQuery).all(...params_list) as TicketRow[];

      // Get total count (without pagination)
      let countQuery = `
        SELECT COUNT(*) as total
        FROM tickets t
        WHERE t.project_id = ?
          AND t.id IN (${placeholders})
      `;
      const countParams: unknown[] = [projectId, ...(params.ticket_ids as unknown[])];

      if (!includeClosed) {
        countQuery += ' AND t.closed_at IS NULL';
      }

      if (notFeedbackCol) {
        countQuery += ' AND t.column_id != ?';
        countParams.push(notFeedbackCol.id);
      }

      if (params.priority) {
        countQuery += ' AND t.priority = ?';
        countParams.push(params.priority);
      }

      if (params.labels) {
        const labelList = params.labels.split(',').map((l) => l.trim()).filter((l) => l);
        if (labelList.length > 0) {
          const labelConditions = labelList.map(() => `t.labels LIKE ?`).join(' OR ');
          countQuery += ` AND (${labelConditions})`;
          for (const label of labelList) {
            countParams.push(`%${label}%`);
          }
        }
      }

      const countResult = db.prepare<unknown[], { total: number }>(countQuery).get(...countParams)!;

      return { tickets, total: countResult.total };
    }

    if (mode === 'not-blocked') {
      // Use database-level filtering with EXISTS subquery via ticket_blockers view
      // This is more efficient than fetching all tickets and filtering in memory
      const includeClosed = params.include_closed ?? false;

      const notDoneCol = includeClosed
        ? null
        : db.prepare<[string, number], { id: number }>(
          'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
        ).get(COLUMNS.DONE, projectId);

      const notFeedbackCol = db.prepare<[string, number], { id: number }>(
        'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
      ).get(COLUMNS.HUMAN_FEEDBACK, projectId);

      let baseQuery = `
        SELECT t.*, kc.slug as column_slug
        FROM tickets t
        JOIN kanban_columns kc ON t.column_id = kc.id
        WHERE t.project_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ticket_blockers tb WHERE tb.ticket_id = t.id
          )
      `;
      const params_list: unknown[] = [projectId];

      // Exclude closed tickets (unless include_closed is true)
      if (!includeClosed) {
        baseQuery += ' AND t.closed_at IS NULL';
      }

      // Exclude done column
      if (notDoneCol) {
        baseQuery += ' AND t.column_id != ?';
        params_list.push(notDoneCol.id);
      }

      // Exclude human_feedback column
      if (notFeedbackCol) {
        baseQuery += ' AND t.column_id != ?';
        params_list.push(notFeedbackCol.id);
      }

      if (params.column) {
        baseQuery += ' AND t.column_id = (SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?)';
        params_list.push(params.column, projectId);
      }

      if (params.priority) {
        baseQuery += ' AND t.priority = ?';
        params_list.push(params.priority);
      }

      if (params.labels) {
        baseQuery += ' AND t.labels LIKE ?';
        params_list.push(`%${params.labels}%`);
      }

      baseQuery += ' ORDER BY t.priority DESC, t.created_at ASC';

      const page = params.page ?? 1;
      const perPage = params.per_page ?? 20;
      const offset = (page - 1) * perPage;
      baseQuery += ' LIMIT ? OFFSET ?';
      params_list.push(perPage, offset);

      const tickets = db.prepare<unknown[]>(baseQuery).all(...params_list) as TicketRow[];

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total
        FROM tickets t
        WHERE t.project_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ticket_blockers tb WHERE tb.ticket_id = t.id
          )
      `;
      const countParams: unknown[] = [projectId];

      if (!includeClosed) {
        countQuery += ' AND t.closed_at IS NULL';
      }

      if (notDoneCol) {
        countQuery += ' AND t.column_id != ?';
        countParams.push(notDoneCol.id);
      }

      if (notFeedbackCol) {
        countQuery += ' AND t.column_id != ?';
        countParams.push(notFeedbackCol.id);
      }

      if (params.column) {
        countQuery += ' AND t.column_id = (SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?)';
        countParams.push(params.column, projectId);
      }

      if (params.priority) {
        countQuery += ' AND t.priority = ?';
        countParams.push(params.priority);
      }

      if (params.labels) {
        countQuery += ' AND t.labels LIKE ?';
        countParams.push(`%${params.labels}%`);
      }

      const countResult = db.prepare<unknown[], { total: number }>(countQuery).get(...countParams)!;

      return { tickets, total: countResult.total };
    }

    if (mode === 'top-level-tickets') {
      const includeClosed = params.include_closed ?? false;

      const topLevelIds = TicketService.getTopLevelTicketIds(projectId);

      if (topLevelIds.length === 0) {
        return { tickets: [], total: 0 };
      }

      const placeholders = topLevelIds.map(() => '?').join(',');
      let baseQuery = `SELECT t.*, kc.slug as column_slug FROM tickets t JOIN kanban_columns kc ON t.column_id = kc.id WHERE t.project_id = ? AND t.id IN (${placeholders})`;
      const params_list: unknown[] = [projectId, ...topLevelIds];

      // Exclude closed tickets (unless include_closed is true)
      if (!includeClosed) {
        baseQuery += ' AND t.closed_at IS NULL';
      }

      if (params.column) {
        baseQuery += ' AND t.column_id = (SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?)';
        params_list.push(params.column, projectId);
      }

      if (params.priority) {
        baseQuery += ' AND t.priority = ?';
        params_list.push(params.priority);
      }

      if (params.labels) {
        baseQuery += ' AND t.labels LIKE ?';
        params_list.push(`%${params.labels}%`);
      }

      const allTickets = db.prepare<unknown[]>(baseQuery).all(...params_list) as TicketRow[];

      // Apply pagination
      const page = params.page ?? 1;
      const perPage = params.per_page ?? 20;
      const start = (page - 1) * perPage;
      const end = start + perPage;

      return { tickets: allTickets.slice(start, end), total: allTickets.length };
    }

    let allTicketsPerPage = params.per_page ?? 20;
    let allTicketsSortBy = 'created_at';
    let allTicketsSortOrder: 'asc' | 'desc' = 'desc';

    // Apply all_tickets logic for the 'all' mode fallback
    if (params.all_tickets) {
      if (params.column === COLUMNS.DONE) {
        allTicketsPerPage = params.done_limit ?? 8;
        allTicketsSortBy = 'updated_at';
        allTicketsSortOrder = 'desc';
      } else if (!params.column) {
        // No column filter: fetch non-done + limited done separately
        const nonDonePerPage = 1000;
        const allTicketsResult = getTicketsByProject(
          projectId, undefined, params.priority, params.labels, undefined,
          1, nonDonePerPage, allTicketsSortBy, allTicketsSortOrder
        );
        let nonDoneTickets = allTicketsResult.tickets.filter((t: TicketRow) => t.column_slug !== COLUMNS.DONE);

        const doneResult = getTicketsByProject(
          projectId, COLUMNS.DONE, undefined, undefined, undefined,
          1, params.done_limit ?? 8, 'updated_at', 'desc'
        );
        let doneTickets = doneResult.tickets;

        // Apply include_closed filter to both non-done and done tickets
        if (params.include_closed === false) {
          nonDoneTickets = nonDoneTickets.filter((t: TicketRow) => t.closed_at === null);
          doneTickets = doneTickets.filter((t: TicketRow) => t.closed_at === null);
        }

        const filteredTotal = params.include_closed === false
          ? nonDoneTickets.length + doneTickets.length
          : nonDoneTickets.length + doneResult.total;

        return {
          tickets: [...nonDoneTickets, ...doneTickets],
          total: filteredTotal,
          done_total: doneResult.total,
        };
      } else {
        allTicketsPerPage = 1000;
      }
    }

    // Enforce max per_page of 1000
    allTicketsPerPage = Math.min(allTicketsPerPage, 1000);

    const result = getTicketsByProject(
      projectId,
      params.column,
      params.priority,
      params.labels,
      undefined,
      params.page ?? 1,
      allTicketsPerPage,
      allTicketsSortBy,
      allTicketsSortOrder
    );

    // Apply include_closed filter if needed
    if (params.include_closed === false) {
      const filtered = result.tickets.filter((t: TicketRow) => t.closed_at === null);
      return { tickets: filtered, total: filtered.length };
    }

    return { tickets: result.tickets, total: result.total };
  }

  /**
   * Get tickets with blocking filter applied via EXISTS subquery.
   * Excludes: closed tickets, human_feedback column tickets, and blocked tickets.
   */
  private static getTicketsWithFilter(
    projectId: number,
    params: {
      column?: string;
      priority?: number;
      labels?: string;
      page?: number;
      per_page?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    }
  ): { tickets: TicketRow[]; total: number } {
    const db = getDb();

    let perPage = params.per_page ?? 20;
    let sortBy = params.sort_by ?? 'created_at';
    let sortOrder = (params.sort_order ?? 'desc') as 'asc' | 'desc';

    // Enforce max per_page of 1000
    perPage = Math.min(perPage, 1000);

    // Build the query with EXISTS subquery for blocking filter
    // Exclude human_feedback column
    const hfc = db.prepare<[string, number], { id: number }>(
      'SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?'
    ).get(COLUMNS.HUMAN_FEEDBACK, projectId);

    let query = `
      SELECT t.*, kc.slug as column_slug
      FROM tickets t
      JOIN kanban_columns kc ON t.column_id = kc.id
      WHERE t.project_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM ticket_blockers tb WHERE tb.ticket_id = t.id
        )
        AND t.closed_at IS NULL
    `;
    const params_list: unknown[] = [projectId];

    if (hfc) {
      query += ' AND t.column_id != ?';
      params_list.push(hfc.id);
    }

    if (params.column) {
      query += ' AND t.column_id = (SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?)';
      params_list.push(params.column, projectId);
    }

    if (params.priority) {
      query += ' AND t.priority = ?';
      params_list.push(params.priority);
    }

    if (params.labels) {
      query += ' AND t.labels LIKE ?';
      params_list.push(`%${params.labels}%`);
    }

    // Apply sorting
    const validSortFields = ['created_at', 'updated_at', 'priority', 'title'];
    const safeSort = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY t."${safeSort}" ${safeOrder}`;

    // Apply pagination
    const offset = (params.page! - 1) * perPage;
    query += ' LIMIT ? OFFSET ?';
    params_list.push(perPage, offset);

    const tickets = db.prepare<unknown[]>(query).all(...params_list) as TicketRow[];

    // Get total count (without pagination)
    let countQuery = `
      SELECT COUNT(*) as total
      FROM tickets t
      WHERE t.project_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM ticket_blockers tb WHERE tb.ticket_id = t.id
        )
        AND t.closed_at IS NULL
    `;
    const countParams: unknown[] = [projectId];

    if (hfc) {
      countQuery += ' AND t.column_id != ?';
      countParams.push(hfc.id);
    }

    if (params.column) {
      countQuery += ' AND t.column_id = (SELECT id FROM kanban_columns WHERE slug = ? AND project_id = ?)';
      countParams.push(params.column, projectId);
    }

    if (params.priority) {
      countQuery += ' AND t.priority = ?';
      countParams.push(params.priority);
    }

    if (params.labels) {
      countQuery += ' AND t.labels LIKE ?';
      countParams.push(`%${params.labels}%`);
    }

    const countResult = db.prepare<unknown[], { total: number }>(countQuery).get(...countParams)!;

    return { tickets, total: countResult.total };
  }
}
