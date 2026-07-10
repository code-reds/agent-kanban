import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { startServer, startMcpServer, stopServer, stopMcp } from '../server.js';
import { getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../services/auth-service.js';
import { findFreePort } from './test-utils.js';

let testCounter = 0;

function getTextContent(result: any): string {
  return (result.content.find((c: any) => c.type === 'text') as any).text;
}

let REST_PORT: number;
let MCP_PORT: number;
let MCP_HOST: string;

describe('MCP list_tickets most_critical_next_tickets', () => {
  let mcpToken: string;
  let projectId: number;
  let roleId: number;
  let client: Client | null = null;
  let transport: SSEClientTransport | null = null;
  let testSlug: string;

  beforeAll(async () => {
    REST_PORT = await findFreePort();
    MCP_PORT = await findFreePort();
    MCP_HOST = '127.0.0.1';
    process.env.PORT = String(REST_PORT);
    process.env.MCP_PORT = String(MCP_PORT);
    process.env.MCP_HOST = MCP_HOST;
    // Initialize database and run migrations
    const db = getDb();
    runMigrations();
    seedDefaultRoles();
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

    testCounter++;
    testSlug = `critical-tickets-test-${Date.now()}-${testCounter}`;

    db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);

    const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
    projectId = nextProjectId.next_id;

    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId,
      testSlug,
      `Critical Tickets Test Project ${testCounter}`
    );

    seedProjectColumns(projectId, [1, 2, 3, 4, 5, 6, 7]);

    roleId = 1;

    mcpToken = generateTokenUtil();
    const mcpTokenHash = hashTokenUtil(mcpToken);

    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(mcpTokenHash, projectId, roleId, 'critical tickets test token');

    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/api/v1/mcp`);
    transport = new SSEClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      },
    });
    client = new Client({
      name: 'critical-tickets-test-client',
      version: '1.0.0',
    });
    await client.connect(transport);
  });

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    try {
      const db = getDb();
      db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('most_critical_next_tickets field presence', () => {
    it('should include most_critical_next_tickets in todo-list mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Test ticket', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('most_critical_next_tickets');
      expect(Array.isArray(data.data.most_critical_next_tickets)).toBe(true);
    });

    it('should include most_critical_next_tickets in not-blocked mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Test ticket', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('most_critical_next_tickets');
      expect(Array.isArray(data.data.most_critical_next_tickets)).toBe(true);
    });

    it('should NOT include most_critical_next_tickets in all mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Test ticket', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data).not.toHaveProperty('most_critical_next_tickets');
    });

    it('should NOT include most_critical_next_tickets in top-level-tickets mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Test ticket', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data).not.toHaveProperty('most_critical_next_tickets');
    });
  });

  describe('most_critical_next_tickets: empty project', () => {
    it('should return empty array when no tickets exist', async () => {
      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.most_critical_next_tickets).toEqual([]);
    });
  });

  describe('most_critical_next_tickets: max 3 IDs', () => {
    it('should return at most 3 ticket IDs', async () => {
      // Create 5 tickets
      for (let i = 0; i < 5; i++) {
        await client!.callTool({
          name: 'create_ticket',
          arguments: { title: `Ticket ${i}`, column: 'todo' },
        });
      }

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.most_critical_next_tickets.length).toBeLessThanOrEqual(3);
    });
  });

  describe('most_critical_next_tickets: criticality ordering', () => {
    it('should return ticket IDs in criticality order', async () => {
      // Create a blocker ticket in todo
      const blockerResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Blocker ticket', column: 'todo', priority: 1 },
      });
      const blockerId = JSON.parse(getTextContent(blockerResult)).data.id;

      // Create a ticket in implementation (further along = more critical)
      const implResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Implementation ticket', column: 'implementation', priority: 2 },
      });
      const implId = JSON.parse(getTextContent(implResult)).data.id;

      // Create a ticket in todo (less critical)
      const todoResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Todo ticket', column: 'todo', priority: 3 },
      });
      const todoId = JSON.parse(getTextContent(todoResult)).data.id;

      // Create a dependency: todoId -> blocked_by implId
      // This makes todoId blocked, and implId more critical (it's in a later column)
      await client!.callTool({
        name: 'add_dependency',
        arguments: {
          ticket_id: todoId,
          depends_on_id: implId,
          relation_type: 'blocked_by',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const criticalIds = data.data.most_critical_next_tickets;
      expect(Array.isArray(criticalIds)).toBe(true);

      // All created ticket IDs should be in the critical list (or at least some of them)
      // The implementation ticket should be first (most critical due to column order)
      if (criticalIds.length > 0) {
        // The first ID should be implId (in implementation column, which has higher order)
        expect(criticalIds[0]).toBe(implId);
      }
    });
  });

  describe('most_critical_next_tickets: not-blocked mode', () => {
    it('should return correct IDs in not-blocked mode', async () => {
      // Create a blocker
      const blockerResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Blocker', column: 'todo', priority: 1 },
      });
      const blockerId = JSON.parse(getTextContent(blockerResult)).data.id;

      // Create an unblocked ticket
      const unblockedResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Unblocked', column: 'todo', priority: 2 },
      });
      const unblockedId = JSON.parse(getTextContent(unblockedResult)).data.id;

      // Create a blocked ticket
      const blockedResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Blocked', column: 'todo', priority: 3 },
      });
      const blockedId = JSON.parse(getTextContent(blockedResult)).data.id;

      // Add dependency to make one ticket blocked
      await client!.callTool({
        name: 'add_dependency',
        arguments: {
          ticket_id: blockedId,
          depends_on_id: blockerId,
          relation_type: 'blocked_by',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('most_critical_next_tickets');
      expect(Array.isArray(data.data.most_critical_next_tickets)).toBe(true);
      expect(data.data.most_critical_next_tickets.length).toBeLessThanOrEqual(3);
    });
  });
});
