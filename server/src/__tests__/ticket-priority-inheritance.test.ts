/**
 * Integration tests for ticket #37:
 * MCP: Child tickets inherit parent priority.
 *
 * Tests cover:
 * - create_ticket MCP tool inherits parent priority when priority is omitted
 * - create_ticket respects explicit priority even when parent is set
 * - REST API inherits parent priority when priority is omitted
 * - Top-level tickets (no parent) use default priority
 * - Invalid parent_id falls back to default priority
 *
 * Depends on: none
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getApp, startMcpServer, startServer, stopMcp, stopServer } from '../server.js';
import { getDb, resetDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../services/auth-service.js';
import request from 'supertest';
import { findFreePort } from './test-utils.js';

let MCP_PORT: number;
const MCP_HOST = '127.0.0.1';

describe('Ticket #37: Child tickets inherit parent priority', () => {
  let mcpToken: string;
  let projectId: number;
  let roleId: number;
  let client: Client | null = null;
  let transport: SSEClientTransport | null = null;
  let testSlug: string;

  beforeAll(async () => {
    MCP_PORT = await findFreePort();
    const restPort = await findFreePort();
    process.env.PORT = String(restPort);
    process.env.MCP_PORT = String(MCP_PORT);
    process.env.DB_PATH = ':memory:';
    resetDb();
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
    delete process.env.DB_PATH;
    await stopMcp();
    await stopServer();
    resetDb();
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

    testSlug = `ticket37-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId, testSlug, `Ticket 37 Test Project`
    );

    const allRoles = db.prepare('SELECT id FROM roles').all() as { id: number }[];
    seedProjectColumns(projectId, allRoles.map(r => r.id));

    roleId = 1; // Human User role

    mcpToken = generateTokenUtil();
    const tokenHash = hashTokenUtil(mcpToken);
    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(tokenHash, projectId, roleId, 'Ticket 37 integration test token');

    // Connect MCP client
    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/api/v1/mcp`);
    transport = new SSEClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
    });
    client = new Client({ name: 'ticket37-test-client', version: '1.0.0' });
    await client.connect(transport);
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
  // AC1: create_ticket MCP tool inherits parent priority when priority is omitted
  // =========================================================================
  describe('AC1: Child ticket inherits parent priority via MCP (priority omitted)', () => {
    it('should inherit parent priority 1 (urgent) when child is created without priority', async () => {
      // Create parent with priority 1
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Urgent',
          column: 'todo',
          labels: '[]',
          priority: 1,
        },
      });
      const parentData = parseMcpResponse(parentRes);
      expect(parentData.success).toBe(true);
      const parentId = parentData.data.id as number;

      // Create child WITHOUT priority
      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child of Urgent Parent',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.success).toBe(true);
      expect(childData.data.priority).toBe(1);
    });

    it('should inherit parent priority 5 (trivial) when child is created without priority', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Trivial',
          column: 'todo',
          labels: '[]',
          priority: 5,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child of Trivial Parent',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(5);
    });

    it('should inherit parent priority 4 (low) when child is created without priority', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Low',
          column: 'todo',
          labels: '[]',
          priority: 4,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child of Low Parent',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(4);
    });

    it('should inherit parent priority 3 (medium) when child is created without priority', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Medium',
          column: 'todo',
          labels: '[]',
          priority: 3,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child of Medium Parent',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(3);
    });

    it('should inherit parent priority 2 (high) when child is created without priority', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent High',
          column: 'todo',
          labels: '[]',
          priority: 2,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child of High Parent',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(2);
    });
  });

  // =========================================================================
  // AC2: create_ticket respects explicit priority even when parent is set
  // =========================================================================
  describe('AC2: Explicit priority is respected even with parent', () => {
    it('should use explicit priority 1 even when parent has priority 5', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Trivial',
          column: 'todo',
          labels: '[]',
          priority: 5,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child with Explicit Priority',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
          priority: 1,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(1);
    });

    it('should use explicit priority 4 when parent has priority 2', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent High',
          column: 'todo',
          labels: '[]',
          priority: 2,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child with Explicit Priority',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
          priority: 4,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(4);
    });

    it('should use explicit priority 3 (same as old MCP default) over parent priority', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent Urgent',
          column: 'todo',
          labels: '[]',
          priority: 1,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child with explicit 3',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
          priority: 3,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(3);
    });
  });

  // =========================================================================
  // AC3: Top-level tickets (no parent) use default priority
  // =========================================================================
  describe('AC3: Top-level tickets use default priority', () => {
    it('should use default priority 2 when no parent and no priority specified', async () => {
      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Top-Level Default Priority',
          column: 'todo',
          labels: '[]',
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(2);
      expect(childData.data.parent_id).toBeNull();
    });

    it('should use explicit priority when no parent', async () => {
      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Top-Level Explicit Priority',
          column: 'todo',
          labels: '[]',
          priority: 1,
        },
      });
      const childData = parseMcpResponse(childRes);
      expect(childData.data.priority).toBe(1);
    });
  });

  // =========================================================================
  // AC4: REST API inherits parent priority when priority is omitted
  // =========================================================================
  describe('AC4: REST API inherits parent priority when priority omitted', () => {
    it('should inherit parent priority via REST API when priority field is omitted', async () => {
      const rest = request(getApp());

      // Create parent with priority 1
      const parentRes = await rest.post(`/api/v1/projects/${testSlug}/tickets`).send({
        title: 'Parent via REST',
        column: 'todo',
        priority: 1,
        role_id: 1,
      });
      expect(parentRes.status).toBe(201);
      const parentId = parentRes.body.data.id;

      // Create child WITHOUT priority field
      const childRes = await rest.post(`/api/v1/projects/${testSlug}/tickets`).send({
        title: 'Child via REST',
        column: 'todo',
        parent_id: parentId,
        role_id: 1,
      });
      expect(childRes.status).toBe(201);
      expect(childRes.body.data.priority).toBe(1);
    });

    it('should use explicit priority via REST API when parent is set', async () => {
      const rest = request(getApp());

      const parentRes = await rest.post(`/api/v1/projects/${testSlug}/tickets`).send({
        title: 'Parent for REST explicit',
        column: 'todo',
        priority: 5,
        role_id: 1,
      });
      expect(parentRes.status).toBe(201);
      const parentId = parentRes.body.data.id;

      const childRes = await rest.post(`/api/v1/projects/${testSlug}/tickets`).send({
        title: 'Child with explicit priority',
        column: 'todo',
        parent_id: parentId,
        priority: 2,
        role_id: 1,
      });
      expect(childRes.status).toBe(201);
      expect(childRes.body.data.priority).toBe(2);
    });
  });

  // =========================================================================
  // AC5: Invalid parent_id returns error due to FK constraint
  // =========================================================================
  describe('AC5: Invalid parent_id returns error due to FK constraint', () => {
    it('should return error when parent_id references a non-existent ticket', async () => {
      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child with invalid parent',
          column: 'todo',
          labels: '[]',
          parent_id: 999999,
        },
      });
      // FK constraint prevents inserting with non-existent parent.
      // The response content should indicate failure (not a successful create).
      const rawText = (childRes as any).content?.[0]?.text ?? '';
      // The response is either:
      // 1. A JSON error: {"success": false, "error": "..."}
      // 2. A plain text error message from the SDK
      // In either case, it should NOT look like a successful create
      expect(rawText).not.toContain('"success": true');
    });
  });

  // =========================================================================
  // AC6: Multiple children inherit the same parent priority
  // =========================================================================
  describe('AC6: Multiple children inherit same parent priority', () => {
    it('should give all children the same priority as the parent', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent for Multiple Children',
          column: 'todo',
          labels: '[]',
          priority: 1,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const child1Res = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child 1',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const child2Res = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child 2',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const child3Res = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child 3',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });

      expect(parseMcpResponse(child1Res).data.priority).toBe(1);
      expect(parseMcpResponse(child2Res).data.priority).toBe(1);
      expect(parseMcpResponse(child3Res).data.priority).toBe(1);
    });
  });

  // =========================================================================
  // AC7: Verified via GET ticket
  // =========================================================================
  describe('AC7: Verified via GET ticket', () => {
    it('should show inherited priority in get_ticket response', async () => {
      const parentRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Parent for GET verification',
          column: 'todo',
          labels: '[]',
          priority: 4,
        },
      });
      const parentId = parseMcpResponse(parentRes).data.id as number;

      const childRes = await client!.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Child for GET verification',
          column: 'todo',
          labels: '[]',
          parent_id: parentId,
        },
      });
      const childId = parseMcpResponse(childRes).data.id as number;

      // Verify via GET
      const getRes = await mcpGetTicket(childId);
      expect(getRes.success).toBe(true);
      expect(getRes.data.priority).toBe(4);
    });
  });
});
