import { ref, onUnmounted, getCurrentInstance } from 'vue';
import type { Ref } from 'vue';
import type { Comment as ApiComment, Conversation, Message } from '../api';

/**
 * Event data shapes for SSE ticket events from the server.
 */
export interface SseConnectedEvent {
  type: 'connected';
  data: { client_id: string };
}

export interface SseHeartbeatEvent {
  type: 'heartbeat';
  data: { timestamp: string };
}

export interface SseTicketCreatedEvent {
  type: 'ticket.created';
  data: { ticket: Record<string, unknown> };
}

export interface SseTicketUpdatedEvent {
  type: 'ticket.updated';
  data: { ticket: Record<string, unknown> };
}

export interface SseTicketMovedEvent {
  type: 'ticket.moved';
  data: { ticket_id: number; to_column: string };
}

export interface SseTicketDeletedEvent {
  type: 'ticket.deleted';
  data: { ticket_id: number };
}

export interface SseCommentAddedEvent {
  type: 'ticket.comment_added';
  data: { ticket_id: number; comment: ApiComment };
}

export interface SseDepAddedEvent {
  type: 'ticket.dep_added';
  data: { ticket_id: number; depends_on_id: number; relation_type: string; project_slug: string };
}

export interface SseDepRemovedEvent {
  type: 'ticket.dep_removed';
  data: { ticket_id: number; depends_on_id: number; relation_type: string; project_slug: string };
}

export interface SseConversationCreatedEvent {
  type: 'conversation.created';
  data: { conversation: Conversation };
}

export interface SseConversationMessageSentEvent {
  type: 'conversation.message_sent';
  data: { conversation_id: number; message: Message };
}

export interface SseConversationReadUpdatedEvent {
  type: 'conversation.read_updated';
  data: { conversation_id: number; last_read_message_id: number };
}

export interface SseConversationDeletedEvent {
  type: 'conversation.deleted';
  data: { conversation_id: number };
}

export type SseEvent =
  | SseConnectedEvent
  | SseHeartbeatEvent
  | SseTicketCreatedEvent
  | SseTicketUpdatedEvent
  | SseTicketMovedEvent
  | SseTicketDeletedEvent
  | SseCommentAddedEvent
  | SseDepAddedEvent
  | SseDepRemovedEvent
  | SseConversationCreatedEvent
  | SseConversationMessageSentEvent
  | SseConversationReadUpdatedEvent
  | SseConversationDeletedEvent;

/**
 * Event handler types for the ticket store integration.
 */
export interface SseEventHandlers {
  handleTicketCreated: (ticket: Record<string, unknown>) => void;
  handleTicketUpdated: (ticket: Record<string, unknown>) => void;
  handleTicketMoved: (ticketId: number, toColumn: string) => void;
  handleTicketDeleted: (ticketId: number) => void;
  handleCommentAdded: (ticketId: number, comment: ApiComment) => void;
  handleDepAdded: (ticketId: number, dependsOnId: number, relationType: string, projectSlug: string) => void;
  handleDepRemoved: (ticketId: number, dependsOnId: number, relationType: string, projectSlug: string) => void;
  handleConversationCreated: (conversation: Conversation) => void;
  handleConversationMessageSent: (conversationId: number, message: Message) => void;
  handleConversationReadUpdated: (conversationId: number, lastReadMessageId: number) => void;
  handleConversationDeleted: (conversationId: number) => void;
}

/**
 * SSE connection composable that manages the EventSource lifecycle
 * and dispatches events to the ticket store.
 *
 * @param slug - The project slug for the SSE endpoint
 * @param handlers - Event handlers for processing SSE events
 */
