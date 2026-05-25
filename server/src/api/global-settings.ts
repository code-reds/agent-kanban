import { Router, Request, Response } from 'express';
import { GlobalSettingsService } from '../services/global-settings-service.js';
import { RoleService } from '../services/role-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// =========================================================================
// Global Columns
// =========================================================================

// GET /api/v1/global-settings/columns
router.get('/global-settings/columns', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.listColumns();
    toJsonSuccess(res, result.columns);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/global-settings/columns
router.post('/global-settings/columns', (req: Request, res: Response) => {
  try {
    const { slug, name, order, is_default } = req.body;

    const result = GlobalSettingsService.createColumn({
      slug,
      name,
      order,
      is_default: is_default || false,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.column, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/global-settings/columns/:id
router.patch('/global-settings/columns/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { slug, name, order } = req.body;

    const result = GlobalSettingsService.updateColumn(Number(id), { slug, name, order });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.column);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/global-settings/columns/:id
router.delete('/global-settings/columns/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const result = GlobalSettingsService.deleteColumn(Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Global Workflows
// =========================================================================

// GET /api/v1/global-settings/workflows
router.get('/global-settings/workflows', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.listWorkflows();
    toJsonSuccess(res, result.transitions);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/global-settings/workflows
router.post('/global-settings/workflows', (req: Request, res: Response) => {
  try {
    const { column_from, column_to, requires_comment, entire_ticket_group, allowed_roles } = req.body;

    const result = GlobalSettingsService.createWorkflow({
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

// PATCH /api/v1/global-settings/workflows/:id
router.patch('/global-settings/workflows/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { requires_comment, entire_ticket_group, allowed_roles } = req.body;

    const result = GlobalSettingsService.updateWorkflow(Number(id), {
      requires_comment,
      entire_ticket_group,
      allowed_roles,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/global-settings/workflows/:id
router.delete('/global-settings/workflows/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const result = GlobalSettingsService.deleteWorkflow(Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Global Access Rules
// =========================================================================

// GET /api/v1/global-settings/access-rules
router.get('/global-settings/access-rules', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.listAccessRules();
    toJsonSuccess(res, result.rules);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/global-settings/access-rules
router.patch('/global-settings/access-rules', (req: Request, res: Response) => {
  try {
    const { rules } = req.body;

    const result = GlobalSettingsService.updateAccessRules(rules);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rules);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Global Roles
// =========================================================================

// GET /api/v1/global-settings/roles - Get all global roles
router.get('/global-settings/roles', (req: Request, res: Response) => {
  try {
    const result = RoleService.listGlobalRoles();
    toJsonSuccess(res, result.roles);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/global-settings/roles - Create a new global role
router.post('/global-settings/roles', (req: Request, res: Response) => {
  try {
    const { name, description, accessLevel } = req.body;

    const result = RoleService.create({
      name,
      description,
      accessLevel,
    });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.data, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/global-settings/roles/:id - Update a global role
router.patch('/global-settings/roles/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { name, description } = req.body;

    const result = RoleService.updateGlobal(Number(id), { name, description });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.role);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/global-settings/roles/:id - Delete a global role
router.delete('/global-settings/roles/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const result = RoleService.delete(Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.data);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Global Roles_Columns
// =========================================================================

// GET /api/v1/global-settings/roles-columns
router.get('/global-settings/roles-columns', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.getRolesColumns();
    toJsonSuccess(res, result.rolesColumns);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/global-settings/roles-columns
router.post('/global-settings/roles-columns', (req: Request, res: Response) => {
  try {
    const { role_id, column_id, is_default } = req.body;

    if (role_id === undefined || role_id === null) {
      return toJsonError(res, 'role_id is required', 'VALIDATION_ERROR', 400);
    }

    const result = GlobalSettingsService.upsertRolesColumn(Number(role_id), column_id != null ? Number(column_id) : null, is_default || 0);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rolesColumn, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/global-settings/roles-columns/:role_id
router.patch('/global-settings/roles-columns/:role_id', (req: Request, res: Response) => {
  try {
    const { role_id } = req.params as { role_id: string };
    const { column_id, is_default } = req.body;

    const result = GlobalSettingsService.upsertRolesColumn(Number(role_id), column_id != null ? Number(column_id) : null, is_default || 0);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.rolesColumn);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/global-settings/roles-columns/:role_id
router.delete('/global-settings/roles-columns/:role_id', (req: Request, res: Response) => {
  try {
    const { role_id } = req.params as { role_id: string };

    const result = GlobalSettingsService.deleteRolesColumn(Number(role_id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { deleted: true });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Project Seed
// =========================================================================

// GET /api/v1/global-settings/project-seed
router.get('/global-settings/project-seed', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.getProjectSeedData();

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.data);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// =========================================================================
// Reset to Defaults
// =========================================================================

// POST /api/v1/global-settings/reset
router.post('/global-settings/reset', (req: Request, res: Response) => {
  try {
    const result = GlobalSettingsService.resetGlobalDefaults();

    if (!result.success) {
      return toJsonError(res, result.error || 'Failed to reset global defaults', result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, { success: true, deleted: result.deletedCount > 0 }, 200);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
