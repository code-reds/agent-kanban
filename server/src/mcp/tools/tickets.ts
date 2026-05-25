import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSession } from '../session.js';
import { z } from 'zod';
import { TicketService } from '../../services/ticket-service.js';
import { getColumnById as getColumnByIdQuery } from '../../db/queries/kanban.js';
import { COLUMNS } from '../../types/columns.js';
import { TicketListMode } from '../../types/ticket.js';

/**
 * Transform a raw ticket row from the database into the MCP response format.
 * Replaces project_id → project_slug and column_id → column_slug.
 * Does NOT modify the original object (creates a shallow copy).
 */
function transformTicketResponse(ticket: Record<string, unknown>, projectSlug: string, options?: { suppressDescription?: boolean }): Record<string, unknown> {
  const { project_id, column_id, ...rest } = ticket as Record<string, unknown> & { project_id?: number; column_id?: number };
  const result: Record<string, unknown> = { ...rest };

  // Suppress description to avoid context pollution in list responses
  if (options?.suppressDescription) {
    delete result.description;
  }

  // Use column_slug from DB result if available, otherwise keep column_id
  result.project_slug = projectSlug;
  if (ticket.column_slug !== undefined && ticket.column_slug !== null) {
    result.column_slug = ticket.column_slug as string;
  }

  // Remove the old ID fields
  delete result.project_id;
  if (ticket.column_id !== undefined) {
    // Only keep column_id if we don't have column_slug (fallback)
    if (result.column_slug === undefined) {
      result.column_id = ticket.column_id;
    }
  }

  return result;
}

