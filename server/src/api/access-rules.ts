import { Router, Request, Response } from 'express';
import { AccessRuleService } from '../services/access-rule-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// GET /api/v1/projects/:slug/access-rules - Get all access rules enriched with column/role names
router.get('/projects/:slug/access-rules', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = AccessRuleService.list(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rules);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/access-rules - Bulk update access rules
router.patch('/projects/:slug/access-rules', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { rules } = req.body;

    const result = AccessRuleService.update(slug, rules);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rules);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
