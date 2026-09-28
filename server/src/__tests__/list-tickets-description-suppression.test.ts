import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

describe('MCP list_tickets description suppression', () => {
  let mcpToken: string;
  let projectId: number;
  let roleId: number;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let testSlug: string;
  let ticketId: number;
  let ticketWithLongDescription: number;

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
    // Use unique slug with timestamp to avoid collision with previous runs
    testSlug = `desc-test-${Date.now()}-${testCounter}`;

    // Clean up any leftover project with this slug
    db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);

    const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
    projectId = nextProjectId.next_id;

    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId,
      testSlug,
      `Description Test Project ${testCounter}`
    );

    // Seed the project with columns, workflow transitions, and access rules
    seedProjectColumns(projectId, [1, 2, 3, 4, 5, 6, 7]);

    // Use Human User role (role_id=1, full permissions)
    roleId = 1;

    mcpToken = generateTokenUtil();
    const mcpTokenHash = hashTokenUtil(mcpToken);

    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(mcpTokenHash, projectId, roleId, 'Description suppression test token');

    // Connect the MCP client for this test
    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      },
    });
    client = new Client({
      name: 'desc-test-client',
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
    // Clean up project to avoid unique constraint on next test
    try {
      const db = getDb();
      db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('list_tickets should NOT include description', () => {
    it('should suppress description in "all" mode', async () => {
      const createResult = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with long description for all mode',
          description: 'This is a very long description that should be suppressed in list_tickets output but present in create_ticket response',
          column: 'todo',
        },
      });
      const createData = JSON.parse(getTextContent(createResult));
      ticketId = createData.data.id;
      expect(createData.data.description).toBe('This is a very long description that should be suppressed in list_tickets output but present in create_ticket response');

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all' },
      });

      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tickets)).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('description');
      }
    });

    it('should suppress description in "todo-list" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with long description for todo-list mode',
          description: 'This is a very long description that should be suppressed in list_tickets output for todo-list mode',
          column: 'todo',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });

      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tickets)).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('description');
      }
    });

    it('should suppress description in "not-blocked" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with long description for not-blocked mode',
          description: 'This is a very long description that should be suppressed in list_tickets output for not-blocked mode',
          column: 'todo',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });

      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tickets)).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('description');
      }
    });

    it('should suppress description in "top-level-tickets" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with long description for top-level-tickets mode',
          description: 'This is a very long description that should be suppressed in list_tickets output for top-level-tickets mode',
          column: 'todo',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets' },
      });

      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tickets)).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('description');
      }
    });

    it('should suppress description with column filter in "all" mode', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with long description for column filter',
          description: 'This is a very long description that should be suppressed in list_tickets output for column filter',
          column: 'todo',
        },
      });

      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'all', column: 'todo' },
      });

      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tickets)).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('description');
      }
    });
  });

  describe('get_ticket SHOULD include description', () => {
    it('should include full description in get_ticket response', async () => {
      const expectedDescription = 'This is a very long description that should be suppressed in list_tickets but present in get_ticket response';

      const createResult = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket for get_ticket description check',
          description: expectedDescription,
          column: 'todo',
        },
      });
      const createData = JSON.parse(getTextContent(createResult));
      ticketWithLongDescription = createData.data.id;

      const getResult = await client!.callTool({
        name: 'get_ticket',
        arguments: { id: ticketWithLongDescription },
      });
      const getData = JSON.parse(getTextContent(getResult));
      expect(getData.success).toBe(true);
      expect(getData.data.description).toBe(expectedDescription);
    });
  });

  describe('create_ticket SHOULD include description', () => {
    it('should include description in create_ticket response', async () => {
      const expectedDescription = 'Ticket created with description for create_ticket verification';

      const result = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket for create description check',
          description: expectedDescription,
          column: 'todo',
        },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.description).toBe(expectedDescription);
    });

    it('should include empty string description when none provided', async () => {
      const result = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket with no description',
          column: 'todo',
        },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.description).toBe('');
    });
  });

  describe('update_ticket SHOULD include description', () => {
    it('should include description in update_ticket response', async () => {
      const createResult = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket for update description check',
          description: 'Original description',
          column: 'todo',
        },
      });
      const createData = JSON.parse(getTextContent(createResult));
      const updateTicketId = createData.data.id;

      const newDescription = 'Updated description for update_ticket verification';

      const result = await client!.callTool({
        name: 'update_ticket',
        arguments: {
          id: updateTicketId,
          description: newDescription,
        },
      });
      const data = JSON.parse(getTextContent(result));
      expect(data.success).toBe(true);
      expect(data.data.description).toBe(newDescription);
    });
  });

  describe('No mutation side effects', () => {
    it('should not mutate the original ticket description when list_tickets is called multiple times', async () => {
      await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket for mutation check',
          description: 'Description for mutation check',
          column: 'todo',
        },
      });

      for (let i = 0; i < 3; i++) {
        const result = await client!.callTool({
          name: 'list_tickets',
          arguments: { mode: 'all' },
        });
        const data = JSON.parse(getTextContent(result));
        expect(data.success).toBe(true);
        for (const ticket of data.data.tickets) {
          expect(ticket).not.toHaveProperty('description');
        }
      }

      const getResult = await client!.callTool({
        name: 'get_ticket',
        arguments: { id: 999999 },
      });
      const getData = JSON.parse(getTextContent(getResult));
      expect(getData).toBeDefined();
    });
  });
});
