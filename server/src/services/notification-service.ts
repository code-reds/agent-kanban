import { getDb } from '../db/database.js';

/**
 * Notification service: checks for unread messages across all conversations
 * involving a role, and marks conversations as read.
 */
export class NotificationService {
  /**
   * Check for unread messages across all conversations involving the role.
   * Returns total unread count and number of conversations with unread messages.
   */
  static checkForNotifications(roleId: number, projectId: number): {
    unreadCount: number;
    conversationCount: number;
  } {
    const db = getDb();

    // Get all conversations where this role is either sender or receiver
    const conversations = db.prepare(
      'SELECT id, last_read_message_id FROM conversations WHERE project_id = ? AND (from_role_id = ? OR to_role_id = ?)'
    ).all(projectId, roleId, roleId) as {
      id: number;
      last_read_message_id: number;
    }[];

    let unreadCount = 0;
    let conversationCount = 0;

    for (const conversation of conversations) {
      const { id: conversationId, last_read_message_id } = conversation;
      const unread = db.prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND id > ?'
      ).get(conversationId, last_read_message_id) as { cnt: number };

      if (unread.cnt > 0) {
        unreadCount += unread.cnt;
        conversationCount++;
      }
    }

    return { unreadCount, conversationCount };
  }
}