export function registerTicketTools(server: McpServer, session: McpSession) {
  const projectSlug = session.projectSlug;
  const roleId = session.roleId;
  const pc = session.permissionChecker;

  // list_tickets
  server.registerTool(
    'list_tickets',
    {
      title: 'List Tickets',
      description: 'List tickets with optional filters and modes. Modes: todo-list (role-specific active work), all (every ticket), not-blocked (unblocked only), top-level-tickets (parent tickets only).',
      inputSchema: {
        mode: z.enum(['todo-list', 'all', 'not-blocked', 'top-level-tickets']).default('todo-list').describe(
          'Filter mode. todo-list: role-specific active work. all: every ticket. not-blocked: unblocked only. top-level-tickets: parent tickets.'
        ),
        column: z.string().optional().describe(
          'Filter by column slug. Only used with "all", "not-blocked", or "top-level-tickets" modes. Valid: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback.'
        ),
        priority: z.number().min(1).max(5).optional().describe(
          'Filter by priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial.'
        ),
        labels: z.string().optional().describe(
          'Filter by labels. Pass a comma-separated list of label names to find tickets with any of those labels.'
        ),
        parent_id: z.number().optional().describe(
          'Filter by parent ticket ID. If provided, returns only sub-tickets of this parent. ' +
          'In todo-list mode, sub-tickets of matching parent tickets are also included.'
        ),
        page: z.number().min(1).optional().describe(
          'Page number for pagination. Default: 1. Each page returns up to per_page results.'
        ),
        per_page: z.number().min(1).max(100).optional().describe(
          'Number of results per page. Default: 20. Maximum: 100.'
        ),
        sort_by: z.string().optional().describe(
          'Field to sort results by. Common values: priority, created_at, updated_at, title.'
        ),
        sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction: asc (ascending) or desc (descending). Default: desc for priority, asc for dates.'),
        include_closed: z.boolean().optional().describe(
          'Include closed tickets in the results. Default: false (excludes closed tickets).'
        ),
      },
    },
    async (params) => {
      const project = TicketService.resolveProject(projectSlug);
      if (!project) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const projectId = project.id;
      const mode: TicketListMode = params.mode ?? 'todo-list';

     // Handle todo-list mode with role-specific logic
        if (mode === 'todo-list') {
          const roleColumnId = TicketService.getRoleDefaultColumn(roleId, projectId);
          let columnSlugs: string[];

          if (roleColumnId === null) {
            // Unrestricted role (e.g., Human User, teamleader) — see all non-done/non-feedback columns
            columnSlugs = [COLUMNS.TODO, COLUMNS.IMPLEMENTATION, COLUMNS.UNIT_REVIEW, COLUMNS.INTEGRATION_TESTING, COLUMNS.FINAL_REVIEW];
          } else {
            // Resolve column ID to slug
            const col = getColumnByIdQuery(roleColumnId);
            columnSlugs = col ? [col.slug] : [];
          }

          // When include_closed=true, also include the done column where closed tickets live
          if (params.include_closed && !columnSlugs.includes(COLUMNS.DONE)) {
            columnSlugs.push(COLUMNS.DONE);
         }

        // Collect all candidate ticket IDs from relevant columns
        const candidateIds = new Set<number>();
        for (const colSlug of columnSlugs) {
          const ids = params.include_closed
            ? TicketService.getAllColumnTicketIds(projectId, colSlug)
            : TicketService.getNonClosedColumnTicketIds(projectId, colSlug);
          for (const id of ids) candidateIds.add(id);
        }

        // Filter out blocked tickets
        const blockedIds = new Set(TicketService.getBlockedTicketIds(projectId));
        const openTickets = Array.from(candidateIds).filter((id) => !blockedIds.has(id));

        // Apply parent_id filter if specified
        let filteredIds = openTickets;
        if (params.parent_id) {
          const parentId = params.parent_id;
          const parentCheck = TicketService.findTicketForProject(projectSlug, parentId);
          if (parentCheck.ticket && parentCheck.ticket.project_id === projectId) {
            const ticketParentIds = new Map<number, number>();
            for (const id of openTickets) {
              const check = TicketService.findTicketForProject(projectSlug, id);
              if (check.ticket) {
                ticketParentIds.set(id, check.ticket.parent_id ?? -1);
              }
            }
            filteredIds = openTickets.filter((id) => id === parentId || (ticketParentIds.get(id) === parentId));
          } else {
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true, data: { tickets: [], total: 0, mode } }) }],
            };
          }
        }

        // Apply priority and labels filters, then paginate
        const result = TicketService.listByMode(projectId, mode, {
          priority: params.priority,
          labels: params.labels,
          ticket_ids: filteredIds,
          page: params.page,
          per_page: params.per_page,
          include_closed: params.include_closed ?? false,
        });

        const transformedTickets = result.tickets.map((t) => {
          const enriched = transformTicketResponse(t as unknown as Record<string, unknown>, projectSlug, { suppressDescription: true });
          enriched.is_blocked = blockedIds.has(t.id as number);
          enriched.blocking_ticket_ids = TicketService.getUnresolvedDependencyIds(t.id as number);
          return enriched;
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { tickets: transformedTickets, total: result.total, mode } }) }],
        };
      }

      if (mode === 'not-blocked') {
        const result = TicketService.listByMode(projectId, mode, {
          column: params.column,
          priority: params.priority,
          labels: params.labels,
          page: params.page,
          per_page: params.per_page,
          include_closed: params.include_closed ?? false,
        });

        const transformedTickets = result.tickets.map((t) => {
          const enriched = transformTicketResponse(t as unknown as Record<string, unknown>, projectSlug, { suppressDescription: true });
          enriched.is_blocked = false;
          enriched.blocking_ticket_ids = [];
          return enriched;
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { tickets: transformedTickets, total: result.total, mode } }) }],
        };
      }

      if (mode === 'top-level-tickets') {
        const result = TicketService.listByMode(projectId, mode, {
          column: params.column,
          priority: params.priority,
          labels: params.labels,
          page: params.page,
          per_page: params.per_page,
          include_closed: params.include_closed ?? false,
        });

        const blockedIds = new Set(TicketService.getBlockedTicketIds(projectId));
        const transformedTickets = result.tickets.map((t) => {
          const enriched = transformTicketResponse(t as unknown as Record<string, unknown>, projectSlug, { suppressDescription: true });
          enriched.is_blocked = blockedIds.has(t.id as number);
          enriched.blocking_ticket_ids = TicketService.getUnresolvedDependencyIds(t.id as number);
          return enriched;
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { tickets: transformedTickets, total: result.total, mode } }) }],
        };
      }

      // mode === 'all' — original behavior
      const result = TicketService.list(projectSlug, {
        column: params.column,
        priority: params.priority,
        labels: params.labels,
        parent_id: params.parent_id,
        page: params.page,
        per_page: params.per_page,
        sort_by: params.sort_by,
        sort_order: params.sort_order,
        include_closed: params.include_closed ?? false,
      });

      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      const blockedIds = new Set(TicketService.getBlockedTicketIds(projectId));
      const transformedTickets = result.tickets.map((t) => {
        const enriched = transformTicketResponse(t as unknown as Record<string, unknown>, projectSlug, { suppressDescription: true });
        enriched.is_blocked = blockedIds.has(t.id as number);
        enriched.blocking_ticket_ids = TicketService.getUnresolvedDependencyIds(t.id as number);
        return enriched;
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { tickets: transformedTickets, total: result.total, mode: 'all' } }) }],
      };
    }
  );

  // get_ticket
  server.registerTool(
    'get_ticket',
    {
      title: 'Get Ticket',
      description: 'Get full details for a single ticket: status, description, labels, priority, comments, dependencies, and history. Ticket ID is an integer from list_tickets.',
      inputSchema: {
        id: z.number().describe('Ticket ID (integer). Use the id field from list_tickets results.'),
      },
    },
    async (params) => {
      const project = TicketService.resolveProject(projectSlug);
      if (!project) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticketResult = TicketService.findTicketForProject(projectSlug, params.id);
      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const isBlocked = TicketService.isTicketBlocked(params.id);
      const blockingTicketIds = TicketService.getUnresolvedDependencyIds(params.id);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { ...transformTicketResponse(ticketResult.ticket as unknown as Record<string, unknown>, projectSlug), is_blocked: isBlocked, blocking_ticket_ids: blockingTicketIds } }) }],
      };
    }
  );

  // create_ticket
  server.registerTool(
    'create_ticket',
    {
      title: 'Create Ticket',
      description: 'Create a new ticket in the Kanban board. Most roles can only create tickets in the "todo" column. Use markdown for the description. For sub-tasks, set parent_id to the parent ticket ID. Set to null for a top-level ticket.',
      inputSchema: {
        title: z.string().min(1).max(255).describe('Ticket title (required). Keep it concise but descriptive — aim for 5-50 words.'),
        description: z.string().default('').describe('Ticket description (optional). Use markdown for formatting. Default: empty string.'),
        column: z.string().min(1).describe('Target column slug (required). For most roles, use "todo". Valid slugs: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback.'),
        priority: z.number().min(1).max(5).optional().describe('Priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial. If omitted for a child ticket (parent_id set), inherits from parent.'),
        labels: z.string().default('[]').describe('Ticket labels as a JSON array of strings (optional). Labels help categorize tickets, e.g. ["bug", "frontend", "api"]. Default: empty array []'),
        estimate: z.number().optional().describe('Time estimate for completion (optional). Can be hours or story points. Helps with planning and prioritization.'),
        parent_id: z.number().int().nullish().describe('Parent ticket ID (optional). If set to a valid ticket ID, creates a sub-task under that parent. If set to null or omitted, creates a top-level ticket. Use a ticket_id from list_tickets results. Sub-tasks inherit the parent\'s column.'),
      },
    },
    async (params) => {
      if (!pc.validateColumn(params.column)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Column '${params.column}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const permCheck = pc.checkPermission('create_ticket', params.column);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.create(projectSlug, {
        title: params.title,
        column: params.column,
        description: params.description,
        priority: params.priority,
        labels: params.labels,
        estimate: params.estimate,
        parent_id: params.parent_id,
        role_id: roleId,
      });

      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: transformTicketResponse(result.ticket as unknown as Record<string, unknown>, projectSlug) }) }],
      };
    }
  );

  // update_ticket
  server.registerTool(
    'update_ticket',
    {
      title: 'Update Ticket',
      description: "Update ticket fields without changing its column. All fields are optional. Use move_ticket to change the column. You must have edit permission on the ticket's current column. You can also change a ticket's parent by setting parent_id to another ticket's ID (creates sub-task) or null (top-level ticket).",
      inputSchema: {
        id: z.number().describe('Ticket ID (required). The integer ID of the ticket to update.'),
        title: z.string().optional().describe('New title (optional).'),
        description: z.string().optional().describe('New description (optional). Use markdown for formatting.'),
        priority: z.number().min(1).max(5).optional().describe('New priority. 1=urgent, 2=high, 3=medium, 4=low, 5=trivial.'),
        labels: z.string().optional().describe('New labels (optional). JSON array of strings, e.g. "[\\"bug\\", \\"urgent\\"]". Replaces all existing labels.'),
        estimate: z.number().optional().describe('New estimate (optional). Hours or story points for the ticket.'),
        parent_id: z.number().int().nullish().describe('Parent ticket ID (optional). Set to a valid ticket ID to make this a sub-task. Set to null to make it a top-level ticket.'),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const columnSlug = pc.getColumnSlug(ticket.column_id);
      if (!columnSlug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      const permCheck = pc.checkPermission('update_ticket', columnSlug);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.update(projectSlug, params.id, {
        title: params.title,
        description: params.description,
        priority: params.priority,
        labels: params.labels,
        estimate: params.estimate,
        parent_id: params.parent_id,
        role_id: roleId,
      });

      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: transformTicketResponse(result.ticket as unknown as Record<string, unknown>, projectSlug) }) }],
      };
    }
  );

  // move_ticket
  server.registerTool(
    'move_ticket',
    {
      title: 'Move Ticket',
      description: "Move a ticket to a different column. Moving to 'done' closes the ticket. A Human User can re-open closed tickets by moving them back to 'implementation' (requires a comment). Some transitions require a comment. You must have permission for the source column.",
      inputSchema: {
        id: z.number().describe('Ticket ID (required). The integer ID of the ticket to move.'),
        to_column: z.string().min(1).describe('Target column slug (required). Valid slugs: todo, implementation, unit_review, integration_testing, final_review, done, human_feedback. Moving to "done" closes the ticket.'),
        comment: z.string().optional().describe('Move comment (optional but required for some transitions). Explain what changed and why.'),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const fromColData = { slug: pc.getColumnSlug(ticket.column_id) || '' };

      if (!fromColData.slug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      if (!pc.validateColumn(params.to_column)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Column '${params.to_column}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const transitionCheck = pc.canTransition(fromColData.slug, params.to_column);
      if (!transitionCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: transitionCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      if (pc.isCommentRequired(fromColData.slug, params.to_column) && !params.comment) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Comment is required for this transition', code: 'VALIDATION_ERROR' }) }],
        };
      }

      const result = TicketService.move(projectSlug, params.id, params.to_column, {
        comment: params.comment,
        role_id: roleId,
      });

      if (!result.success) {
        const errorResp: Record<string, unknown> = { success: false, error: result.error, code: (result as any).errorCode || 'VALIDATION_ERROR' };
        if ((result as any).blocker_ids) {
          errorResp.blocker_ids = (result as any).blocker_ids;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(errorResp) }],
        };
      }

      // Get new status information after the move
      const newColumnSlug = result.to_column;
      const newIsBlocked = TicketService.isTicketBlocked(result.ticket_id);
      const newBlockingTicketIds = TicketService.getUnresolvedDependencyIds(result.ticket_id);
      const ticketsUnblocked = result.tickets_unblocked ?? [];

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { moved: true, ticket_id: result.ticket_id, to_column: result.to_column, new_status: { column_slug: newColumnSlug, is_blocked: newIsBlocked, blocking_ticket_ids: newBlockingTicketIds, tickets_unblocked_by_this_move: ticketsUnblocked } } }) }],
      };
    }
  );

  // add_comment
  server.registerTool(
    'add_comment',
    {
      title: 'Add Comment',
      description: 'Add a markdown-formatted comment to a ticket. Comments are visible to all roles and create an audit trail. You must have edit permission on the ticket\'s current column.',
      inputSchema: {
        ticket_id: z.number().describe('Ticket ID (required). The integer ID of the ticket to comment on.'),
        content: z.string().min(1).describe('Comment content (required). Use markdown for formatting. Part of the ticket\'s permanent history.'),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.ticket_id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.ticket_id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const columnSlug = pc.getColumnSlug(ticket.column_id);
      if (!columnSlug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      const permCheck = pc.checkPermission('add_comment', columnSlug);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.addComment(projectSlug, params.ticket_id, params.content, { role_id: roleId });

      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: result.comment }) }],
      };
    }
  );

  // add_dependency
  server.registerTool(
    'add_dependency',
    {
      title: 'Add Dependency',
      description: 'Create a dependency between two tickets in the same project. blocked_by = waits for dependency; depends_on = dependency must finish first; related = informational link only. No circular dependencies.',
      inputSchema: {
        ticket_id: z.number().describe('Ticket ID (required). The ticket that has the dependency. This is the "child" ticket.'),
        depends_on_id: z.number().describe('Dependency ticket ID (required). The ticket this one depends on. This must be a valid ticket ID from the same project.'),
        relation_type: z.enum(['blocked_by', 'depends_on', 'related']).describe(
          'Relationship type (required). blocked_by = this ticket must wait for the dependency. depends_on = the dependency must finish first. related = informational link only.'
        ),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.ticket_id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.ticket_id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const columnSlug = pc.getColumnSlug(ticket.column_id);
      if (!columnSlug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      const permCheck = pc.checkPermission('add_dependency', columnSlug);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.addDependency(projectSlug, params.ticket_id, params.depends_on_id, params.relation_type);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { added: true, ticket_id: result.ticket_id, depends_on_id: result.depends_on_id, relation_type: params.relation_type } }) }],
      };
    }
  );

  // remove_dependency
  server.registerTool(
    'remove_dependency',
    {
      title: 'Remove Dependency',
      description: "Remove an existing dependency between two tickets. Requires edit permission. The dependency must exist.",
      inputSchema: {
        ticket_id: z.number().describe('Ticket ID (required). The ticket whose dependency should be removed.'),
        depends_on_id: z.number().describe('Dependency ticket ID (required). The ticket that was the dependency. Must match the original dependency exactly.'),
        relation_type: z.enum(['blocked_by', 'depends_on', 'related']).describe(
          'Relationship type (required). Must match the original dependency type exactly: blocked_by, depends_on, or related.'
        ),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.ticket_id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.ticket_id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const columnSlug = pc.getColumnSlug(ticket.column_id);
      if (!columnSlug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      const permCheck = pc.checkPermission('remove_dependency', columnSlug);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.removeDependency(projectSlug, params.ticket_id, params.depends_on_id, params.relation_type);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { removed: true, ticket_id: result.ticket_id, depends_on_id: result.depends_on_id } }) }],
      };
    }
  );

  // list_dependencies
  server.registerTool(
    'list_dependencies',
    {
      title: 'List Dependencies',
      description: 'List all dependency relationships for a ticket, grouped by type: blocked_by, depends_on, and related.',
      inputSchema: {
        ticket_id: z.number().describe('Ticket ID (required). The integer ID of the ticket to list dependencies for.'),
      },
    },
    async (params) => {
      const ticketResult = TicketService.findTicketForProject(projectSlug, params.ticket_id);

      if (!ticketResult.ticket) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Ticket '${params.ticket_id}' not found`, code: 'NOT_FOUND' }) }],
        };
      }

      const ticket = ticketResult.ticket;
      const project = ticketResult.project;
      const columnSlug = pc.getColumnSlug(ticket.column_id);
      if (!columnSlug) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Ticket has invalid column', code: 'INTERNAL_ERROR' }) }],
        };
      }

      const permCheck = pc.checkPermission('list_dependencies', columnSlug);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: permCheck.reason, code: 'PERMISSION_DENIED' }) }],
        };
      }

      const result = TicketService.getDependencies(projectSlug, params.ticket_id);

      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      // Enrich dependencies with is_blocking flag
      const blockedIds = new Set(TicketService.getBlockedTicketIds(project!.id));
      const enrichedDependencies = result.dependencies.map((dep) => ({
        ...dep,
        is_blocking: blockedIds.has(dep.depends_on_id),
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: enrichedDependencies }) }],
      };
    }
  );

 }
