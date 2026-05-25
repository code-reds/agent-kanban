import { Router, Request, Response } from 'express';
import { ColumnService } from '../services/column-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// GET /api/v1/projects/:slug/columns - List ordered
router.get('/projects/:slug/columns', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = ColumnService.list(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.columns);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/columns - Add column
router.post('/projects/:slug/columns', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { slug: columnSlug, name, order, is_default } = req.body;

    const result = ColumnService.create(slug, { slug: columnSlug, name, order, is_default });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.column, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/columns/:id - Update column
router.patch('/projects/:slug/columns/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { slug: columnSlug, name, order } = req.body;

    const result = ColumnService.update(slug, Number(id), { slug: columnSlug, name, order });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.column);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/columns/:id - Delete (fails if non-empty or default)
router.delete('/projects/:slug/columns/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const result = ColumnService.remove(slug, Number(id));

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true, id: result.id });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
