import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import { ConversationService } from '../services/conversation-service.js';
import { ticketEvents, CONVERSATION_CREATED, CONVERSATION_MESSAGE_SENT, CONVERSATION_READ_UPDATED, CONVERSATION_DELETED } from '../services/event-emitter.js';

function initDb() {
  resetDb();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = OFF");
  try { db.exec("DROP TABLE IF EXISTS schema_migrations"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS projects"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS roles"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS kanban_columns"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS workflow_transitions"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS transition_allowed_roles"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_access_rules"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS tickets"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_dependencies"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_comments"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_status_history"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS conversations"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS messages"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS api_tokens"); } catch { }
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations();
  seedDefaultRoles();
}

function createProject(db: any, slug: string, name: string) {
  db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run(name, slug);
  return db.prepare<[string], { id: number }>('SELECT id FROM projects WHERE slug = ?').get(slug);
}

function createConversation(db: any, projectId: number, fromRoleId: number, toRoleId: number) {
  const existing = db.prepare<[number, number, number]>(
    'SELECT id FROM conversations WHERE project_id = ? AND from_role_id = ? AND to_role_id = ?'
  ).get(projectId, fromRoleId, toRoleId);

  if (existing) return existing;

  return db.prepare<[number, number, number]>(
    'INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, ?, ?)'
  ).run(projectId, fromRoleId, toRoleId);
}

describe('ConversationService', () => {
  beforeEach(() => {
    initDb();
  });

  describe('list', () => {
    it('returns empty array when no conversations exist', () => {
      const db = getDb();
      const project = createProject(db, 'test-empty', 'Empty');
      const result = ConversationService.list(project.id);
      expect(result.conversations).toEqual([]);
    });

    it('returns conversations with role names', () => {
      const db = getDb();
      const project = createProject(db, 'test-list', 'List');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      createConversation(db, project.id, roleIds[1].id, roleIds[0].id);

      const result = ConversationService.list(project.id);
      expect(result.conversations).toHaveLength(2);
      expect(result.conversations[0]).toHaveProperty('from_role_name');
      expect(result.conversations[0]).toHaveProperty('to_role_name');
    });
  });

  describe('getById', () => {
    it('returns undefined and error for non-existent conversation', () => {
      const db = getDb();
      const project = createProject(db, 'test-notfound', 'NotFound');
      const result = ConversationService.getById(project.id, 99999);
      expect(result.error).toContain('not found');
      expect(result.conversation).toBeUndefined();
    });

    it('returns conversation with messages', () => {
      const db = getDb();
      const project = createProject(db, 'test-getbyid', 'GetById');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id);

      db.prepare<[number, number, string]>(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conversation.id, roleIds[1].id, 'Hello');

      const result = ConversationService.getById(project.id, conversation.id);
      expect(result.conversation).toBeDefined();
      expect(result.conversation!.messages).toHaveLength(1);
      expect(result.conversation!.messages[0].content).toBe('Hello');
    });
  });

  describe('sendMessage', () => {
    it('returns validation error for empty content', () => {
      const result = ConversationService.sendMessage(1, 1, '', {});
      expect(result.error).toContain('Content is required');
      expect(result.statusCode).toBe(400);
    });

    it('returns validation error for null content', () => {
      const result = ConversationService.sendMessage(1, 1, null as unknown as string, {});
      expect(result.error).toContain('Content is required');
    });

    it('returns not found for non-existent conversation', () => {
      const result = ConversationService.sendMessage(999, 99999, 'hello', {});
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });

    it('sends a message successfully', () => {
      const db = getDb();
      const project = createProject(db, 'test-send', 'Send');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id)!;

      const result = ConversationService.sendMessage(project.id, conversation.id, 'Hello world', {
        sender_role_id: roleIds[1].id,
      });

      expect(result.message).toBeDefined();
      expect(result.message!.content).toBe('Hello world');
      expect(result.message!.sender_role_id).toBe(roleIds[1].id);
    });
  });

  describe('fetchUnread', () => {
    it('returns empty messages when no conversations exist', () => {
      const db = getDb();
      const project = createProject(db, 'test-unread', 'Unread');
      const result = ConversationService.fetchUnread(project.id, {});
      expect(result.messages).toEqual([]);
    });

    it('returns messages from conversations', () => {
      const db = getDb();
      const project = createProject(db, 'test-unread2', 'Unread2');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id);

      db.prepare<[number, number, string]>(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conversation.id, roleIds[1].id, 'New message');

      const result = ConversationService.fetchUnread(project.id, {});
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('New message');
    });

    it('respects limit parameter', () => {
      const db = getDb();
      const project = createProject(db, 'test-limit', 'Limit');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id);

      for (let i = 0; i < 5; i++) {
        db.prepare<[number, number, string]>(
          'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
        ).run(conversation.id, roleIds[1].id, `Message ${i}`);
      }

      const result = ConversationService.fetchUnread(project.id, { limit: 2 });
      expect(result.messages.length).toBeLessThanOrEqual(2);
    });
  });

  describe('findOrCreateByRoleNames', () => {
    it('returns error when from role not found', () => {
      const result = ConversationService.findOrCreateByRoleNames(1, 'Nonexistent Role', 'Human User');
      expect(result.error).toContain('not found');
      expect(result.conversation).toBeUndefined();
    });

    it('returns error when to role not found', () => {
      const result = ConversationService.findOrCreateByRoleNames(1, 'Human User', 'Nonexistent Role');
      expect(result.error).toContain('not found');
      expect(result.conversation).toBeUndefined();
    });

    it('finds existing conversation when from->to exists', () => {
      const db = getDb();
      const project = createProject(db, 'test-create-by-name-1', 'CreateByName1');
      createConversation(db, project.id, 1, 2);

      const result = ConversationService.findOrCreateByRoleNames(
        project.id,
        'Human User',
        'AI teamleader'
      );
      expect(result.conversation).toBeDefined();
    });

    it('creates conversation when no existing conversation found', () => {
      const db = getDb();
      const project = createProject(db, 'test-create-by-name-2', 'CreateByName2');

      const result = ConversationService.findOrCreateByRoleNames(
        project.id,
        'AI code developer',
        'AI architect'
      );
      expect(result.conversation).toBeDefined();
      expect(result.conversation).toHaveProperty('id');
    });

    it('creates conversation between two non-Human roles', () => {
      const db = getDb();
      const project = createProject(db, 'test-create-by-name-3', 'CreateByName3');

      const result = ConversationService.findOrCreateByRoleNames(
        project.id,
        'AI teamleader',
        'AI code developer'
      );
      expect(result.conversation).toBeDefined();
      expect(result.conversation).toHaveProperty('id');
    });
  });

  describe('event emissions', () => {
    let emitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      ticketEvents.clearAll();
      emitSpy = vi.spyOn(ticketEvents, 'emit');
    });

    afterEach(() => {
      ticketEvents.clearAll();
      emitSpy.mockRestore();
    });

    it('emits conversation.created when findOrCreateByRoleId creates a new conversation', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-create-1', 'EventCreate1');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();

      const result = ConversationService.findOrCreateByRoleId(project.id, roleIds[2].id);

      expect(result.conversation).toBeDefined();
      expect(result.conversation!.id).toBeGreaterThan(0);

      expect(emitSpy).toHaveBeenCalledWith(
        CONVERSATION_CREATED,
        expect.objectContaining({
          conversation_id: result.conversation!.id,
          project_slug: 'test-event-create-1',
        })
      );
    });

    it('emits conversation.created when findOrCreateByRoleNames creates a new conversation', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-create-2', 'EventCreate2');

      const result = ConversationService.findOrCreateByRoleNames(
        project.id,
        'AI code developer',
        'AI architect'
      );

      expect(result.conversation).toBeDefined();

      expect(emitSpy).toHaveBeenCalledWith(
        CONVERSATION_CREATED,
        expect.objectContaining({
          conversation_id: result.conversation!.id,
          project_slug: 'test-event-create-2',
        })
      );
    });

    it('does not emit conversation.created when findOrCreateByRoleId finds existing conversation', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-no-create', 'EventNoCreate');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();

      // Find Human User role (id=1) and another role
      const humanRole = roleIds.find(r => r.id === 1);
      const otherRole = roleIds.find(r => r.id !== 1);
      expect(humanRole).toBeDefined();
      expect(otherRole).toBeDefined();

      // Create conversation between Human User and the other role
      createConversation(db, project.id, humanRole!.id, otherRole!.id);

      // Finding existing should not emit conversation.created
      const result = ConversationService.findOrCreateByRoleId(project.id, otherRole!.id);
      expect(result.conversation).toBeDefined();

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('emits conversation.message_sent when sendMessage succeeds', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-msg', 'EventMsg');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id)!;

      const result = ConversationService.sendMessage(project.id, conversation.id, 'Hello event', {
        sender_role_id: roleIds[1].id,
      });

      expect(result.message).toBeDefined();

      expect(emitSpy).toHaveBeenCalledWith(
        CONVERSATION_MESSAGE_SENT,
        expect.objectContaining({
          conversation_id: conversation.id,
          project_slug: 'test-event-msg',
          message: expect.objectContaining({
            content: 'Hello event',
          }),
        })
      );
    });

    it('emits conversation.read_updated when markConversationAsRead is called', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-read', 'EventRead');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id)!;

      // Add a message so there's something to mark as read
      db.prepare<[number, number, string]>(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conversation.id, roleIds[1].id, 'Read me');

      ConversationService.markConversationAsRead(conversation.id, project.id);

      expect(emitSpy).toHaveBeenCalledWith(
        CONVERSATION_READ_UPDATED,
        expect.objectContaining({
          conversation_id: conversation.id,
          project_slug: 'test-event-read',
          last_read_message_id: expect.any(Number),
        })
      );
    });

    it('emits conversation.deleted when delete succeeds', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-delete', 'EventDelete');
      const roleIds = db.prepare<[], { id: number }>('SELECT id FROM roles').all();
      createConversation(db, project.id, roleIds[0].id, roleIds[1].id);
      const conversation = db.prepare<[number], { id: number }>('SELECT id FROM conversations WHERE project_id = ?').get(project.id)!;

      // Add a message
      db.prepare<[number, number, string]>(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conversation.id, roleIds[1].id, 'Delete me');

      const result = ConversationService.delete(project.id, conversation.id);

      expect(result.success).toBe(true);

      // Verify conversation is actually deleted
      const remaining = db.prepare<[number], { count: number }>(
        'SELECT COUNT(*) as count FROM conversations WHERE id = ?'
      ).get(conversation.id) as { count: number };
      expect(remaining.count).toBe(0);

      // Verify messages are deleted
      const msgCount = db.prepare<[number], { count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?'
      ).get(conversation.id) as { count: number };
      expect(msgCount.count).toBe(0);

      expect(emitSpy).toHaveBeenCalledWith(
        CONVERSATION_DELETED,
        expect.objectContaining({
          conversation_id: conversation.id,
          project_slug: 'test-event-delete',
        })
      );
    });

    it('delete returns 404 for non-existent conversation', () => {
      const db = getDb();
      const project = createProject(db, 'test-event-delete-404', 'EventDelete404');

      const result = ConversationService.delete(project.id, 99999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('all conversation event type constants have correct values', () => {
      expect(CONVERSATION_CREATED).toBe('conversation.created');
      expect(CONVERSATION_MESSAGE_SENT).toBe('conversation.message_sent');
      expect(CONVERSATION_READ_UPDATED).toBe('conversation.read_updated');
      expect(CONVERSATION_DELETED).toBe('conversation.deleted');
    });
  });
});
