import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import { ConversationService } from '../services/conversation-service.js';

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

      const result = ConversationService.fetchUnread(project.id, { fetchedUntilId: 0 });
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

      const result = ConversationService.fetchUnread(project.id, { fetchedUntilId: 0, limit: 2 });
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
});
