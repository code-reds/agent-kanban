// Port and DB_PATH are set by integration-setup.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import { closeDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';

let dbInitialized = false;

function initDb() {
  if (dbInitialized) return;
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
  // Create roles needed by the tests
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  // Create test project
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Newline Integration Test', 'newline-integration-test');
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get('newline-integration-test') as { id: number };
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  dbInitialized = true;
}

describe('Newline handling integration tests', () => {
  const requestAgent = () => request(getApp());

  beforeAll(async () => {
    initDb();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    closeDb();
  });

  describe('REST API — idempotent (real newlines pass through unchanged)', () => {
    it('creates a ticket with real newlines in description via REST API', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'REST API Newline Test',
          column: 'todo',
          description: 'Line one\nLine two\n\nLine four',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.description).toBe('Line one\nLine two\n\nLine four');
      // Should NOT contain literal backslash-n
      expect(res.body.data.description).not.toContain('\\n');
    });

    it('updates a ticket with real newlines in description via REST API', async () => {
      // First create a ticket
      const createRes = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Update Newline Test',
          column: 'todo',
          description: 'Original',
          role_id: 1,
        });
      expect(createRes.status).toBe(201);
      const ticketId = createRes.body.data.id;

      // Update with real newlines
      const updateRes = await requestAgent()
        .patch(`/api/v1/projects/newline-integration-test/tickets/${ticketId}`)
        .send({ description: 'Updated\nwith\nnewlines', role_id: 1 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('success', true);
      expect(updateRes.body.data.description).toBe('Updated\nwith\nnewlines');
      expect(updateRes.body.data.description).not.toContain('\\n');
    });

    it('adds a comment with real newlines via REST API', async () => {
      const createRes = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Comment Newline Test',
          column: 'todo',
          role_id: 1,
        });
      expect(createRes.status).toBe(201);
      const ticketId = createRes.body.data.id;

      const res = await requestAgent()
        .post(`/api/v1/projects/newline-integration-test/tickets/${ticketId}/comments`)
        .send({ content: 'Comment line one\nComment line two', role_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.content).toBe('Comment line one\nComment line two');
    });

    it('moves a ticket with real newlines in comment via REST API', async () => {
      const createRes = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Move Newline Test',
          column: 'todo',
          role_id: 1,
        });
      expect(createRes.status).toBe(201);
      const ticketId = createRes.body.data.id;

      const res = await requestAgent()
        .post(`/api/v1/projects/newline-integration-test/tickets/${ticketId}/move`)
        .send({ to_column: 'implementation', comment: 'Moving\nfor review', role_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      // Verify the move comment was stored with real newlines
      const getRes = await requestAgent()
        .get(`/api/v1/projects/newline-integration-test/tickets/${ticketId}`);
      expect(getRes.status).toBe(200);
      const comments = getRes.body.data.comments as any[];
      const moveComment = comments.find((c: any) => c.content?.includes('Moving'));
      expect(moveComment).toBeDefined();
      expect(moveComment.content).toContain('\n');
    });
  });

  describe('Mixed markdown content via REST API', () => {
    it('creates a ticket with full markdown content', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Full Markdown',
          column: 'todo',
          description: 'First paragraph\n\nSecond paragraph\n\n- Item 1\n- Item 2\n- Item 3\n\n```\nsome code\n```',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      const desc = res.body.data.description;

      // Verify structure is preserved
      expect(desc).toContain('First paragraph');
      expect(desc).toContain('Second paragraph');
      expect(desc).toContain('Item 1');
      expect(desc).toContain('some code');
      // Should have multiple newlines
      expect(desc.split('\n').length).toBeGreaterThan(4);
      // Should NOT contain literal backslash-n
      expect(desc).not.toContain('\\n');
    });

    it('creates a ticket with bold, italic, and code formatting', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Markdown Formatting',
          column: 'todo',
          description: 'This is **bold** and *italic* text.\n\nHere is `inline code`.\n\n```\nfunction hello() {\n  console.log("world");\n}',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      const desc = res.body.data.description;

      // Verify formatting markers are preserved
      expect(desc).toContain('**bold**');
      expect(desc).toContain('*italic*');
      expect(desc).toContain('`inline code`');
      expect(desc).toContain('function hello()');
      expect(desc).toContain('console.log("world")');
      // Should have real newlines, not literal \n
      expect(desc).not.toContain('\\n');
      expect(desc.split('\n').length).toBeGreaterThan(3);
    });
  });

  describe('Database verification — raw bytes', () => {
    it('verifies the database stores actual newline characters (not literal \\n)', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'DB Verification',
          column: 'todo',
          description: 'Line one\nLine two',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      const ticketId = res.body.data.id;

      // Check raw bytes in database
      const db = getDb();
      const row = db.prepare<{ description: string; hex: string }>(
        'SELECT description, hex(description) as hex FROM tickets WHERE id = ?'
      ).get(ticketId);

      expect(row).toBeDefined();
      // hex of actual newline (0x0A) should be present
      expect(row!.hex).toContain('0A');
      // hex of backslash (0x5C) should NOT appear before 'n' (0x6E)
      expect(row!.hex).not.toContain('5C6E');
      // The description should match what we sent
      expect(row!.description).toBe('Line one\nLine two');
    });

    it('verifies comment content stored with real newlines in database', async () => {
      const createRes = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Comment DB Verification',
          column: 'todo',
          role_id: 1,
        });
      expect(createRes.status).toBe(201);
      const ticketId = createRes.body.data.id;

      await requestAgent()
        .post(`/api/v1/projects/newline-integration-test/tickets/${ticketId}/comments`)
        .send({ content: 'Comment\nwith\nnewlines', role_id: 1 });

      const db = getDb();
      const row = db.prepare<{ content: string; hex: string }>(
        'SELECT content, hex(content) as hex FROM ticket_comments WHERE ticket_id = ? ORDER BY id DESC LIMIT 1'
      ).get(ticketId);

      expect(row).toBeDefined();
      // hex should contain 0A for newlines
      expect(row!.hex).toContain('0A');
      expect(row!.content).toBe('Comment\nwith\nnewlines');
    });
  });

  describe('Edge cases via REST API', () => {
    it('handles empty description', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Empty Desc',
          column: 'todo',
          description: '',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe('');
    });

    it('handles single-line description without newlines', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Single Line',
          column: 'todo',
          description: 'Just one line',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe('Just one line');
    });

    it('handles description with only newlines (blank lines)', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Blank Lines',
          column: 'todo',
          description: '\n\n\n',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe('\n\n\n');
    });

    it('handles description with Windows-style CRLF line endings', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'CRLF Test',
          column: 'todo',
          description: 'Line one\r\nLine two\r\n',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe('Line one\r\nLine two\r\n');
    });

    it('handles description with mixed escape sequences (tabs, etc.)', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/newline-integration-test/tickets')
        .send({
          title: 'Mixed Escapes',
          column: 'todo',
          description: 'Tab\there\nNewline\nhere',
          role_id: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe('Tab\there\nNewline\nhere');
    });
  });
});
