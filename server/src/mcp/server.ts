import express from 'express';
import type http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpSession } from './session.js';
import { validateToken } from './auth.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerProjectTools } from './tools/project.js';
import { ProjectService } from '../services/project-service.js';
import { getRoleById } from '../db/queries/projects.js';

// Track transports by session ID
const transports = new Map<string, SSEServerTransport>();

let app: express.Application | null = null;
let httpServer: http.Server | null = null;

function handleInitialize(mcpServer: McpServer, transport: SSEServerTransport, token: string) {
  try {
    const validation = validateToken(token);

    const projectResult = ProjectService.get(validation.projectSlug);
    if (projectResult.error) {
      return new Error('Project not found');
    }

    const role = getRoleById(validation.roleId);
    if (!role) {
      return new Error(`Role ${validation.roleId} not found for project`);
    }

    const session = new McpSession(
      validation.projectId,
      validation.roleId,
      validation.projectSlug,
      { id: role.id, name: role.name }
    );

    registerTicketTools(mcpServer, session);
    registerConversationTools(mcpServer, session);
    registerProjectTools(mcpServer, session);
  } catch (err: any) {
    throw new Error(err.message || 'Authentication failed');
  }
}

export async function startMcpServer(
  host: string,
  port: number
): Promise<http.Server> {
  app = express();

  // SSE endpoint - establishes the SSE stream
  app.get('/api/v1/mcp', async (req, res) => {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    if (!tokenFromHeader) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    const transport = new SSEServerTransport('/api/v1/mcp/messages', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    transport.onclose = () => {
      transports.delete(sessionId);
    };

    const mcpServer = new McpServer({
      name: 'agent-kanban-mcp',
      version: '1.0.0',
    });

    try {
      handleInitialize(mcpServer, transport, tokenFromHeader);
    } catch (err: any) {
      transports.delete(sessionId);
      if (!res.headersSent) {
        res.status(401).json({ error: err.message });
      }
      return;
    }

    await mcpServer.connect(transport);
  });

  // Messages endpoint - receives client JSON-RPC requests
  app.post('/api/v1/mcp/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Forward the POST request to the transport
    await transport.handlePostMessage(req, res);
  });

  httpServer = app.listen(port, host, () => {
    console.log(`MCP server listening on ${host}:${port}`);
  });

  return httpServer;
}

export async function stopMcpServer(): Promise<void> {
  for (const [sessionId, transport] of transports) {
    try {
      await (transport as any)._sseResponse?.destroy();
    } catch {
      // ignore
    }
    transports.delete(sessionId);
  }

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }

  app = null;
}

export function getApp(): express.Application | null {
  return app;
}

export function getSessions(): Map<string, SSEServerTransport> {
  return transports;
}
