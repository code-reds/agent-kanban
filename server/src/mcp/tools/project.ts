import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSession } from '../session.js';
import { ProjectService } from '../../services/project-service.js';
import { NotificationService } from '../../services/notification-service.js';
import { amendMCPResponseWithNotifications } from '../utils/notifications.js';

export function registerProjectTools(server: McpServer, session: McpSession) {
  const projectSlug = session.projectSlug;
  const projectId = session.projectId;
  const roleId = session.roleId;

  // get_project_info
  server.registerTool(
    'get_project_info',
    {
      title: 'Get Project Info',
      description: 'Get project details including columns, roles, workflow transitions, and access rules',
    },
    async () => {
      const result = ProjectService.get(projectSlug);

      if (result.error) {
        const baseResponse = JSON.stringify({ success: false, error: result.error, code: result.errorCode });
        const notifications = NotificationService.checkForNotifications(roleId, projectId);
        return {
          content: [{ type: 'text', text: notifications.unreadCount > 0
            ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
            : baseResponse }],
        };
      }

      const baseResponse = JSON.stringify({ success: true, data: result.project });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );

  // get_my_role
  server.registerTool(
    'get_my_role',
    {
      title: 'Get My Role',
      description: 'Get the current role identity and project context',
    },
    async () => {
      const baseResponse = JSON.stringify({
        success: true,
        data: {
          role: { id: session.role.id, name: session.role.name },
          project: { id: session.projectId, slug: session.projectSlug },
        },
      });
      const notifications = NotificationService.checkForNotifications(roleId, projectId);
      return {
        content: [{ type: 'text', text: notifications.unreadCount > 0
          ? amendMCPResponseWithNotifications(baseResponse, notifications.unreadCount)
          : baseResponse }],
      };
    }
  );
}
