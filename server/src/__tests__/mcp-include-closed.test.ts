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

describe('MCP list_tickets include_closed parameter', () => {
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
    testSlug = `include-closed-test-${Date.now()}-${testCounter}`;

    db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);

    const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
    projectId = nextProjectId.next_id;

    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId,
      testSlug,
      `Include Closed Test Project ${testCounter}`
    );

    seedProjectColumns(projectId, [1, 2, 3, 4, 5, 6, 7]);

    roleId = 1;

    mcpToken = generateTokenUtil();
    const mcpTokenHash = hashTokenUtil(mcpToken);

    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(mcpTokenHash, projectId, roleId, 'include_closed test token');

    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/api/v1/mcp`);
    transport = new SSEClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      },
    });
    client = new Client({
      name: 'include-closed-test-client',
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

  describe('include_closed in "all" mode', () => {
    it('should exclude closed tickets by default in "all" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open ticket 1', column: 'todo' },
      });

      // Create and close a ticket
      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Ticket to close all mode', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      const moveResult = await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done', comment: 'Closing ticket' },
      });
      // Verify move succeeded
      const moveData = JSON.parse(getTextContent(moveResult));
      expect(moveData.success).toBe(true);

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(0);

      // Should still see open tickets
      const openTickets = data.data.tickets.filter((t: any) => t.closed_at === null);
      expect(openTickets.length).toBeGreaterThan(0);
    });

    it('should include closed tickets when include_closed=true in "all" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open ticket for include all', column: 'todo' },
      });

      // Create and close a ticket
      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Ticket to close include all', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(1);

      const openTickets = data.data.tickets.filter((t: any) => t.closed_at === null);
      expect(openTickets.length).toBeGreaterThan(0);
    });
  });

  describe('include_closed in "todo-list" mode', () => {
    it('should exclude closed tickets by default in "todo-list" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open todo-list ticket', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close todo-list ticket', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(0);
    });

    it('should include closed tickets when include_closed=true in "todo-list" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open todo-list include', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close todo-list include', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(1);
    });

    it('should exclude closed when include_closed=false explicitly in "todo-list" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open todo-list explicit', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close explicit false', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list', include_closed: false },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(0);
    });
  });

  describe('include_closed in "not-blocked" mode', () => {
    it('should exclude closed tickets by default in "not-blocked" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open not-blocked', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close not-blocked', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(0);
    });

    it('should include closed tickets when include_closed=true in "not-blocked" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open not-blocked include', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close not-blocked include', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(1);
    });
  });

  describe('include_closed in "top-level-tickets" mode', () => {
    it('should exclude closed tickets by default in "top-level-tickets" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open top-level', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close top-level', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(0);
    });

    it('should include closed tickets when include_closed=true in "top-level-tickets" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open top-level incl', column: 'todo' },
      });

      const openResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close top-level incl', column: 'todo' },
      });
      const ticketId = JSON.parse(getTextContent(openResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: ticketId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);

      const closedTickets = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedTickets.length).toBe(1);
    });
  });

  describe('include_closed total count matches data length', () => {
    it('all mode: total should match open-only data length when include_closed=false', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open ticket total-test', column: 'todo' },
      });
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open ticket 2 total-test', column: 'implementation' },
      });
      const closeResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Ticket to close total', column: 'todo' },
      });
      const closeId = JSON.parse(getTextContent(closeResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: closeId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
      const closedInResults = data.data.tickets.filter((t: any) => t.closed_at !== null);
      // Closed tickets are excluded by default (include_closed=false)
      expect(closedInResults.length).toBe(0);
      expect(data.data.total).toBe(2);
    });

    it('all mode with include_closed=true: total should match full data length', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open ticket full-total', column: 'todo' },
      });
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Ticket to close full', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
    });

    it('todo-list mode: total should match open-only data length', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open todo-list total', column: 'todo' },
      });
      const closeResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close todo-list total', column: 'todo' },
      });
      const closeId = JSON.parse(getTextContent(closeResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: closeId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
      const closedInResults = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedInResults.length).toBe(0);
    });

    it('todo-list mode with include_closed=true: total should match full data length', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open todo-list full', column: 'todo' },
      });
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Ticket to close full todo', column: 'todo' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list', include_closed: true },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
    });

    it('not-blocked mode: total should match open-only data length', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open not-blocked total', column: 'todo' },
      });
      const closeResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close not-blocked total', column: 'todo' },
      });
      const closeId = JSON.parse(getTextContent(closeResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: closeId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
      const closedInResults = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedInResults.length).toBe(0);
    });

    it('top-level-tickets mode: total should match open-only data length', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Open top-level total', column: 'todo' },
      });
      const closeResult = await client!.callTool({
        name: 'create_ticket',
        arguments: { title: 'Close top-level total', column: 'todo' },
      });
      const closeId = JSON.parse(getTextContent(closeResult)).data.id;
      await client!.callTool({
        name: 'move_ticket',
        arguments: { id: closeId, to_column: 'done' },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets' },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.tickets.length).toBe(data.data.total);
      const closedInResults = data.data.tickets.filter((t: any) => t.closed_at !== null);
      expect(closedInResults.length).toBe(0);
    });
  });
});
