import { Router, Request, Response } from 'express';
import { TicketService } from '../services/ticket-service.js';
import { getProjectBySlug } from '../db/queries/projects.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';
import { TicketListMode } from '../types/ticket.js';

const router = Router();

/**
 * Strip column_slug from ticket objects to maintain REST API backwards compatibility.
 * The column_slug field is only used by MCP tools; the REST API should not expose it.
 */
function stripColumnSlug(ticket: unknown): unknown {
  if (ticket && typeof ticket === 'object' && !Array.isArray(ticket)) {
    const { column_slug, ...rest } = ticket as Record<string, unknown>;
    return rest;
  }
  if (Array.isArray(ticket)) {
    return ticket.map(stripColumnSlug);
  }
  return ticket;
}

/**
 * Enrich a ticket object with blocking information.
 * Adds is_blocked boolean and blocking_ticket_ids array.
 */
function enrichWithBlockingInfo(ticket: unknown): unknown {
  if (ticket && typeof ticket === 'object' && !Array.isArray(ticket)) {
    const id = (ticket as Record<string, unknown>).id;
    if (typeof id === 'number') {
      return {
        ...ticket,
        is_blocked: TicketService.isTicketBlocked(id),
        blocking_ticket_ids: TicketService.getUnresolvedDependencyIds(id),
      };
    }
  }
  return ticket;
}

