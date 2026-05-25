import { Router, Request, Response } from 'express';
import { WorkflowService } from '../services/workflow-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// GET /api/v1/projects/:slug/workflow - Get workflow transitions + access rules
router.get('/projects/:slug/workflow', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = WorkflowService.list(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.transitions);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/workflow - Add transition
router.post('/projects/:slug/workflow', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { column_from, column_to, requires_comment, entire_ticket_group, allowed_roles } = req.body;

    const result = WorkflowService.create(slug, {
      column_from,
      column_to,
      requires_comment,
      entire_ticket_group,
      allowed_roles,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.transition, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/workflow/:id - Remove transition
router.delete('/projects/:slug/workflow/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const result = WorkflowService.remove(slug, Number(id));

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true, id: result.id });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/workflow/:id - Update transition properties
router.patch('/projects/:slug/workflow/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { requires_comment, entire_ticket_group, allowed_roles } = req.body;

    const result = WorkflowService.update(slug, Number(id), {
      requires_comment,
      entire_ticket_group,
      allowed_roles,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.transition);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
