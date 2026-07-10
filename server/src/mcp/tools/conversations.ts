import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSession } from '../session.js';
import { z } from 'zod';
import { ConversationService } from '../../services/conversation-service.js';
import { NotificationService } from '../../services/notification-service.js';
import { amendMCPResponseWithNotifications } from '../utils/notifications.js';
import { getProjectBySlug } from '../../db/queries/projects.js';

export function registerConversationTools(server: McpServer, session: McpSession) {
  const projectSlug = session.projectSlug;
  const projectId = session.projectId;
  const roleId = session.roleId;

  // list_conversations
  server.registerTool(
    'list_conversations',
    {
      title: 'List Conversations',
      description: 'List all conversations (role-to-role messaging pairs) for this project. Each conversation represents a unique pair of roles communicating with each other. Returns conversation metadata including the last message time and unread count. Use this to see which roles you have active conversations with and check for unread messages.',
    },
    async () => {
      const project = getProjectBySlug(projectSlug);
      if (!project) {
        const baseResponse = JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const { conversations } = ConversationService.list(projectId);
      const baseResponse = JSON.stringify({ success: true, data: conversations });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );

  // get_conversation
  server.registerTool(
    'get_conversation',
    {
      title: 'Get Conversation',
      description: 'Get messages from a specific conversation. Use this to read the full message history of a role-to-role conversation. Supports pagination with limit parameter. Messages are returned in chronological order (oldest first).',
      inputSchema: {
        conversation_id: z.number().describe('Conversation ID (required). The integer ID of the conversation to retrieve. Get this from list_conversations results.'),
        limit: z.number().min(1).max(200).optional().describe('Maximum number of messages to return (optional). Default: 50. Use to retrieve older messages by calling multiple times with increasing offsets.'),
      },
    },
    async (params) => {
      const project = getProjectBySlug(projectSlug);
      if (!project) {
        const baseResponse = JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const result = ConversationService.getById(projectId, params.conversation_id);

      if (result.error) {
        const baseResponse = JSON.stringify({ success: false, error: result.error, code: result.errorCode });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      // Mark conversation as read since the user is viewing it
      ConversationService.markConversationAsRead(params.conversation_id, projectId);

      const baseResponse = JSON.stringify({ success: true, data: result.conversation });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );

  // send_message
  server.registerTool(
    'send_message',
    {
      title: 'Send Message',
      description: 'Send a message to a role. Creates a conversation between roles if one does not already exist. Messages support markdown formatting. Use this to communicate with other AI agents or human users about tickets, workflow decisions, or coordination. The to_role parameter is the target role name (not ID).',
      inputSchema: {
        to_role: z.string().min(1).describe('Target role name (required). The name of the role to send the message to. Use role names like "AI code developer", "AI teamleader", "Human User", etc. Get the exact role names from get_project_info.'),
        content: z.string().min(1).describe('Message content (required). Your message text. Supports markdown formatting. Be clear and specific about what you need or what you found.'),
      },
    },
    async (params) => {
      const project = getProjectBySlug(projectSlug);
      if (!project) {
        const baseResponse = JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      // Find or create conversation by role names
      const convResult = ConversationService.findOrCreateByRoleNames(projectId, session.role.name, params.to_role);

      if (convResult.error) {
        const baseResponse = JSON.stringify({ success: false, error: convResult.error, code: convResult.errorCode });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const result = ConversationService.sendMessage(projectId, convResult.conversation!.id, params.content, { sender_role_id: roleId });

      if (result.error) {
        const baseResponse = JSON.stringify({ success: false, error: result.error, code: result.errorCode });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const baseResponse = JSON.stringify({ success: true, data: result.message });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );

  // fetch_unread
  server.registerTool(
    'fetch_unread',
    {
      title: 'Fetch Unread',
      description: 'Get unread messages from all conversations. Messages are automatically marked as read when returned. Use limit=1 (default) to process messages one at a time, or limit=0 to get all remaining unread messages at once. This is the recommended pattern for agents: call fetch_unread(limit=1) repeatedly until it returns no messages.',
      inputSchema: {
        limit: z.number().default(1).describe('Max messages to return (optional). Default: 1 (recommended for agents processing messages one at a time). Set to 0 to return all remaining unread messages at once. Set to N to return up to N messages.'),
      },
    },
    async (params) => {
      const limit = params.limit;

      const project = getProjectBySlug(projectSlug);
      if (!project) {
        const baseResponse = JSON.stringify({ success: false, error: `Project '${projectSlug}' not found`, code: 'NOT_FOUND' });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const result = ConversationService.fetchUnread(projectId, { limit });

      const baseResponse = JSON.stringify({ success: true, data: result.messages, last_read_message_id: result.last_read_message_id });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );
}
