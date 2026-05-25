import { getDb, getFallbackRoleId } from '../db/database.js';

/**
 * Shared conversation service that orchestrates message operations.
 * Used by both REST API and MCP tools.
 */
export class ConversationService {
  /**
   * List all conversations for a project with role names.
   */
  static list(projectId: number) {
    const db = getDb();
    const conversations = db.prepare(`
      SELECT c.*, r_from.name AS from_role_name, r_to.name AS to_role_name
      FROM conversations c
      JOIN roles r_from ON c.from_role_id = r_from.id
      JOIN roles r_to ON c.to_role_id = r_to.id
      WHERE c.project_id = ?
      ORDER BY c.id
    `).all(projectId) as {
      id: number;
      project_id: number;
      from_role_id: number;
      to_role_id: number;
      from_role_name: string;
      to_role_name: string;
    }[];

    return { conversations };
  }

  /**
   * Get a conversation with all messages.
   */
  static getById(projectId: number, conversationId: number) {
    const db = getDb();
    const conversation = db.prepare(`
      SELECT c.*, r_from.name AS from_role_name, r_to.name AS to_role_name
      FROM conversations c
      JOIN roles r_from ON c.from_role_id = r_from.id
      JOIN roles r_to ON c.to_role_id = r_to.id
      WHERE c.id = ? AND c.project_id = ?
    `).get(conversationId, projectId) as {
      id: number;
      project_id: number;
      from_role_id: number;
      to_role_id: number;
      from_role_name: string;
      to_role_name: string;
    } | undefined;

    if (!conversation) {
      return { conversation: undefined, error: `Conversation '${conversationId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const messages = db.prepare(`
      SELECT m.*, r.name AS sender_role_name
      FROM messages m
      JOIN roles r ON m.sender_role_id = r.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at
    `).all(conversationId) as {
      id: number;
      conversation_id: number;
      sender_role_id: number;
      content: string;
      created_at: string;
      fetched_until_id: number;
      sender_role_name: string;
    }[];

    return { conversation: { ...conversation, messages } };
  }

 /**
    * Find or create a conversation between the Human User (role_id 1) and the given target role.
    * Checks both directions to avoid duplicates.
    */
  static findOrCreateByRoleId(
    projectId: number,
    toRoleId: number
  ) {
    const db = getDb();

    // Human User is always role_id 1
    const humanRoleId = 1;

    // Check existing conversation (Human -> Target)
    let conversation = db.prepare<[number, number, number]>(
      'SELECT id FROM conversations WHERE project_id = ? AND from_role_id = ? AND to_role_id = ?'
    ).get(projectId, humanRoleId, toRoleId) as { id: number } | undefined;

    if (!conversation) {
      // Check reverse direction (Target -> Human)
      conversation = db.prepare<[number, number, number]>(
        'SELECT id FROM conversations WHERE project_id = ? AND from_role_id = ? AND to_role_id = ?'
      ).get(projectId, toRoleId, humanRoleId) as { id: number } | undefined;
    }

    if (!conversation) {
      // Create new conversation (Human -> Target)
      const result = db.prepare<[number, number, number]>(
        'INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, ?, ?) RETURNING id'
      ).get(projectId, humanRoleId, toRoleId) as { id: number } | undefined;

      if (!result) {
        return { conversation: undefined, error: 'Failed to create conversation', errorCode: 'INTERNAL_ERROR' };
      }

      conversation = result;
    }

    // Return full conversation record with role names
    const fullConversation = db.prepare(`
      SELECT c.*, r_from.name AS from_role_name, r_to.name AS to_role_name
      FROM conversations c
      JOIN roles r_from ON c.from_role_id = r_from.id
      JOIN roles r_to ON c.to_role_id = r_to.id
      WHERE c.id = ?
    `).get(conversation.id) as {
      id: number;
      project_id: number;
      from_role_id: number;
      to_role_id: number;
      from_role_name: string;
      to_role_name: string;
    } | undefined;

    if (!fullConversation) {
      return { conversation: undefined, error: 'Failed to retrieve created conversation', errorCode: 'INTERNAL_ERROR' };
    }

    return { conversation: fullConversation };
  }

  /**
    * Find or create a conversation between two roles by name.
    */
  static findOrCreateByRoleNames(
    projectId: number,
    fromRoleName: string,
    toRoleName: string
  ) {
    const db = getDb();

    const fromRole = db.prepare<[string]>(
      'SELECT id FROM roles WHERE name = ?'
    ).get(fromRoleName) as { id: number } | undefined;

    if (!fromRole) {
      return { conversation: undefined, error: `Role '${fromRoleName}' not found`, errorCode: 'NOT_FOUND' };
    }

    const toRole = db.prepare<[string]>(
      'SELECT id FROM roles WHERE name = ?'
    ).get(toRoleName) as { id: number } | undefined;

    if (!toRole) {
      return { conversation: undefined, error: `Role '${toRoleName}' not found`, errorCode: 'NOT_FOUND' };
    }

    // Check existing conversation (from -> to)
    let conversation = db.prepare<[number, number, number]>(
      'SELECT id FROM conversations WHERE project_id = ? AND from_role_id = ? AND to_role_id = ?'
    ).get(projectId, fromRole.id, toRole.id) as { id: number } | undefined;

    if (!conversation) {
      // Check reverse direction (to -> from)
      conversation = db.prepare<[number, number, number]>(
        'SELECT id FROM conversations WHERE project_id = ? AND from_role_id = ? AND to_role_id = ?'
      ).get(projectId, toRole.id, fromRole.id) as { id: number } | undefined;
    }

    if (!conversation) {
      // Create new conversation
      const result = db.prepare<[number, number, number]>(
        'INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, ?, ?) RETURNING id'
      ).get(projectId, fromRole.id, toRole.id) as { id: number } | undefined;

      if (!result) {
        return { conversation: undefined, error: 'Failed to create conversation', errorCode: 'INTERNAL_ERROR' };
      }

      conversation = result;
    }

    return { conversation: { id: conversation.id } };
  }

  /**
   * Send a message to a conversation.
   */
  static sendMessage(
    projectId: number,
    conversationId: number,
    content: string,
    params: { sender_role_id?: number }
  ) {
    if (!content || typeof content !== 'string') {
      return { message: undefined, error: 'Content is required and must be a string', errorCode: 'VALIDATION_ERROR', statusCode: 400 };
    }

    const db = getDb();

    // Verify conversation exists and belongs to project
    const conversation = db.prepare(
      'SELECT id FROM conversations WHERE id = ? AND project_id = ?'
    ).get(conversationId, projectId);

    if (!conversation) {
      return { message: undefined, error: `Conversation '${conversationId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    const senderRoleId = params.sender_role_id ?? getFallbackRoleId() ?? 0;

    db.prepare(
      'INSERT INTO messages (conversation_id, sender_role_id, content) VALUES (?, ?, ?)'
    ).run(conversationId, senderRoleId, content);

    const msgRow = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number } | undefined;
    const msgId = Number(msgRow?.id ?? 0);

    const message = db.prepare(`
      SELECT m.*, r.name AS sender_role_name
      FROM messages m
      JOIN roles r ON m.sender_role_id = r.id
      WHERE m.id = ?
    `).get(msgId) as {
      id: number;
      conversation_id: number;
      sender_role_id: number;
      content: string;
      created_at: string;
      fetched_until_id: number;
      sender_role_name: string;
    };

    return { message };
  }

  /**
   * Fetch unread messages and auto-update fetched_until_id.
   */
  static fetchUnread(
    projectId: number,
    params: {
      limit?: number;
      fetchedUntilId?: number;
    }
  ) {
    const limit = params.limit ?? 1;
    const fetchedUntilId = params.fetchedUntilId ?? 0;
    const db = getDb();

    // Get all conversations for this project
    const conversations = db.prepare(
      'SELECT id FROM conversations WHERE project_id = ?'
    ).all(projectId) as { id: number }[];

    if (conversations.length === 0) {
      return { messages: [] as any[], fetched_until_id: fetchedUntilId };
    }

    // Fetch unread messages (id > fetched_until_id)
    let query = `
      SELECT m.*, r.name AS sender_role_name, c.from_role_id, c.to_role_id
      FROM messages m
      JOIN roles r ON m.sender_role_id = r.id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_id = ? AND m.id > ?
      ORDER BY m.created_at
    `;

    const allParams: unknown[] = [projectId, fetchedUntilId];

    if (limit > 0) {
      query += ' LIMIT ?';
      allParams.push(limit);
    }

    const messages = db.prepare(query).all(...(allParams as any[])) as {
      id: number;
      conversation_id: number;
      sender_role_id: number;
      content: string;
      created_at: string;
      fetched_until_id: number;
      sender_role_name: string;
      from_role_id: number;
      to_role_id: number;
    }[];

    // Auto-update fetched_until_id to highest returned message ID
    if (messages.length > 0) {
      const highestId = Math.max(...messages.map((m) => m.id));
      // Update each conversation's fetched_until_id
      for (const conversation of conversations) {
        db.prepare(
          'UPDATE messages SET fetched_until_id = MAX(fetched_until_id, ?) WHERE conversation_id = ?'
        ).run(highestId, conversation.id);
      }
    }

    return {
      messages,
      fetched_until_id: messages.length > 0 ? Math.max(...messages.map((m) => m.id)) : fetchedUntilId,
    };
  }
}
