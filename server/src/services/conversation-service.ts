import { getDb, getFallbackRoleId } from '../db/database.js';
import { ticketEvents, CONVERSATION_CREATED, CONVERSATION_MESSAGE_SENT, CONVERSATION_READ_UPDATED, CONVERSATION_DELETED } from './event-emitter.js';

/**
 * Shared conversation service that orchestrates message operations.
 * Used by both REST API and MCP tools.
 */
export class ConversationService {
  /**
   * Get the project slug for a given project ID.
   */
  private static getProjectSlug(projectId: number): string | undefined {
    const db = getDb();
    const project = db.prepare<[number], { slug: string } | undefined>(
      'SELECT slug FROM projects WHERE id = ?'
    ).get(projectId);
    return project?.slug;
  }

  /**
   * Emit conversation.created event.
   */
  private static emitConversationCreated(conversation: {
    id: number;
    project_id: number;
    from_role_id: number;
    to_role_id: number;
    from_role_name: string;
    to_role_name: string;
  }, projectId: number): void {
    const slug = ConversationService.getProjectSlug(projectId);
    ticketEvents.emit(CONVERSATION_CREATED, {
      conversation_id: conversation.id,
      project_slug: slug ?? '',
      conversation,
    });
  }

  /**
   * Emit conversation.message_sent event.
   */
  private static emitMessageSent(conversationId: number, projectId: number, message: unknown): void {
    const slug = ConversationService.getProjectSlug(projectId);
    ticketEvents.emit(CONVERSATION_MESSAGE_SENT, {
      conversation_id: conversationId,
      project_slug: slug ?? '',
      message,
    });
  }

  /**
   * Emit conversation.read_updated event.
   */
  private static emitReadUpdated(conversationId: number, projectId: number, lastReadMessageId: number): void {
    const slug = ConversationService.getProjectSlug(projectId);
    ticketEvents.emit(CONVERSATION_READ_UPDATED, {
      conversation_id: conversationId,
      project_slug: slug ?? '',
      last_read_message_id: lastReadMessageId,
    });
  }

  /**
   * Emit conversation.deleted event.
   */
  private static emitConversationDeleted(conversationId: number, projectId: number): void {
    const slug = ConversationService.getProjectSlug(projectId);
    ticketEvents.emit(CONVERSATION_DELETED, {
      conversation_id: conversationId,
      project_slug: slug ?? '',
    });
  }

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

    let isNewConversation = false;
    if (!conversation) {
      // Create new conversation (Human -> Target)
      const result = db.prepare<[number, number, number]>(
        'INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, ?, ?) RETURNING id'
      ).get(projectId, humanRoleId, toRoleId) as { id: number } | undefined;

      if (!result) {
        return { conversation: undefined, error: 'Failed to create conversation', errorCode: 'INTERNAL_ERROR' };
      }

      conversation = result;
      isNewConversation = true;
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

    // Emit conversation.created event only for newly created conversations
    if (isNewConversation) {
      ConversationService.emitConversationCreated(fullConversation, projectId);
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

    let isNewConversation = false;
    if (!conversation) {
      // Create new conversation
      const result = db.prepare<[number, number, number]>(
        'INSERT INTO conversations (project_id, from_role_id, to_role_id) VALUES (?, ?, ?) RETURNING id'
      ).get(projectId, fromRole.id, toRole.id) as { id: number } | undefined;

      if (!result) {
        return { conversation: undefined, error: 'Failed to create conversation', errorCode: 'INTERNAL_ERROR' };
      }

      conversation = result;
      isNewConversation = true;
    }

    // Fetch full conversation record with role names for the event
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

    // Emit conversation.created event only for newly created conversations
    if (isNewConversation && fullConversation) {
      ConversationService.emitConversationCreated(fullConversation, projectId);
    }

    return { conversation: { id: conversation.id } };
  }

  /**
   * Mark all messages in a conversation as read by updating the conversation's
   * last_read_message_id cursor to the highest message ID.
   */
  static markConversationAsRead(conversationId: number, projectId: number): void {
    const db = getDb();

    // Get the highest message ID in this conversation
    const highestMsg = db.prepare(
      'SELECT MAX(id) as max_id FROM messages WHERE conversation_id = ?'
    ).get(conversationId) as { max_id: number | null } | undefined;

    if (highestMsg?.max_id !== null && highestMsg?.max_id !== undefined) {
      db.prepare(
        'UPDATE conversations SET last_read_message_id = ? WHERE id = ? AND project_id = ?'
      ).run(highestMsg.max_id, conversationId, projectId);
    }

    // Emit conversation.read_updated event
    const lastReadMessageId = highestMsg?.max_id ?? 0;
    ConversationService.emitReadUpdated(conversationId, projectId, lastReadMessageId);
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
      sender_role_name: string;
    };

    // Emit conversation.message_sent event
    ConversationService.emitMessageSent(conversationId, projectId, message);

    return { message };
  }