export function useSSE(
  slug: string,
  handlers: SseEventHandlers
): {
  connected: Ref<boolean>;
  connect: (newSlug?: string) => void;
  disconnect: () => void;
} {
  const connected = ref(false);
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  /**
   * Calculate the backoff delay for reconnection:
   * min(2000 * 2^attempts, 30000)
   */
  function calculateBackoff(): number {
    const delay = Math.min(2000 * 2 ** reconnectAttempts, 30000);
    return delay;
  }

  /**
   * Parse an SSE event data string into the appropriate typed event.
   */
  function parseSseData(rawData: string): Record<string, unknown> {
    try {
      return JSON.parse(rawData);
    } catch {
      return { raw: rawData };
    }
  }

  /**
   * Process a single SSE event and dispatch to the appropriate handler.
   */
  function processEvent(type: string, rawData: string): void {
    const data = parseSseData(rawData);

    switch (type) {
      case 'ticket.created':
        handlers.handleTicketCreated(data.ticket as Record<string, unknown>);
        break;
      case 'ticket.updated':
        handlers.handleTicketUpdated(data.ticket as Record<string, unknown>);
        break;
      case 'ticket.moved':
        handlers.handleTicketMoved(data.ticket_id as number, data.to_column as string);
        break;
      case 'ticket.deleted':
        handlers.handleTicketDeleted(data.ticket_id as number);
        break;
      case 'ticket.comment_added':
        handlers.handleCommentAdded(data.ticket_id as number, data.comment as ApiComment);
        break;
      case 'ticket.dep_added':
        handlers.handleDepAdded(
          data.ticket_id as number,
          data.depends_on_id as number,
          data.relation_type as string,
          data.project_slug as string
        );
        break;
      case 'ticket.dep_removed':
        handlers.handleDepRemoved(
          data.ticket_id as number,
          data.depends_on_id as number,
          data.relation_type as string,
          data.project_slug as string
        );
        break;
      case 'conversation.created':
        handlers.handleConversationCreated(data.conversation as Conversation);
        break;
      case 'conversation.message_sent':
        handlers.handleConversationMessageSent(
          data.conversation_id as number,
          data.message as Message
        );
        break;
      case 'conversation.read_updated':
        handlers.handleConversationReadUpdated(
          data.conversation_id as number,
          data.last_read_message_id as number
        );
        break;
      case 'conversation.deleted':
        handlers.handleConversationDeleted(data.conversation_id as number);
        break;
      case 'heartbeat':
        // Heartbeats are informational — no store action needed
        break;
      case 'connected':
        // Connected event is informational
        break;
      default:
        console.warn(`[SSE] Unknown event type: ${type}`);
    }
  }

  /**
   * Set up event listeners on the EventSource.
   */
  function attachListeners(source: EventSource): void {
    source.addEventListener('ticket.created', (e: MessageEvent) => {
      processEvent('ticket.created', e.data);
    });

    source.addEventListener('ticket.updated', (e: MessageEvent) => {
      processEvent('ticket.updated', e.data);
    });

    source.addEventListener('ticket.moved', (e: MessageEvent) => {
      processEvent('ticket.moved', e.data);
    });

    source.addEventListener('ticket.deleted', (e: MessageEvent) => {
      processEvent('ticket.deleted', e.data);
    });

    source.addEventListener('ticket.comment_added', (e: MessageEvent) => {
      processEvent('ticket.comment_added', e.data);
    });

    source.addEventListener('ticket.dep_added', (e: MessageEvent) => {
      processEvent('ticket.dep_added', e.data);
    });

    source.addEventListener('ticket.dep_removed', (e: MessageEvent) => {
      processEvent('ticket.dep_removed', e.data);
    });

    source.addEventListener('conversation.created', (e: MessageEvent) => {
      processEvent('conversation.created', e.data);
    });

    source.addEventListener('conversation.message_sent', (e: MessageEvent) => {
      processEvent('conversation.message_sent', e.data);
    });

    source.addEventListener('conversation.read_updated', (e: MessageEvent) => {
      processEvent('conversation.read_updated', e.data);
    });

    source.addEventListener('conversation.deleted', (e: MessageEvent) => {
      processEvent('conversation.deleted', e.data);
    });

    // Generic catch-all for events not registered above
    source.addEventListener('message', (e: MessageEvent) => {
      // SSE server sends events with event: type format.
      // If we get a generic message, try to parse it as a structured event.
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type) {
          processEvent(parsed.type, JSON.stringify(parsed.data ?? parsed));
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    source.addEventListener('connected', (e: MessageEvent) => {
      connected.value = true;
      reconnectAttempts = 0;
      console.log('[SSE] Connected to event stream');
    });

    source.addEventListener('heartbeat', () => {
      // Heartbeat received — connection is alive
    });
  }

  /**
   * Connect to the SSE endpoint.
   * @param newSlug - Optional new project slug to connect to (overrides the slug passed to useSSE).
   */
  function connect(newSlug?: string): void {
    if (eventSource) {
      return; // Already connected
    }

    const activeSlug = newSlug ?? slug;
    const url = `/api/v1/projects/${activeSlug}/sse`;
    eventSource = new EventSource(url);

    attachListeners(eventSource);

    eventSource.onerror = () => {
      // Don't set connected to false immediately — it may reconnect
      console.warn('[SSE] Connection error, attempting to reconnect...');
    };

    eventSource.onopen = () => {
      connected.value = true;
      reconnectAttempts = 0;
      console.log('[SSE] SSE connection opened');
    };
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  function scheduleReconnect(): void {
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
      return;
    }

    // Close the current connection to force a reconnection
    eventSource.close();
    eventSource = null;

    const delay = calculateBackoff();
    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);

    reconnectTimer = setTimeout(() => {
      reconnectAttempts += 1;
      connect();
    }, delay);
  }

  /**
   * Disconnect from the SSE stream and clean up.
   */
  function disconnect(): void {
    // Clear any pending reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Close the EventSource
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    connected.value = false;
    reconnectAttempts = 0;
  }

  // Auto-cleanup on component unmount (guarded for test contexts)
  const instance = getCurrentInstance();
  if (instance) {
    onUnmounted(() => {
      disconnect();
    });
  }

  return { connected, connect, disconnect };
}

export default useSSE;
