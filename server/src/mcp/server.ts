import express from 'express';
import type http from 'http';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpSession } from './session.js';
import { validateToken } from './auth.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerProjectTools } from './tools/project.js';
import { ProjectService } from '../services/project-service.js';
import { getRoleById } from '../db/queries/projects.js';

// Single MCP endpoint for the Streamable HTTP transport.
const MCP_ENDPOINT = '/mcp';
const SERVER_NAME = 'agent-kanban-mcp';
const SERVER_VERSION = '1.0.0';

// Track transports by session ID. Each authenticated session owns one
// Streamable HTTP transport (and its connected McpServer) for its lifetime.
const transports = new Map<string, StreamableHTTPServerTransport>();

let app: express.Application | null = null;
let httpServer: http.Server | null = null;

function handleInitialize(
  mcpServer: McpServer,
  transport: StreamableHTTPServerTransport,
  token: string | undefined
) {
  try {
    const validation = validateToken(token as string);

    const projectResult = ProjectService.get(validation.projectSlug);
    if (projectResult.error) {
      throw new Error('Project not found');
    }

    const role = getRoleById(validation.roleId);
    if (!role) {
      throw new Error(`Role ${validation.roleId} not found for project`);
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

function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return undefined;
  }
  return authHeader.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
}

function isInitializeRequest(body: unknown): boolean {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) =>
      !!message &&
      typeof message === 'object' &&
      ((message as { method?: unknown }).method === 'initialize')
  );
}

async function handleMcpRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  // A request without a session ID is only valid if it performs initialization.
  if (!sessionId && !isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: missing session identifier' },
      id: null,
    });
    return;
  }

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // Brand-new connection: this must be the initialize request. Build the
    // transport and McpServer, authenticate, and register tools *before* the
    // initialize message is handled so tool definitions are advertised.
    const token = extractBearerToken(req);

    const newTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        transports.set(sid, newTransport);
      },
    });

    const mcpServer = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    try {
      handleInitialize(mcpServer, newTransport, token);
    } catch (err) {
      await newTransport.close();
      if (newTransport.sessionId) {
        transports.delete(newTransport.sessionId);
      }
      if (!res.headersSent) {
        res.status(401).json({ error: (err as Error).message });
      }
      return;
    }

    newTransport.onclose = () => {
      const sid = newTransport.sessionId;
      if (sid) {
        transports.delete(sid);
      }
    };

    await mcpServer.connect(newTransport);
    transport = newTransport;
  }

  await transport!.handleRequest(req, res, req.body);
}

export async function startMcpServer(
  host: string,
  port: number
): Promise<http.Server> {
  app = express();

  app.use(express.json());
  app.post(MCP_ENDPOINT, handleMcpRequest);

  httpServer = app.listen(port, host, () => {
    console.log(`MCP server listening on ${host}:${port}`);
  });

  return httpServer;
}

export async function stopMcpServer(): Promise<void> {
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
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

export function getSessions(): Map<string, StreamableHTTPServerTransport> {
  return transports;
}
