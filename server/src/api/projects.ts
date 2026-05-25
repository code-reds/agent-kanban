import { Router, Request, Response } from 'express';
import { ProjectService } from '../services/project-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// GET /api/v1/projects - List with optional q=search
router.get('/projects', (req: Request, res: Response) => {
  try {
    const search = req.query.q as string | undefined;
    const { projects } = ProjectService.list(search);
    toJsonSuccess(res, projects);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects - Create (uses shared service)
router.post('/projects', (req: Request, res: Response) => {
  try {
    const { name, slug } = req.body;

    const result = ProjectService.create(name, slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.project, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug - Get with columns, roles, workflow, access rules
router.get('/projects/:slug', (req: Request, res: Response) => {
  try {
    const slug = (req.params as { slug: string }).slug;
    const result = ProjectService.get(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.project);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug - Update name/description
router.patch('/projects/:slug', (req: Request, res: Response) => {
  try {
    const slug = (req.params as { slug: string }).slug;
    const { name, description } = req.body;

    const result = ProjectService.update(slug, { name: name ?? undefined, description: description ?? undefined });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.project);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug - Cascade delete
router.delete('/projects/:slug', (req: Request, res: Response) => {
  try {
    const slug = (req.params as { slug: string }).slug;

    const result = ProjectService.remove(slug);

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true, slug });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
