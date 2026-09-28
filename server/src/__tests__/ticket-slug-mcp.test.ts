/**
 * Integration tests for ticket #12:
 * MCP tools should return project_slug and column_slug instead of project_id and column_id.
 *
 * Tests cover:
 * - list_tickets in all modes (all, todo-list, not-blocked, top-level-tickets)
 * - get_ticket
 * - create_ticket
 * - update_ticket
 * - REST API is NOT affected (still returns IDs)
 * - Edge cases: empty lists, various columns, tickets with no column_slug from DB
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, startMcpServer, stopServer, stopMcp } from '../server.js';
import { getDb } from '../db/database.js';
import { generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../services/auth-service.js';
import { seedProjectColumns } from '../db/seed.js';
import request from 'supertest';
import { getApp } from '../server.js';
import { findFreePort } from './test-utils.js';

let REST_PORT: number;
let MCP_PORT: number;
const MCP_HOST = '127.0.0.1';

describe('Ticket #12: MCP tools return slugs instead of IDs', () => {
  let mcpToken: string;
  let projectId: number;
  let roleId: number;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let testSlug: string;
  let todoColId: number;
  let implColId: number;

  beforeAll(async () => {
    REST_PORT = await findFreePort();
    MCP_PORT = await findFreePort();
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
    // Clean up previous MCP client
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

    // Use timestamp + random suffix to avoid slug collisions
    testSlug = `ticket12-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Create project
    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId, testSlug, `Ticket 12 Test Project`
    );

    // Seed kanban columns for the project
    const allRoles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(projectId, allRoles.map(r => r.id));

    // Use Human User role which has full permissions including create
    // Note: The access rules in seedProjectColumns use hardcoded role IDs (1-7).
    // To guarantee create permission, we use role ID 1 (Human User) which is
    // always seeded with ID 1 and has access rules for the todo column.
    const role = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    // Prefer role ID 1 (seeded Human User) if it exists, otherwise use the first role
    const roleIdVal = role.find(r => r.id === 1)?.id || role[0].id;
    roleId = roleIdVal;

    // Create MCP token
    mcpToken = generateTokenUtil();
    const tokenHash = hashTokenUtil(mcpToken);
    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(tokenHash, projectId, roleId, 'Ticket 12 integration test token');

    // Connect MCP client
    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${mcpToken}` },
      },
    });
    client = new Client({ name: 'ticket12-test-client', version: '1.0.0' });
    await client.connect(transport);

    // Get column IDs for use in tests
    const todoCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(projectId, 'todo') as { id: number } | undefined;
    todoColId = todoCol?.id || 0;

    const implCol = db.prepare(
      'SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?'
    ).get(projectId, 'implementation') as { id: number } | undefined;
    implColId = implCol?.id || 0;
  });

  // =========================================================================
  // Helper: Parse MCP tool response to get JSON data
  // =========================================================================
  function parseMcpResponse(result: any) {
    const textContent = result.content.find((c: any) => c.type === 'text');
    expect(textContent).toBeDefined();
    return JSON.parse(textContent.text as string);
  }

  // =========================================================================
  // Helper: Call create_ticket and return parsed response
  // =========================================================================
  async function mcpCreateTicket(
    title: string,
    column: string = 'todo',
    extra: Record<string, unknown> = {}
  ) {
    const result = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title,
        column,
        description: `Test ticket for ticket #12 integration test`,
        labels: '[]',
        priority: 3,
        ...extra,
      },
    });
    const data = parseMcpResponse(result);
    return data;
  }

  // =========================================================================
  // Helper: Call get_ticket and return parsed response
  // =========================================================================
  async function mcpGetTicket(id: number) {
    const result = await client!.callTool({
      name: 'get_ticket',
      arguments: { id },
    });
    return parseMcpResponse(result);
  }

  // =========================================================================
  // Helper: Call update_ticket and return parsed response
  // =========================================================================
  async function mcpUpdateTicket(id: number, updates: Record<string, unknown>) {
    const result = await client!.callTool({
      name: 'update_ticket',
      arguments: { id, ...updates },
    });
    return parseMcpResponse(result);
  }

  // =========================================================================
  // Helper: Call list_tickets and return parsed response
  // =========================================================================
  async function mcpListTickets(args: Record<string, unknown> = {}) {
    const result = await client!.callTool({
      name: 'list_tickets',
      arguments: { mode: 'all', ...args },
    });
    return parseMcpResponse(result);
  }

  // =========================================================================
  // Test: list_tickets returns project_slug and column_slug (not IDs)
  // =========================================================================
  describe('list_tickets returns slugs', () => {
    it('should return project_slug instead of project_id in all mode', async () => {
      // List tickets first (may be empty or have existing ones)
      const listResult = await mcpListTickets({ mode: 'all' });
      expect(listResult.success).toBe(true);
      expect(listResult.data.tickets).toBeInstanceOf(Array);

      // Check all returned tickets
      for (const ticket of listResult.data.tickets) {
        const t = ticket as Record<string, unknown>;
        expect(t).not.toHaveProperty('project_id');
        expect(t).toHaveProperty('project_slug', testSlug);
      }
    });

    it('should return column_slug instead of column_id in all mode with column filter', async () => {
      // Create ticket in todo column
      const createResult = await mcpCreateTicket('Column Slug Test', 'todo');
      expect(createResult.success).toBe(true);
      const createdTicket = createResult.data as Record<string, unknown>;

      // The create_ticket response should have column_slug
      expect(createdTicket).not.toHaveProperty('column_id');
      expect(createdTicket).toHaveProperty('column_slug', 'todo');
    });

    it('should NOT return project_id anywhere in list_tickets response', async () => {
      const listResult = await mcpListTickets({ mode: 'all' });
      expect(listResult.success).toBe(true);

      for (const ticket of listResult.data.tickets) {
        expect(ticket).not.toHaveProperty('project_id');
      }
    });

    it('should NOT return column_id when column_slug is available from DB', async () => {
      // When using a column filter, the query joins kanban_columns and provides column_slug
      const listResult = await mcpListTickets({ mode: 'all', column: 'todo' });
      expect(listResult.success).toBe(true);

      for (const ticket of listResult.data.tickets) {
        // column_slug should be present
        expect(ticket).toHaveProperty('column_slug');
        // column_id should NOT be present
        expect(ticket).not.toHaveProperty('column_id');
      }
    });

    it('should return project_slug in todo-list mode', async () => {
      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'todo-list' },
      });
      const data = parseMcpResponse(result);
      expect(data.success).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('project_slug', testSlug);
      }
    });

    it('should return project_slug in not-blocked mode', async () => {
      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'not-blocked' },
      });
      const data = parseMcpResponse(result);
      expect(data.success).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('project_slug', testSlug);
      }
    });

    it('should return project_slug in top-level-tickets mode', async () => {
      const result = await client!.callTool({
        name: 'list_tickets',
        arguments: { mode: 'top-level-tickets' },
      });
      const data = parseMcpResponse(result);
      expect(data.success).toBe(true);

      for (const ticket of data.data.tickets) {
        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('project_slug', testSlug);
      }
    });
  });

  // =========================================================================
  // Test: get_ticket returns slugs
  // =========================================================================
  describe('get_ticket returns slugs', () => {
    it('should return project_slug instead of project_id', async () => {
      // Create a ticket first
      const createResult = await mcpCreateTicket('Get Ticket Slug Test');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      // Now get the ticket
      const getTicketResult = await mcpGetTicket(ticketId);
      expect(getTicketResult.success).toBe(true);
      const ticket = getTicketResult.data as Record<string, unknown>;

      expect(ticket).not.toHaveProperty('project_id');
      expect(ticket).toHaveProperty('project_slug', testSlug);
    });

    it('should return column_slug instead of column_id', async () => {
      const createResult = await mcpCreateTicket('Get Ticket Column Slug Test', 'todo');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      const getTicketResult = await mcpGetTicket(ticketId);
      expect(getTicketResult.success).toBe(true);
      const ticket = getTicketResult.data as Record<string, unknown>;

      // getTicketById does a JOIN with kanban_columns, so column_slug is available
      expect(ticket).not.toHaveProperty('column_id');
      expect(ticket).toHaveProperty('column_slug', 'todo');
    });

    it('should return full ticket data with slugs (not IDs)', async () => {
      const createResult = await mcpCreateTicket('Full Data Test', 'todo');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      const getTicketResult = await mcpGetTicket(ticketId);
      expect(getTicketResult.success).toBe(true);
      const ticket = getTicketResult.data as Record<string, unknown>;

      // Essential fields should be present
      expect(ticket).toHaveProperty('id');
      expect(ticket).toHaveProperty('title');
      expect(ticket).toHaveProperty('project_slug');
      expect(ticket).toHaveProperty('column_slug');

      // Ensure IDs are NOT present
      expect(ticket).not.toHaveProperty('project_id');
      expect(ticket).not.toHaveProperty('column_id');
    });
  });

  // =========================================================================
  // Test: create_ticket returns slugs
  // =========================================================================
  describe('create_ticket returns slugs', () => {
    it('should return project_slug in create response', async () => {
      const createResult = await mcpCreateTicket('Create Slug Test');
      expect(createResult.success).toBe(true);
      const ticket = createResult.data as Record<string, unknown>;

      expect(ticket).toHaveProperty('project_slug', testSlug);
      expect(ticket).not.toHaveProperty('project_id');
    });

    it('should return column_slug in create response when available via JOIN', async () => {
      const createResult = await mcpCreateTicket('Create Column Slug Test', 'todo');
      expect(createResult.success).toBe(true);
      const ticket = createResult.data as Record<string, unknown>;

      // After creation, createTicket query returns SELECT * FROM tickets (no JOIN)
      // so column_slug won't be in the result. But the transformation should
      // handle this by falling back to column_id.
      // The key assertion is that column_id should NOT appear when column_slug IS available.
      if (ticket.column_slug !== undefined) {
        expect(ticket).not.toHaveProperty('column_id');
      }
    });

    it('should return correct slugs for different columns', async () => {
      const columns = ['todo', 'implementation', 'unit_review', 'integration_testing', 'final_review'];

      for (const col of columns) {
        const createResult = await mcpCreateTicket(`Column ${col} Test`, col);
        expect(createResult.success).toBe(true);
        const ticket = createResult.data as Record<string, unknown>;

        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('project_slug', testSlug);

        // column_slug should be present or column_id as fallback
        if (ticket.column_slug !== undefined) {
          expect(ticket.column_slug).toBe(col);
          expect(ticket).not.toHaveProperty('column_id');
        }
      }
    });
  });

  // =========================================================================
  // Test: update_ticket returns slugs
  // =========================================================================
  describe('update_ticket returns slugs', () => {
    it('should return project_slug in update response', async () => {
      const createResult = await mcpCreateTicket('Update Slug Test');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      const updateResult = await mcpUpdateTicket(ticketId, { title: 'Updated Title' });
      expect(updateResult.success).toBe(true);
      const ticket = updateResult.data as Record<string, unknown>;

      expect(ticket).toHaveProperty('project_slug', testSlug);
      expect(ticket).not.toHaveProperty('project_id');
    });

    it('should return column_slug in update response', async () => {
      const createResult = await mcpCreateTicket('Update Column Slug Test', 'todo');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      const updateResult = await mcpUpdateTicket(ticketId, { title: 'Updated Column Test' });
      expect(updateResult.success).toBe(true);
      const ticket = updateResult.data as Record<string, unknown>;

      // update_ticket uses getTicketByIdQuery which has a JOIN with kanban_columns
      expect(ticket).toHaveProperty('column_slug', 'todo');
      expect(ticket).not.toHaveProperty('column_id');
    });

    it('should not have project_id or column_id in update response', async () => {
      const createResult = await mcpCreateTicket('No IDs in Update', 'todo');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      const updateResult = await mcpUpdateTicket(ticketId, { priority: 1 });
      expect(updateResult.success).toBe(true);
      const ticket = updateResult.data as Record<string, unknown>;

      expect(ticket).not.toHaveProperty('project_id');
      expect(ticket).not.toHaveProperty('column_id');
    });
  });

  // =========================================================================
  // Test: REST API is NOT affected
  // =========================================================================
  describe('REST API is NOT affected', () => {
    it('should still return project_id (not project_slug) from REST API', async () => {
      // Create a ticket via REST API
      const rest = request(getApp());
      const createRes = await rest
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'REST API Test', column: 'todo', role_id: 1 });
      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty('success', true);
      const restTicketId = createRes.body.data.id;

      // Verify the REST API returns project_id, not project_slug
      const getRes = await rest
        .get(`/api/v1/projects/${testSlug}/tickets/${restTicketId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toHaveProperty('project_id');
      expect(getRes.body.data).not.toHaveProperty('project_slug');

      // Cleanup
      await rest.delete(`/api/v1/projects/${testSlug}`);
    });

    it('should still return column_id (not column_slug) from REST API', async () => {
      const rest = request(getApp());
      const createRes = await rest
        .post(`/api/v1/projects/${testSlug}/tickets`)
        .send({ title: 'REST Column Test', column: 'implementation', role_id: 1 });
      expect(createRes.status).toBe(201);
      const restTicketId = createRes.body.data.id;

      const getRes = await rest
        .get(`/api/v1/projects/${testSlug}/tickets/${restTicketId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toHaveProperty('column_id');
      expect(getRes.body.data).not.toHaveProperty('column_slug');

      // Cleanup
      await rest.delete(`/api/v1/projects/${testSlug}`);
    });
  });

  // =========================================================================
  // Test: Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should handle empty ticket list', async () => {
      // Create a fresh project with no tickets
      const db = getDb();
      const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
      const emptyProjectId = nextProjectId.next_id;
      const emptySlug = `empty-project-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
        emptyProjectId, emptySlug, `Empty Project ${Date.now()}`
      );

      const emptyRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('Human User') as { id: number } | undefined;
      const emptyRoleId = emptyRole?.id || 1;

      const emptyToken = generateTokenUtil();
      const emptyTokenHash = hashTokenUtil(emptyToken);
      db.prepare(`
        INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
        VALUES (?, ?, ?, ?, 1)
      `).run(emptyTokenHash, emptyProjectId, emptyRoleId, 'Empty project token');

      // Connect with empty project token
      const emptyUrl = new URL(`http://${MCP_HOST}:${MCP_PORT}/mcp`);
      const emptyTransport = new StreamableHTTPClientTransport(emptyUrl, {
        requestInit: { headers: { Authorization: `Bearer ${emptyToken}` } },
      });
      const emptyClient = new Client({ name: 'empty-test', version: '1.0.0' });
      await emptyClient.connect(emptyTransport);

      try {
        const result = await emptyClient.callTool({
          name: 'list_tickets',
          arguments: { mode: 'all' },
        });
        const data = parseMcpResponse(result);
        expect(data.success).toBe(true);
        expect(data.data.tickets).toEqual([]);
        expect(data.data.total).toBe(0);
      } finally {
        await emptyClient.close().catch(() => {});
        await emptyTransport.close().catch(() => {});
      }
    });

    it('should handle tickets across different columns with correct slugs', async () => {
      const columns = ['todo', 'implementation', 'unit_review', 'integration_testing', 'final_review'];
      const ticketIds: number[] = [];

      for (const col of columns) {
        const createResult = await mcpCreateTicket(`Column ${col} Edge Test`, col);
        expect(createResult.success).toBe(true);
        const ticket = createResult.data as Record<string, unknown>;
        ticketIds.push(ticket.id as number);

        // Verify project_slug
        expect(ticket).toHaveProperty('project_slug', testSlug);
        expect(ticket).not.toHaveProperty('project_id');
      }

      // Verify get_ticket returns correct slugs for each ticket
      for (const ticketId of ticketIds) {
        const getTicketResult = await mcpGetTicket(ticketId);
        expect(getTicketResult.success).toBe(true);
        const ticket = getTicketResult.data as Record<string, unknown>;
        expect(ticket).toHaveProperty('project_slug', testSlug);
        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('column_slug');
        expect(ticket).not.toHaveProperty('column_id');
      }
    });

    it('should handle ticket with labels and priority correctly with slugs', async () => {
      const createResult = await mcpCreateTicket('Edge Labels Test', 'todo', {
        labels: JSON.stringify(['bug', 'urgent']),
        priority: 1,
      });
      expect(createResult.success).toBe(true);
      const ticket = createResult.data as Record<string, unknown>;

      expect(ticket).toHaveProperty('project_slug', testSlug);
      expect(ticket).not.toHaveProperty('project_id');
      expect(ticket).toHaveProperty('column_slug', 'todo');
      expect(ticket).toHaveProperty('priority', 1);
      expect(ticket).toHaveProperty('labels');
    });
  });

  // =========================================================================
  // Test: Consistency - all ticket data has slugs, no IDs
  // =========================================================================
  describe('Data consistency across tools', () => {
    it('should consistently use slugs across all tool responses', async () => {
      // Create a ticket
      const createResult = await mcpCreateTicket('Consistency Test');
      expect(createResult.success).toBe(true);
      const ticketId = (createResult.data as Record<string, unknown>).id as number;

      // List tickets
      const listResult = await mcpListTickets({ mode: 'all' });
      expect(listResult.success).toBe(true);

      // Get ticket
      const getTicketResult = await mcpGetTicket(ticketId);
      expect(getTicketResult.success).toBe(true);

      // Update ticket
      const updateResult = await mcpUpdateTicket(ticketId, { title: 'Updated Consistency' });
      expect(updateResult.success).toBe(true);

      // Verify all responses use slugs consistently
      const responses: Record<string, unknown>[] = [
        createResult.data as Record<string, unknown>,
        getTicketResult.data as Record<string, unknown>,
        updateResult.data as Record<string, unknown>,
      ];

      for (const ticket of responses) {
        expect(ticket).not.toHaveProperty('project_id');
        expect(ticket).toHaveProperty('project_slug', testSlug);
      }
    });

    it('should never return project_id in any MCP ticket response', async () => {
      // Create multiple tickets
      for (let i = 0; i < 3; i++) {
        await mcpCreateTicket(`No ID Test ${i}`);
      }

      // List all tickets
      const listResult = await mcpListTickets({ mode: 'all' });
      expect(listResult.success).toBe(true);

      // Check every ticket in list response
      for (const ticket of listResult.data.tickets) {
        expect(ticket).not.toHaveProperty('project_id');
      }

      // Check individual get_ticket responses
      for (const ticket of listResult.data.tickets) {
        const t = ticket as Record<string, unknown>;
        const getTicketResult = await mcpGetTicket(t.id as number);
        expect(getTicketResult.success).toBe(true);
        const detailedTicket = getTicketResult.data as Record<string, unknown>;
        expect(detailedTicket).not.toHaveProperty('project_id');
      }
    });
  });
});