// GET /api/v1/projects/:slug/tickets - List with filters
router.get('/projects/:slug/tickets', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const column = req.query.column as string | undefined;
    const priority = req.query.priority ? Number(req.query.priority) : undefined;
    const labels = req.query.labels as string | undefined;
    const parentId = req.query.parent_id ? Number(req.query.parent_id) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    let perPage = req.query.per_page ? Number(req.query.per_page) : 20;
    const sortBy = (req.query.sort_by as string) || 'created_at';
    const sortOrder = (req.query.sort_order as 'asc' | 'desc') || 'desc';
    const mode = req.query.mode as string | undefined;

    // New parameters for fetching all tickets and limiting done column results
    const allTickets = req.query.all_tickets === 'true';
    const doneLimit = req.query.done_limit ? Number(req.query.done_limit) : undefined;

    // Cap per_page at 1000 for all requests
    perPage = Math.min(perPage, 1000);

    // filter_blocked: use optimized EXISTS query to exclude blocked, closed, and human_feedback tickets
    const filterBlocked = req.query.filter_blocked === 'true';

    // include_closed: whether to include closed tickets in results
    const includeClosed = req.query.include_closed !== 'false';

    if (mode === 'not-blocked' || mode === 'top-level-tickets') {
      const project = getProjectBySlug(slug);
      if (!project) {
        return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
      }
      const result = TicketService.listByMode(project.id, mode as 'not-blocked' | 'top-level-tickets', {
        column,
        priority,
        labels,
        page,
        per_page: perPage,
        all_tickets: allTickets,
        done_limit: doneLimit,
        include_closed: includeClosed,
      });
      // For not-blocked mode, tickets already exclude closed and human_feedback (done via SQL EXISTS)
      // For top-level-tickets, enrich with blocking info as usual
      return toJsonSuccess(res, {
        tickets: (stripColumnSlug(result.tickets) as unknown[]).map(enrichWithBlockingInfo),
        total: result.total,
        done_total: result.done_total,
      });
    }

    const result = TicketService.list(slug, {
      column,
      priority,
      labels,
      parent_id: parentId,
      page,
      per_page: perPage,
      sort_by: sortBy,
      sort_order: sortOrder,
      all_tickets: allTickets,
      done_limit: doneLimit,
      filterBlocked,
      include_closed: includeClosed,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { tickets: (stripColumnSlug(result.tickets) as unknown[]).map(enrichWithBlockingInfo), total: result.total, done_total: result.done_total });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/tickets/:id - Get with comments, deps, status history
router.get('/projects/:slug/tickets/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const ticket = TicketService.findTicketForProject(slug, Number(id));

    if (!ticket.ticket) {
      return toJsonError(res, `Ticket '${id}' not found`, 'NOT_FOUND', 404);
    }

    const enriched = stripColumnSlug(enrichWithBlockingInfo(ticket.ticket));
    toJsonSuccess(res, enriched);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/tickets - Create (uses shared service)
router.post('/projects/:slug/tickets', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { column, title, description, labels, priority, estimate, parent_id, role_id } = req.body;

    const result = TicketService.create(slug, {
      title,
      column,
      description,
      labels,
      priority,
      estimate,
      parent_id,
      role_id,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, stripColumnSlug(result.ticket), 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/tickets/:id - Update (uses shared service)
router.patch('/projects/:slug/tickets/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { title, description, labels, priority, estimate, parent_id, role_id } = req.body;

    const result = TicketService.update(slug, Number(id), {
      title,
      description,
      labels,
      priority,
      estimate,
      parent_id,
      role_id,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, stripColumnSlug(result.ticket));
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/tickets/:id/transitions - Get allowed transitions
router.get('/projects/:slug/tickets/:id/transitions', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const result = TicketService.getTransitions(slug, Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.transitions);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/tickets/:id/move - Move ticket (uses shared service)
router.post('/projects/:slug/tickets/:id/move', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { to_column, role_id, comment } = req.body;

    const result = TicketService.move(slug, Number(id), to_column as string, {
      comment,
      role_id
    });

    if (!result.success) {
      const errorCode = (result as any).errorCode || (result.error?.includes('not found') ? 'NOT_FOUND' : 'VALIDATION_ERROR');
      const statusCode = (result as any).statusCode || (errorCode === 'NOT_FOUND' ? 404 : errorCode === 'CONFLICT' ? 409 : 400);
      const resp: Record<string, unknown> = { success: false, error: result.error || 'Move failed', code: errorCode };
      if ((result as any).blocker_ids) {
        resp.blocker_ids = (result as any).blocker_ids;
      }
      return res.status(statusCode).json(resp);
    }

    toJsonSuccess(res, { moved: true, ticket_id: result.ticket_id, to_column: result.to_column });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/tickets/:id/comments - Add comment (uses shared service)
router.post('/projects/:slug/tickets/:id/comments', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { content, role_id } = req.body;

    const result = TicketService.addComment(slug, Number(id), content as string, { role_id });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.comment, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/tickets/:id/comments/:commentId - Update comment
router.patch('/projects/:slug/tickets/:id/comments/:commentId', (req: Request, res: Response) => {
  try {
    const { slug, id, commentId } = req.params as { slug: string; id: string; commentId: string };
    const { content, role_id } = req.body;

    const result = TicketService.updateComment(slug, Number(id), Number(commentId), content as string, { role_id });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.comment);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/tickets/:id/comments/:commentId - Delete comment
router.delete('/projects/:slug/tickets/:id/comments/:commentId', (req: Request, res: Response) => {
  try {
    const { slug, id, commentId } = req.params as { slug: string; id: string; commentId: string };
    const { role_id } = req.body;

    const result = TicketService.deleteComment(slug, Number(id), Number(commentId), { role_id });

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true, comment_id: Number(commentId) });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/tickets/:id/dependencies - Get deps
router.get('/projects/:slug/tickets/:id/dependencies', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const result = TicketService.getDependencies(slug, Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.dependencies);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/tickets/:id/dependencies/:relationType/:depId - Add dep
router.post('/projects/:slug/tickets/:id/dependencies/:relationType/:depId', (req: Request, res: Response) => {
  try {
    const { slug, id, depId, relationType } = req.params as { slug: string; id: string; depId: string; relationType: string };

    const result = TicketService.addDependency(slug as string, Number(id), Number(depId), relationType);

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { added: true, ticket_id: result.ticket_id, depends_on_id: result.depends_on_id, relation_type: relationType }, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/tickets/:id/dependencies/:relationType/:depId - Remove dep (path params)
router.delete('/projects/:slug/tickets/:id/dependencies/:relationType/:depId', (req: Request, res: Response) => {
  try {
    const { slug, id, depId } = req.params as { slug: string; id: string; depId: string; relationType: string };

    const result = TicketService.removeDependency(slug, Number(id), Number(depId), req.params.relationType as string);

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { removed: true, ticket_id: result.ticket_id, depends_on_id: result.depends_on_id });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/tickets/:id/dependencies?depends_on_id=X&relation_type=Y - Remove dep (query params)
// This route supports the WebUI's query-parameter-based delete dependency requests.
router.delete('/projects/:slug/tickets/:id/dependencies', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { depends_on_id, relation_type } = req.query as { depends_on_id?: string; relation_type?: string };

    if (!depends_on_id || !relation_type) {
      return toJsonError(res, 'depends_on_id and relation_type query parameters are required', 'VALIDATION_ERROR', 400);
    }

    const result = TicketService.removeDependency(slug, Number(id), Number(depends_on_id), relation_type);

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { removed: true, ticket_id: result.ticket_id, depends_on_id: result.depends_on_id });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/tickets/:id - Delete ticket (uses shared service)
router.delete('/projects/:slug/tickets/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { role_id } = req.query as { role_id?: string };

    const result = TicketService.remove(slug, Number(id), {
      role_id: role_id ? Number(role_id) : undefined,
    });

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true, ticket_id: result.ticket_id });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
