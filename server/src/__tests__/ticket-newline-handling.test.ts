import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles, seedProjectColumns } from '../db/seed.js';
import { TicketService } from '../services/ticket-service.js';

function initDb() {
  resetDb();
  const db = getDb();
  runMigrations();
  seedDefaultRoles();
}

function createProjectWithColumns() {
  const db = getDb();
  const slug = `test-nl-${Date.now()}`;
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('Newline Test Project', slug);
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as { id: number; slug: string };
  const roleIds = db.prepare('SELECT id FROM roles').all() as { id: number }[];
  seedProjectColumns(project.id, roleIds.map(r => r.id));
  return project;
}

function getTodoColumnId(projectId: number) {
  const db = getDb();
  return db.prepare('SELECT id FROM kanban_columns WHERE project_id = ? AND slug = ?').get(projectId, 'todo') as { id: number };
}

describe('TicketService newline handling', () => {
  beforeEach(() => {
    initDb();
  });

  it('stores literal backslash-n as actual newlines in ticket description (create)', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // MCP SDK sends these as literal backslash-n
    const escapedDescription = 'Line one\\nLine two\\n\\nLine four';

    const result = TicketService.create(project.slug, {
      title: 'Newline Test',
      column: 'todo',
      description: escapedDescription,
      role_id: 1,
    });

    expect(result.ticket).toBeDefined();
    // The stored description should have actual newlines
    expect(result.ticket!.description).toContain('\n');
    expect(result.ticket!.description).not.toContain('\\n');
    expect(result.ticket!.description).toBe('Line one\nLine two\n\nLine four');
  });

  it('leaves already-correct newlines unchanged (idempotent)', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // Already has real newlines (e.g., from REST API)
    const realNewlines = 'Line one\nLine two';

    const result = TicketService.create(project.slug, {
      title: 'Idempotent Test',
      column: 'todo',
      description: realNewlines,
      role_id: 1,
    });

    expect(result.ticket).toBeDefined();
    expect(result.ticket!.description).toBe('Line one\nLine two');
  });

  it('stores literal backslash-n as actual newlines in ticket description (update)', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // Create initial ticket
    const db = getDb();
    db.prepare(
      "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_at, created_by_role_id) VALUES (?, ?, ?, 'initial', '[]', 2, datetime('now'), 1)"
    ).run(project.id, col.id, 'Initial Ticket');
    const ticketId = Number(db.prepare('SELECT last_insert_rowid() as id').get().id);

    const result = TicketService.update(project.slug, ticketId, {
      description: 'Updated\\nwith\\nnewlines',
      role_id: 1,
    });

    expect(result.ticket).toBeDefined();
    expect(result.ticket!.description).toContain('\n');
    expect(result.ticket!.description).toBe('Updated\nwith\nnewlines');
  });

  it('stores literal backslash-n as actual newlines in comment content (add_comment)', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // Create initial ticket
    const db = getDb();
    db.prepare(
      "INSERT INTO tickets (project_id, column_id, title, description, labels, priority, created_at, created_by_role_id) VALUES (?, ?, ?, '', '[]', 2, datetime('now'), 1)"
    ).run(project.id, col.id, 'Test Ticket');
    const ticketId = Number(db.prepare('SELECT last_insert_rowid() as id').get().id);

    // MCP SDK sends these as literal backslash-n
    const escapedContent = 'Comment line one\\nComment line two';
    const result = TicketService.addComment(project.slug, ticketId, escapedContent, { role_id: 1 });

    expect(result.comment).toBeDefined();
    expect(result.comment!.content).toContain('\n');
    expect(result.comment!.content).toBe('Comment line one\nComment line two');
  });

  it('handles mixed markdown content correctly', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // Simulates MCP SDK sending markdown with lists and code blocks
    const escapedMarkdown = 'First paragraph\\n\\nSecond paragraph\\n\\n- Item 1\\n- Item 2\\n\\n```\\ncode block\\n```';

    const result = TicketService.create(project.slug, {
      title: 'Mixed Content',
      column: 'todo',
      description: escapedMarkdown,
      role_id: 1,
    });

    expect(result.ticket).toBeDefined();
    // Verify it has real newlines
    expect(result.ticket!.description).toContain('\n');
    // Verify no literal backslash-n remains
    expect(result.ticket!.description).not.toContain('\\n');
    // Verify structure is preserved
    expect(result.ticket!.description).toContain('First paragraph');
    expect(result.ticket!.description).toContain('Second paragraph');
    expect(result.ticket!.description).toContain('Item 1');
    expect(result.ticket!.description).toContain('code block');
  });

  it('handles empty and single-line descriptions', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    // Empty description
    const r1 = TicketService.create(project.slug, {
      title: 'Empty',
      column: 'todo',
      description: '',
      role_id: 1,
    });
    expect(r1.ticket!.description).toBe('');

    // Single line (no escaping needed)
    const r2 = TicketService.create(project.slug, {
      title: 'Single Line',
      column: 'todo',
      description: 'Just one line',
      role_id: 1,
    });
    expect(r2.ticket!.description).toBe('Just one line');
  });

  it('handles description with only whitespace after unescaping', () => {
    const project = createProjectWithColumns();
    const col = getTodoColumnId(project.id);

    const result = TicketService.create(project.slug, {
      title: 'Whitespace Test',
      column: 'todo',
      description: '\\n\\n\\n', // three newlines
      role_id: 1,
    });

    expect(result.ticket).toBeDefined();
    expect(result.ticket!.description).toBe('\n\n\n');
  });
});
