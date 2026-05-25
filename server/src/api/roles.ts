import { Router, Request, Response } from 'express';
import { RoleService } from '../services/role-service.js';
import { ProjectService } from '../services/project-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// GET /api/v1/projects/:slug/roles - Get all roles with access levels
router.get('/projects/:slug/roles', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = RoleService.listWithAccessLevels(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.roles);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/roles/:id - Update role name/description
router.patch('/projects/:slug/roles/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { name, description } = req.body;

    const result = RoleService.update(slug, Number(id), { name, description });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.role);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Project Roles_Columns CRUD
// =========================================================================

// GET /api/v1/projects/:slug/roles-columns - Get combined project + global roles_columns
router.get('/projects/:slug/roles-columns', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = ProjectService.getRolesColumns(slug);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rolesColumns);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/roles-columns - Create project-specific override
router.post('/projects/:slug/roles-columns', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { role_id, column_id, is_default } = req.body;

    const result = ProjectService.upsertRolesColumn(
      slug,
      role_id,
      column_id,
      is_default !== undefined ? is_default : 0
    );

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rolesColumn, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/roles-columns/:role_id - Update project-specific override
router.patch('/projects/:slug/roles-columns/:role_id', (req: Request, res: Response) => {
  try {
    const { slug, role_id } = req.params as { slug: string; role_id: string };
    const { column_id, is_default } = req.body;

    const result = ProjectService.updateRolesColumn(
      slug,
      Number(role_id),
      column_id,
      is_default !== undefined ? is_default : 0
    );

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rolesColumn);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/projects/:slug/roles-columns/:role_id - Delete project-specific override
router.delete('/projects/:slug/roles-columns/:role_id', (req: Request, res: Response) => {
  try {
    const { slug, role_id } = req.params as { slug: string; role_id: string };

    const result = ProjectService.deleteRolesColumn(slug, Number(role_id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: result.deleted });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