  /**
    * Fetch unread messages and auto-update last_read_message_id.
    */
   static fetchUnread(
    projectId: number,
    params: {
      limit?: number;
    }
  ) {
    const limit = params.limit ?? 1;
    const db = getDb();

    // Get all conversations for this project with their read cursors
    const conversations = db.prepare(
      'SELECT id, last_read_message_id FROM conversations WHERE project_id = ?'
    ).all(projectId) as { id: number; last_read_message_id: number }[];

    if (conversations.length === 0) {
      return { messages: [] as any[], last_read_message_id: 0 };
    }

    // Fetch unread messages (id > last_read_message_id for that conversation)
    let query = `
      SELECT m.*, r.name AS sender_role_name, c.from_role_id, c.to_role_id
      FROM messages m
      JOIN roles r ON m.sender_role_id = r.id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_id = ? AND m.id > c.last_read_message_id
      ORDER BY m.created_at
    `;

    const allParams: unknown[] = [projectId];

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
      sender_role_name: string;
      from_role_id: number;
      to_role_id: number;
    }[];

    // Track highest message ID per conversation to update cursors
    if (messages.length > 0) {
      const highestPerConversation = new Map<number, number>();
      for (const msg of messages) {
        const current = highestPerConversation.get(msg.conversation_id) ?? 0;
        if (msg.id > current) {
          highestPerConversation.set(msg.conversation_id, msg.id);
        }
      }

      // Update last_read_message_id for each affected conversation
      for (const [convId, highestId] of highestPerConversation) {
        db.prepare(
          'UPDATE conversations SET last_read_message_id = ? WHERE id = ?'
        ).run(highestId, convId);
      }
    }

    // Return the highest message ID across all returned messages as a global cursor.
    // Since last_read_message_id is a per-conversation cursor and we're marking all
    // conversations as read in this call, using the global maximum ensures every
    // conversation's cursor is >= all message IDs it contains. This is a safe
    // over-mark (no messages will be missed) and avoids the need for per-conversation
    // cursor tracking.
    const lastReadMessageId = messages.length > 0
      ? Math.max(...messages.map((m) => m.id))
      : 0;

    return {
      messages,
      last_read_message_id: lastReadMessageId,
    };
  }

  /**
   * Delete a conversation and all its messages.
   * Emits a conversation.deleted event after successful deletion.
   */
  static delete(projectId: number, conversationId: number): { success: boolean; error?: string; errorCode?: string; statusCode?: number } {
    const db = getDb();

    // Verify conversation exists and belongs to project
    const conversation = db.prepare(
      'SELECT id FROM conversations WHERE id = ? AND project_id = ?'
    ).get(conversationId, projectId);

    if (!conversation) {
      return { success: false, error: `Conversation '${conversationId}' not found`, errorCode: 'NOT_FOUND', statusCode: 404 };
    }

    // Delete all messages in the conversation first
    db.prepare(
      'DELETE FROM messages WHERE conversation_id = ?'
    ).run(conversationId);

    // Delete the conversation
    db.prepare(
      'DELETE FROM conversations WHERE id = ? AND project_id = ?'
    ).run(conversationId, projectId);

    // Emit conversation.deleted event
    ConversationService.emitConversationDeleted(conversationId, projectId);

    return { success: true };
  }
}
