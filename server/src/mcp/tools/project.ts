import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSession } from '../session.js';
import { ProjectService } from '../../services/project-service.js';

export function registerProjectTools(server: McpServer, session: McpSession) {
  const projectSlug = session.projectSlug;

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
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, code: result.errorCode }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: result.project }) }],
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
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              role: { id: session.role.id, name: session.role.name },
              project: { id: session.projectId, slug: session.projectSlug },
            },
          }),
        }],
      };
    }
  );
}
