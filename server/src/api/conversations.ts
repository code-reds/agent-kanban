import { Router, Request, Response } from 'express';
import { ConversationService } from '../services/conversation-service.js';
import { ProjectService } from '../services/project-service.js';
import { errorMessage } from '../utils/errors.js';
import { toJsonSuccess, toJsonError } from './response.js';

const router = Router();

// POST /api/v1/projects/:slug/conversations - Create a new conversation (or return existing)
router.post('/projects/:slug/conversations', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { role_id } = req.body as { role_id: number };

    if (!role_id || typeof role_id !== 'number') {
      return toJsonError(res, 'role_id is required and must be a number', 'VALIDATION_ERROR', 400);
    }

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    const result = ConversationService.findOrCreateByRoleId(projectId, role_id);

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', 500);
    }

    toJsonSuccess(res, result.conversation, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/conversations - List conversations
router.get('/projects/:slug/conversations', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    const { conversations } = ConversationService.list(projectId);
    toJsonSuccess(res, conversations);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/conversations/:id - Get conversation with messages
router.get('/projects/:slug/conversations/:id', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    const result = ConversationService.getById(projectId, Number(id));

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.conversation);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/projects/:slug/conversations/:id/messages - Send message
router.post('/projects/:slug/conversations/:id/messages', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };
    const { content, sender_role_id } = req.body;

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    const result = ConversationService.sendMessage(projectId, Number(id), content, { sender_role_id });

    if (result.error) {
      return toJsonError(res, result.error, result.errorCode || 'INTERNAL_ERROR', result.statusCode || 500);
    }

    toJsonSuccess(res, result.message, 201);
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/projects/:slug/messages/unread - Fetch unread (auto-marks as read)
router.get('/projects/:slug/messages/unread', (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 1;

    const result = ConversationService.fetchUnread(projectId, { limit });

    toJsonSuccess(res, {
      messages: result.messages,
      last_read_message_id: result.last_read_message_id,
    });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/v1/projects/:slug/conversations/:id/read - Mark conversation as read
router.patch('/projects/:slug/conversations/:id/read', (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params as { slug: string; id: string };

    const projectResult = ProjectService.get(slug);
    if (projectResult.error) {
      return toJsonError(res, `Project '${slug}' not found`, 'NOT_FOUND', 404);
    }

    const projectId = projectResult.project!.id;
    ConversationService.markConversationAsRead(Number(id), projectId);

    toJsonSuccess(res, { marked_as_read: true });
  } catch (err) {
    toJsonError(res, errorMessage(err), 'INTERNAL_ERROR', 500);
  }
});

export default router;
