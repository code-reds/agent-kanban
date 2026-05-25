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

describe('MCP move_ticket new_status response', () => {
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
    testSlug = `move-ticket-newstatus-${Date.now()}-${testCounter}`;

    db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);

    const nextProjectId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projects').get() as { next_id: number };
    projectId = nextProjectId.next_id;

    db.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').run(
      projectId,
      testSlug,
      `Move Ticket NewStatus Test ${testCounter}`
    );

    seedProjectColumns(projectId, [1, 2, 3, 4, 5, 6, 7]);

    roleId = 1;

    mcpToken = generateTokenUtil();
    const mcpTokenHash = hashTokenUtil(mcpToken);

    db.prepare(`
      INSERT INTO api_tokens (token_hash, project_id, role_id, description, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(mcpTokenHash, projectId, roleId, 'Move ticket new_status test token');

    const url = new URL(`http://${MCP_HOST}:${MCP_PORT}/api/v1/mcp`);

    transport = new SSEClientTransport(url, {
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
  });

  afterEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM projects WHERE slug = ?').run(testSlug);
  });

  it('should return new_status with column_slug, is_blocked, and blocking_ticket_ids on successful move', async () => {
    // Create a ticket in todo
    const createResult = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Ticket for move status test',
        column: 'todo',
      },
    });

    const createData = JSON.parse(getTextContent(createResult));
    expect(createData.success).toBe(true);
    const ticketId = createData.data.id;

    // Move the ticket to implementation
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: {
        id: ticketId,
        to_column: 'implementation',
      },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);

    // Verify the new_status object is present and has the correct structure
    expect(moveData.data).toHaveProperty('new_status');
    expect(moveData.data.new_status).toHaveProperty('column_slug', 'implementation');
    expect(moveData.data.new_status).toHaveProperty('is_blocked');
    expect(typeof moveData.data.new_status.is_blocked).toBe('boolean');
    expect(moveData.data.new_status).toHaveProperty('blocking_ticket_ids');
    expect(Array.isArray(moveData.data.new_status.blocking_ticket_ids)).toBe(true);

    // Also verify the original fields are still present
    expect(moveData.data).toHaveProperty('moved', true);
    expect(moveData.data).toHaveProperty('ticket_id', ticketId);
    expect(moveData.data).toHaveProperty('to_column', 'implementation');
  });

  it('should reflect correct blocking state after move to done', async () => {
    // Create a ticket and move it to done
    const createResult = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Ticket for done move status test',
        column: 'todo',
      },
    });

    const createData = JSON.parse(getTextContent(createResult));
    expect(createData.success).toBe(true);
    const ticketId = createData.data.id;

    // Move the ticket to done
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: {
        id: ticketId,
        to_column: 'done',
      },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);
    expect(moveData.data.new_status.column_slug).toBe('done');
    // A simple ticket with no dependencies should not be blocked after moving to done
    expect(moveData.data.new_status.is_blocked).toBe(false);
    expect(moveData.data.new_status.blocking_ticket_ids).toEqual([]);
  });

  it('should include blocking info for a ticket blocked by dependencies', async () => {
    // Create two tickets - one will be a dependency
    const createResult1 = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Dependency ticket',
        column: 'todo',
      },
    });
    const createData1 = JSON.parse(getTextContent(createResult1));
    const depTicketId = createData1.data.id;

    const createResult2 = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Blocked ticket',
        column: 'todo',
      },
    });
    const createData2 = JSON.parse(getTextContent(createResult2));
    const blockedTicketId = createData2.data.id;

    // Add a dependency: blocked ticket depends on the dependency ticket
    const depResult = await client!.callTool({
      name: 'add_dependency',
      arguments: {
        ticket_id: blockedTicketId,
        depends_on_id: depTicketId,
        relation_type: 'blocked_by',
      },
    });
    const depData = JSON.parse(getTextContent(depResult));
    expect(depData.success).toBe(true);

    // Try to move the blocked ticket forward (should fail due to blocking)
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: {
        id: blockedTicketId,
        to_column: 'implementation',
      },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    // The move should fail because the ticket is blocked
    expect(moveData.success).toBe(false);
  });

  it('should return empty blocking info after resolving dependencies', async () => {
    // Create two tickets
    const createResult1 = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Dependency ticket 2',
        column: 'todo',
      },
    });
    const createData1 = JSON.parse(getTextContent(createResult1));
    const depTicketId = createData1.data.id;

    const createResult2 = await client!.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Dependent ticket',
        column: 'todo',
      },
    });
    const createData2 = JSON.parse(getTextContent(createResult2));
    const dependentTicketId = createData2.data.id;

    // Add a dependency
    await client!.callTool({
      name: 'add_dependency',
      arguments: {
        ticket_id: dependentTicketId,
        depends_on_id: depTicketId,
        relation_type: 'blocked_by',
      },
    });

    // First close the dependency ticket
    await client!.callTool({
      name: 'move_ticket',
      arguments: {
        id: depTicketId,
        to_column: 'done',
      },
    });

    // Now move the dependent ticket - it should succeed
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: {
        id: dependentTicketId,
        to_column: 'implementation',
      },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);
    expect(moveData.data.new_status.is_blocked).toBe(false);
    expect(moveData.data.new_status.blocking_ticket_ids).toEqual([]);
  });



  it('should report tickets_unblocked_by_this_move when closing a ticket that blocks others', async () => {
    // Create blocker ticket
    const createResult1 = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'Blocker A', column: 'todo' },
    });
    const blockerA = JSON.parse(getTextContent(createResult1)).data.id;

    // Create dependent ticket
    const createResult2 = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'Dep on A', column: 'todo' },
    });
    const depOnA = JSON.parse(getTextContent(createResult2)).data.id;

    // Add dependency
    await client!.callTool({
      name: 'add_dependency',
      arguments: { ticket_id: depOnA, depends_on_id: blockerA, relation_type: 'blocked_by' },
    });

    // Move blocker to final_review, then move dependent to final_review for setup
    await client!.callTool({ name: 'move_ticket', arguments: { id: blockerA, to_column: 'final_review' } });
    await client!.callTool({ name: 'move_ticket', arguments: { id: depOnA, to_column: 'final_review' } });

    // Move blockerA to done — this should unblock depOnA
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: { id: blockerA, to_column: 'done', comment: 'closing blocker' },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);
    expect(moveData.data.new_status.tickets_unblocked_by_this_move).toBeDefined();
    expect(Array.isArray(moveData.data.new_status.tickets_unblocked_by_this_move)).toBe(true);
    expect(moveData.data.new_status.tickets_unblocked_by_this_move).toContain(depOnA);
  });

  it('should return empty array in tickets_unblocked_by_this_move when no tickets are unblocked', async () => {
    // Create a ticket with no dependents
    const createResult = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'No Deps Ticket', column: 'todo' },
    });
    const ticketId = JSON.parse(getTextContent(createResult)).data.id;

    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: { id: ticketId, to_column: 'done' },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);
    expect(moveData.data.new_status.tickets_unblocked_by_this_move).toEqual([]);
  });

  it('should not include tickets still blocked by other dependencies in tickets_unblocked_by_this_move', async () => {
    // Create two blockers and one dependent that depends on both
    const createResult1 = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'Blocker X', column: 'todo' },
    });
    const blockerX = JSON.parse(getTextContent(createResult1)).data.id;

    const createResult2 = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'Blocker Y', column: 'todo' },
    });
    const blockerY = JSON.parse(getTextContent(createResult2)).data.id;

    const createResult3 = await client!.callTool({
      name: 'create_ticket',
      arguments: { title: 'Dep on X and Y', column: 'todo' },
    });
    const depBoth = JSON.parse(getTextContent(createResult3)).data.id;

    // Add dependencies
    await client!.callTool({
      name: 'add_dependency',
      arguments: { ticket_id: depBoth, depends_on_id: blockerX, relation_type: 'blocked_by' },
    });
    await client!.callTool({
      name: 'add_dependency',
      arguments: { ticket_id: depBoth, depends_on_id: blockerY, relation_type: 'blocked_by' },
    });

    // Move blockers to final_review for cleanup
    await client!.callTool({ name: 'move_ticket', arguments: { id: blockerX, to_column: 'final_review' } });
    await client!.callTool({ name: 'move_ticket', arguments: { id: blockerY, to_column: 'final_review' } });
    await client!.callTool({ name: 'move_ticket', arguments: { id: depBoth, to_column: 'final_review' } });

    // Close blockerX — depBoth is still blocked by blockerY
    const moveResult = await client!.callTool({
      name: 'move_ticket',
      arguments: { id: blockerX, to_column: 'done', comment: 'closing' },
    });

    const moveData = JSON.parse(getTextContent(moveResult));
    expect(moveData.success).toBe(true);
    expect(moveData.data.new_status.tickets_unblocked_by_this_move).toEqual([]);
    expect(moveData.data.new_status.tickets_unblocked_by_this_move).not.toContain(depBoth);
  });

  // Note: Cascade (ETG) move scenarios for tickets_unblocked_by_this_move are
  // covered by unit tests in ticket-unblocked-by-move.test.ts.
  // The MCP move_ticket tests focus on the non-cascade path which is the
  // primary use case for the move_ticket tool.
});
