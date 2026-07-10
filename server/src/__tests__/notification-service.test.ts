import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { seedDefaultRoles } from '../db/seed.js';
import { NotificationService } from '../services/notification-service.js';
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
  try { db.exec("DROP TABLE IF EXISTS roles_columns"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS global_settings_metadata"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_roots"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS forward_transitions"); } catch { }
  try { db.exec("DROP TABLE IF EXISTS ticket_blockers"); } catch { }
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations();
  seedDefaultRoles();
}

describe('NotificationService', () => {
  beforeEach(() => {
    initDb();
  });

  it('returns 0 unread when no conversations exist', () => {
    const project = getDb().prepare(
      "INSERT INTO projects (name, slug, description) VALUES (?, ?, ?) RETURNING id"
    ).get('test-notifications', 'test-notif', 'Test') as { id: number };

    const result = NotificationService.checkForNotifications(1, project.id);
    expect(result.unreadCount).toBe(0);
    expect(result.conversationCount).toBe(0);

    // Cleanup
    getDb().prepare('DELETE FROM messages WHERE conversation_id >= 1000').run();
    getDb().prepare('DELETE FROM conversations WHERE id >= 1000').run();
    getDb().prepare('DELETE FROM projects WHERE slug = ?').run('test-notifications');
  });

  it('returns correct unread count for a conversation with unread messages', () => {
    const db = getDb();
    const project = db.prepare(
      "INSERT INTO projects (name, slug, description) VALUES (?, ?, ?) RETURNING id"
    ).get('test-notif-2', 'test-notif-2', 'Test') as { id: number };
    const roleId = 1;

    // Create a conversation
    const conv = db.prepare(
      'INSERT INTO conversations (project_id, from_role_id, to_role_id, last_read_message_id) VALUES (?, ?, ?, ?) RETURNING id'
    ).get(project.id, 1, 2, 0) as { id: number };

    // Send 5 messages
    for (let i = 1; i <= 5; i++) {
      db.prepare(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conv.id, 2, `Message ${i}`);
    }

    // Check notifications: all 5 messages are unread (last_read_message_id = 0)
    const result = NotificationService.checkForNotifications(roleId, project.id);
    expect(result.unreadCount).toBe(5);
    expect(result.conversationCount).toBe(1);

    // Mark as read
    ConversationService.markConversationAsRead(conv.id, project.id);

    // Now there should be 0 unread
    const result2 = NotificationService.checkForNotifications(roleId, project.id);
    expect(result2.unreadCount).toBe(0);
    expect(result2.conversationCount).toBe(0);

    // Cleanup
    db.prepare('DELETE FROM messages WHERE conversation_id >= 1000').run();
    db.prepare('DELETE FROM conversations WHERE id >= 1000').run();
    db.prepare('DELETE FROM projects WHERE slug = ?').run('test-notif-2');
  });

  it('returns partial unread count when some messages have been read', () => {
    const db = getDb();
    const project = db.prepare(
      "INSERT INTO projects (name, slug, description) VALUES (?, ?, ?) RETURNING id"
    ).get('test-notif-3', 'test-notif-3', 'Test') as { id: number };
    const roleId = 1;

    // Create a conversation with last_read_message_id = 3
    const conv = db.prepare(
      'INSERT INTO conversations (project_id, from_role_id, to_role_id, last_read_message_id) VALUES (?, ?, ?, ?) RETURNING id'
    ).get(project.id, 1, 2, 3) as { id: number };

    // Send 7 messages total
    for (let i = 1; i <= 7; i++) {
      db.prepare(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conv.id, 2, `Message ${i}`);
    }

    // Messages 4-7 are unread (id > 3)
    const result = NotificationService.checkForNotifications(roleId, project.id);
    expect(result.unreadCount).toBe(4);
    expect(result.conversationCount).toBe(1);

    // Cleanup
    db.prepare('DELETE FROM messages WHERE conversation_id >= 1000').run();
    db.prepare('DELETE FROM conversations WHERE id >= 1000').run();
    db.prepare('DELETE FROM projects WHERE slug = ?').run('test-notif-3');
  });

  it('returns 0 unread when all messages have been read', () => {
    const db = getDb();
    const project = db.prepare(
      "INSERT INTO projects (name, slug, description) VALUES (?, ?, ?) RETURNING id"
    ).get('test-notif-4', 'test-notif-4', 'Test') as { id: number };
    const roleId = 1;

    const conv = db.prepare(
      'INSERT INTO conversations (project_id, from_role_id, to_role_id, last_read_message_id) VALUES (?, ?, ?, ?) RETURNING id'
    ).get(project.id, 1, 2, 0) as { id: number };

    // Send 3 messages and mark all as read
    for (let i = 1; i <= 3; i++) {
      db.prepare(
        'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
      ).run(conv.id, 2, `Message ${i}`);
    }

    // Mark as read (last_read_message_id should be updated to 3)
    ConversationService.markConversationAsRead(conv.id, project.id);

    const result = NotificationService.checkForNotifications(roleId, project.id);
    expect(result.unreadCount).toBe(0);
    expect(result.conversationCount).toBe(0);

    // Cleanup
    db.prepare('DELETE FROM messages WHERE conversation_id >= 1000').run();
    db.prepare('DELETE FROM conversations WHERE id >= 1000').run();
    db.prepare('DELETE FROM projects WHERE slug = ?').run('test-notif-4');
  });

  it('handles empty conversations (no messages)', () => {
    const db = getDb();
    const project = db.prepare(
      "INSERT INTO projects (name, slug, description) VALUES (?, ?, ?) RETURNING id"
    ).get('test-notif-5', 'test-notif-5', 'Test') as { id: number };
    const roleId = 1;

    // Create a conversation with no messages
    const conv = db.prepare(
      'INSERT INTO conversations (project_id, from_role_id, to_role_id, last_read_message_id) VALUES (?, ?, ?, ?) RETURNING id'
    ).get(project.id, 1, 2, 0) as { id: number };

    const result = NotificationService.checkForNotifications(roleId, project.id);
    expect(result.unreadCount).toBe(0);
    expect(result.conversationCount).toBe(0);

    // markConversationAsRead should not throw for empty conversations
    expect(() => {
      ConversationService.markConversationAsRead(conv.id, project.id);
    }).not.toThrow();

    // Cleanup
    db.prepare('DELETE FROM messages WHERE conversation_id >= 1000').run();
    db.prepare('DELETE FROM conversations WHERE id >= 1000').run();
    db.prepare('DELETE FROM projects WHERE slug = ?').run('test-notif-5');
  });
});
