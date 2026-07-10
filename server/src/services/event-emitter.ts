import type { Response as ServerResponse } from 'express';

/**
 * Ticket event type constants for SSE broadcasting.
 */
export const TICKET_CREATED = 'ticket.created';
export const TICKET_UPDATED = 'ticket.updated';
export const TICKET_MOVED = 'ticket.moved';
export const TICKET_DELETED = 'ticket.deleted';
export const TICKET_COMMENT_ADDED = 'ticket.comment_added';
export const TICKET_DEPENDENCY_ADDED = 'ticket.dep_added';
export const TICKET_DEPENDENCY_REMOVED = 'ticket.dep_removed';

// Conversation event types
export const CONVERSATION_CREATED = 'conversation.created';
export const CONVERSATION_MESSAGE_SENT = 'conversation.message_sent';
export const CONVERSATION_READ_UPDATED = 'conversation.read_updated';
export const CONVERSATION_DELETED = 'conversation.deleted';

/**
 * Map of event names to their SSE-formatted string representation.
 */
export type TicketEventType =
  | typeof TICKET_CREATED
  | typeof TICKET_UPDATED
  | typeof TICKET_MOVED
  | typeof TICKET_DELETED
  | typeof TICKET_COMMENT_ADDED
  | typeof TICKET_DEPENDENCY_ADDED
  | typeof TICKET_DEPENDENCY_REMOVED
  | typeof CONVERSATION_CREATED
  | typeof CONVERSATION_MESSAGE_SENT
  | typeof CONVERSATION_READ_UPDATED
  | typeof CONVERSATION_DELETED;

/**
 * Metadata for a registered SSE client connection.
 */
interface SseClient {
  res: ServerResponse;
  heartbeatInterval: ReturnType<typeof setInterval>;
}

/**
 * Server-Sent Events (SSE) event emitter for broadcasting ticket change
 * events to connected WebUI clients in real time.
 *
 * Architecture:
 * - Uses a Map keyed by a unique string ID attached to the ServerResponse object.
 * - Thread-safe: Single-threaded Node.js, no locks needed.
 * - Heartbeat: 5-second interval on each connected client to keep the
 *   connection alive through proxies/load balancers.
 * - On emit: iterates active clients and writes SSE-formatted data to each.
 * - Silently ignores write errors (client may have disconnected).
 */
export class TicketEventEmitter {
  /**
   * Internal store of active SSE client connections.
   * Key: unique string ID attached to the ServerResponse object.
   */
  private clients = new Map<string, SseClient>();

  /**
   * Property name used to attach unique client IDs to ServerResponse objects.
   */
  private static readonly CLIENT_KEY_PROP = '__sse_client_id__';

  private nextClientId = 0;

  /**
   * SSE-formatted event string.
   * Format per SSE spec:
   *   event: <event-name>\n
   *   data: <json-payload>\n
   *   \n
   */
  private formatSseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /**
   * SSE heartbeat string.
   * A comment-only line (starts with `:`) keeps the connection alive.
   */
  private heartbeatString(): string {
    return ': heartbeat\n\n';
  }

  /**
   * Get or create a unique client ID for the response object.
   * Attaches the ID to the response as a property so the same response
   * always maps to the same key.
   */
  private getClientKey(res: ServerResponse): string {
    const props = res as unknown as Record<string, unknown>;
    const existingKey = props[TicketEventEmitter.CLIENT_KEY_PROP];
    if (existingKey && typeof existingKey === 'string') {
      return existingKey;
    }
    const key = `client-${++this.nextClientId}-${Date.now()}`;
    props[TicketEventEmitter.CLIENT_KEY_PROP] = key;
    return key;
  }

  /**
   * Register a new SSE client connection.
   *
   * Sets SSE-appropriate headers, attaches a 'close' listener for cleanup,
   * and starts the heartbeat interval.
   *
   * @param res - The Express ServerResponse object for the SSE connection
   * @returns A cleanup function that removes the client
   */
  onConnect(res: ServerResponse): () => void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const key = this.getClientKey(res);

    // Set up auto-cleanup on client disconnect
    res.on('close', () => {
      this.removeClient(res);
    });

    // Start heartbeat interval
    const heartbeatInterval = setInterval(() => {
      try {
        if (!res.writableEnded) {
          res.write(this.heartbeatString());
        }
      } catch {
        // Ignore write errors — client may have disconnected
      }
    }, 5000);

    // Register client
    this.clients.set(key, { res, heartbeatInterval });

    // Return cleanup function for explicit removal
    return () => {
      this.removeClient(res);
    };
  }

  /**
   * Remove a specific client connection and stop its heartbeat.
   *
   * @param res - The ServerResponse object to remove
   */
  removeClient(res: ServerResponse): void {
    const props = res as unknown as Record<string, unknown>;
    const key = props[TicketEventEmitter.CLIENT_KEY_PROP];
    if (!key || typeof key !== 'string') {
      return;
    }
    const client = this.clients.get(key);
    if (client) {
      clearInterval(client.heartbeatInterval);
      this.clients.delete(key);
    }
  }

  /**
   * Emit an event to all connected SSE clients.
   *
   * Iterates over active clients and writes the SSE-formatted event string.
   * Silently ignores clients that have disconnected.
   *
   * @param event - The event type string (e.g., TICKET_CREATED)
   * @param data - The event payload (serialized as JSON)
   */
  emit(event: string, data: unknown): void {
    const formatted = this.formatSseEvent(event, data);
    const keysToRemove: string[] = [];

    for (const [key, client] of this.clients) {
      try {
        if (!client.res.writableEnded) {
          client.res.write(formatted);
        }
      } catch {
        // Client may have disconnected — mark for cleanup
        keysToRemove.push(key);
      }
    }

    // Clean up dead clients after iteration
    for (const key of keysToRemove) {
      const client = this.clients.get(key);
      if (client) {
        clearInterval(client.heartbeatInterval);
      }
      this.clients.delete(key);
    }
  }

  /**
   * Get the current number of connected SSE clients.
   * Useful for testing and monitoring.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Remove all clients and stop all heartbeats.
   * Useful for graceful shutdown or testing.
   */
  clearAll(): void {
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeatInterval);
    }
    this.clients.clear();
  }
}

/**
 * Singleton instance of TicketEventEmitter.
 *
 * All parts of the application share the same emitter to ensure
 * consistent broadcasting to all connected SSE clients.
 */
export const ticketEvents = new TicketEventEmitter();
