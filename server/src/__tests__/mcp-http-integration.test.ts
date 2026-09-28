import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, startMcpServer, stopServer, stopMcp } from '../server.js';
import { getDb } from '../db/database.js';
import { generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../services/auth-service.js';
import { findFreePort } from './test-utils.js';

let testCounter = 0;

let REST_PORT: number;
let MCP_PORT: number;
let MCP_HOST: string;

describe('MCP SSE Integration Tests', () => {
  let mcpToken: string;
  let projectId: number;
  let roleId: number;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let testSlug: string;
  let toolCallSlug: string;
  let toolCallToken: string;

  beforeAll(async () => {
    REST_PORT = await findFreePort();
    MCP_PORT = await findFreePort();
    MCP_HOST = '127.0.0.1';
    process.env.PORT = String(REST_PORT);
    process.env.MCP_PORT = String(MCP_PORT);
    await startServer();
    await startMcpServer();
  });

  afterAll(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    delete process.env.PORT;
    delete process.env.MCP_PORT;
    await stopMcp();
    await stopServer();
  });

  beforeEach(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }

    const db = getDb();
    
    const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
    projectId = nextProjectId.next_id;
    
    testCounter++;
    testSlug = `mcp-sse-${testCounter}`;
    
    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId,
      testSlug,
      `MCP SSE Test Project ${testCounter}`
    );
    
    const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('AI code developer') as { id: number } | undefined;
    roleId = role?.id || 4;
    
    mcpToken = generateTokenUtil();
    const mcpTokenHash = hashTokenUtil(mcpToken);
    
    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(mcpTokenHash, projectId, roleId, 'MCP SSE integration test token');
  });

  describe('MCP Client Connection', () => {
    it('should connect to MCP server with valid token', async () => {
      const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${mcpToken}`,
          },
        },
      });
      
      client = new Client({
        name: 'test-client',
        version: '1.0.0',
      });
      
      await client.connect(transport);
      
      expect(client).toBeDefined();
      
      const result = await client.callTool({
        name: 'get_my_role',
        arguments: {},
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should reject connection with invalid token', async () => {
      const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: 'Bearer invalid-token-12345',
          },
        },
      });
      
      client = new Client({
        name: 'test-client',
        version: '1.0.0',
      });
      
      await expect(client.connect(transport)).rejects.toThrow();
    });

    it('should reject connection without token', async () => {
      const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      
      transport = new StreamableHTTPClientTransport(url, {});
      
      client = new Client({
        name: 'test-client',
        version: '1.0.0',
      });
      
      await expect(client.connect(transport)).rejects.toThrow();
    });

    it('should reject connection with expired token', async () => {
      const db = getDb();
      const expiredSlug = `mcp-expired-${testCounter}`;
      
      const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
      const pId = nextProjectId.next_id;
      
      db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
        pId, expiredSlug, `Expired Test ${testCounter}`
      );
      
   const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('AI code developer') as { id: number } | undefined;
      const rId = role?.id || 4;
      
      const token = generateTokenUtil();
      const tokenHash = hashTokenUtil(token);
      db.prepare(`
        INSERT INTO api_tokens (token_hash, project_id, role_id, description, expires_at, is_active)
        VALUES (?, ?, ?, ?, '2020-01-01 00:00:00', 1)
      `).run(tokenHash, pId, rId, 'Expired token');
      
      const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
      
      client = new Client({
        name: 'test-client',
        version: '1.0.0',
      });
      
      await expect(client.connect(transport)).rejects.toThrow();
    });
  });

  describe('MCP Tool Calls', () => {
    let connectedClient: Client | null = null;
    let connectedTransport: StreamableHTTPClientTransport | null = null;

    beforeAll(async () => {
      const db = getDb();
      toolCallSlug = `mcp-tools-${testCounter}`;
      
      const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
      const pId = nextProjectId.next_id;
      
      db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
        pId, toolCallSlug, `Tools Test ${testCounter}`
      );
      
      const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('AI code developer') as { id: number } | undefined;
      const rId = role?.id || 4;
      
      toolCallToken = generateTokenUtil();
      const tokenHash = hashTokenUtil(toolCallToken);
      db.prepare(`
        INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
        VALUES (?, ?, ?, ?, 1)
      `).run(tokenHash, pId, rId, 'Tools test token');
      
      const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      
      connectedTransport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${toolCallToken}`,
          },
        },
      });
      
      connectedClient = new Client({
        name: 'test-client',
        version: '1.0.0',
      });
      
      await connectedClient.connect(connectedTransport);
    });

    afterAll(async () => {
      if (connectedClient) {
        await connectedClient.close().catch(() => {});
        connectedClient = null;
      }
      if (connectedTransport) {
        await connectedTransport.close().catch(() => {});
        connectedTransport = null;
      }
    });

    it('should call get_my_role tool successfully', async () => {
      const result = await connectedClient!.callTool({
        name: 'get_my_role',
        arguments: {},
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      const textContent = result.content.find(c => c.type === 'text');
      expect(textContent).toBeDefined();
      
      const data = JSON.parse(textContent!.text as string);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.role).toBeDefined();
      expect(data.data.role.name).toBe('AI code developer');
    });

    it('should call get_project_info tool successfully', async () => {
      const result = await connectedClient!.callTool({
        name: 'get_project_info',
        arguments: {},
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      
      const textContent = result.content.find(c => c.type === 'text');
      expect(textContent).toBeDefined();
      
      const data = JSON.parse(textContent!.text as string);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.slug).toBe(toolCallSlug);
    });

    it('should call list_tickets tool successfully', async () => {
      const result = await connectedClient!.callTool({
        name: 'list_tickets',
        arguments: {
          mode: 'all',
        },
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      
      const textContent = result.content.find(c => c.type === 'text');
      expect(textContent).toBeDefined();
      
      const data = JSON.parse(textContent!.text as string);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data.tickets)).toBe(true);
    });

    it('should return error for non-existent tool', async () => {
      const result = await connectedClient!.callTool({
        name: 'non_existent_tool',
        arguments: {},
      });
      
      expect(result).toBeDefined();
      // Non-existent tools return an error or text content explaining the error
      if (result.error) {
        expect(result.error).toBeDefined();
      } else if (result.content && Array.isArray(result.content)) {
        expect(result.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('MCP Session Management', () => {
    it('should handle multiple sequential connections', async () => {
      for (let i = 0; i < 3; i++) {
        const innerSlug = `mcp-session-${testCounter}-${i}`;
        
        const db = getDb();
        const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
        const pId = nextProjectId.next_id;
        
        db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
          pId, innerSlug, `Session Test ${testCounter}-${i}`
        );
        
   const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('AI code developer') as { id: number } | undefined;
        const rId = role?.id || 4;
        
        const token = generateTokenUtil();
        const tokenHash = hashTokenUtil(token);
        db.prepare(`
          INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
          VALUES (?, ?, ?, ?, 1)
        `).run(tokenHash, pId, rId, `Session test token ${i}`);
        
        const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
        
        const testTransport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        });
        
        const testClient = new Client({
          name: 'test-client',
          version: '1.0.0',
        });
        
        await testClient.connect(testTransport);
        
        const result = await testClient.callTool({
          name: 'get_my_role',
          arguments: {},
        });
        
        expect(result).toBeDefined();
        
        await testClient.close().catch(() => {});
        await testTransport.close().catch(() => {});
      }
    });
  });
});
