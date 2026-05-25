import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTicketStore } from '@/stores/tickets';
import { useSSE, type SseEventHandlers } from '@/composables/useSSE';

// Mock EventSource globally before any test imports
const eventSourceInstances: MockEventSource[] = [];

interface MockEventSource {
  url: string;
  readyState: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _listeners: Record<string, Set<(event: MessageEvent) => void>>;
  _dispatchEvent: (type: string, data: string) => void;
  _dispatchConnected: () => void;
  _dispatchHeartbeat: () => void;
  _dispatchTicketCreated: (ticket: Record<string, unknown>) => void;
  _dispatchTicketUpdated: (ticket: Record<string, unknown>) => void;
  _dispatchTicketMoved: (ticketId: number, toColumn: string) => void;
  _dispatchTicketDeleted: (ticketId: number) => void;
  _dispatchCommentAdded: (ticketId: number, comment: Record<string, unknown>) => void;
  _dispatchDepAdded: (ticketId: number, dependsOnId: number, relationType: string) => void;
  _dispatchDepRemoved: (ticketId: number, dependsOnId: number, relationType: string) => void;
}

function createMockEventSource(url: string): MockEventSource {
  const listeners: Record<string, Set<(event: MessageEvent) => void>> = {};

  const mock: MockEventSource = {
    url,
    readyState: 0, // CONNECTING
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (!listeners[type]) {
        listeners[type] = new Set();
      }
      listeners[type].add(listener);
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(() => {
      mock.readyState = 2; // CLOSED
    }),
    _listeners: listeners,
    _dispatchEvent: (type: string, data: string) => {
      const typedEvent = { data, type } as MessageEvent;
      const handler = listeners[type];
      if (handler) {
        for (const listener of handler) {
          listener(typedEvent);
        }
      }
    },
    _dispatchConnected: () => {
      mock._dispatchEvent('connected', JSON.stringify({ client_id: 'test-client-1' }));
    },
    _dispatchHeartbeat: () => {
      mock._dispatchEvent('heartbeat', JSON.stringify({ timestamp: new Date().toISOString() }));
    },
    _dispatchTicketCreated: (ticket: Record<string, unknown>) => {
      mock._dispatchEvent('ticket.created', JSON.stringify({ ticket }));
    },
    _dispatchTicketUpdated: (ticket: Record<string, unknown>) => {
      mock._dispatchEvent('ticket.updated', JSON.stringify({ ticket }));
    },
    _dispatchTicketMoved: (ticketId: number, toColumn: string) => {
      mock._dispatchEvent('ticket.moved', JSON.stringify({ ticket_id: ticketId, to_column: toColumn }));
    },
    _dispatchTicketDeleted: (ticketId: number) => {
      mock._dispatchEvent('ticket.deleted', JSON.stringify({ ticket_id: ticketId }));
    },
    _dispatchCommentAdded: (ticketId: number, comment: Record<string, unknown>) => {
      mock._dispatchEvent('ticket.comment_added', JSON.stringify({ ticket_id: ticketId, comment }));
    },
    _dispatchDepAdded: (ticketId: number, dependsOnId: number, relationType: string) => {
      mock._dispatchEvent('ticket.dep_added', JSON.stringify({ ticket_id: ticketId, depends_on_id: dependsOnId, relation_type: relationType, project_slug: 'test-project' }));
    },
    _dispatchDepRemoved: (ticketId: number, dependsOnId: number, relationType: string) => {
      mock._dispatchEvent('ticket.dep_removed', JSON.stringify({ ticket_id: ticketId, depends_on_id: dependsOnId, relation_type: relationType, project_slug: 'test-project' }));
    },
  };

  eventSourceInstances.push(mock);
  return mock;
}

// Replace EventSource before each test
beforeEach(() => {
  vi.resetModules();
  eventSourceInstances.length = 0;
  global.EventSource = vi.fn((url: string) => createMockEventSource(url)) as unknown as EventSourceConstructor;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSSE', () => {
  let handlers: SseEventHandlers;
  let store: ReturnType<typeof useTicketStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTicketStore();

    handlers = {
      handleTicketCreated: vi.fn(),
      handleTicketUpdated: vi.fn(),
      handleTicketMoved: vi.fn(),
      handleTicketDeleted: vi.fn(),
      handleCommentAdded: vi.fn(),
      handleDepAdded: vi.fn(),
      handleDepRemoved: vi.fn(),
    };
  });

  it('creates EventSource with correct URL on connect', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    expect(global.EventSource).toHaveBeenCalledWith('/api/v1/projects/test-project/sse');
    disconnect();
  });

  it('returns connected ref that starts as false', () => {
    const { connected, connect, disconnect } = useSSE('test-project', handlers);
    expect(connected.value).toBe(false);
    connect();
    disconnect();
  });

  it('dispatches ticket.created event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;
    const testTicket = { id: 10, project_id: 1, column_id: 1, title: 'New Ticket', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };

    mockSource._dispatchTicketCreated(testTicket);

    expect(handlers.handleTicketCreated).toHaveBeenCalledWith(testTicket);
    disconnect();
  });

  it('dispatches ticket.updated event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;
    const updatedTicket = { id: 5, project_id: 1, column_id: 1, title: 'Updated Title', description: 'New desc', labels: '[]', priority: 1, estimate: 2, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [] };

    mockSource._dispatchTicketUpdated(updatedTicket);

    expect(handlers.handleTicketUpdated).toHaveBeenCalledWith(updatedTicket);
    disconnect();
  });

  it('dispatches ticket.moved event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;

    mockSource._dispatchTicketMoved(7, 'in_review');

    expect(handlers.handleTicketMoved).toHaveBeenCalledWith(7, 'in_review');
    disconnect();
  });

  it('dispatches ticket.deleted event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;

    mockSource._dispatchTicketDeleted(42);

    expect(handlers.handleTicketDeleted).toHaveBeenCalledWith(42);
    disconnect();
  });

  it('dispatches ticket.comment_added event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;
    const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Nice work!', created_at: '2024-01-02' };

    mockSource._dispatchCommentAdded(1, comment);

    expect(handlers.handleCommentAdded).toHaveBeenCalledWith(1, comment);
    disconnect();
  });

  it('dispatches ticket.dep_added event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;

    mockSource._dispatchDepAdded(1, 2, 'blocked_by');

    expect(handlers.handleDepAdded).toHaveBeenCalledWith(1, 2, 'blocked_by', 'test-project');
    disconnect();
  });

  it('dispatches ticket.dep_removed event to store handler', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;

    mockSource._dispatchDepRemoved(1, 2, 'blocked_by');

    expect(handlers.handleDepRemoved).toHaveBeenCalledWith(1, 2, 'blocked_by', 'test-project');
    disconnect();
  });

  it('ignores heartbeat events (no handler call)', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;

    mockSource._dispatchHeartbeat();

    // Heartbeats should not trigger any handler
    expect(handlers.handleTicketCreated).not.toHaveBeenCalled();
    expect(handlers.handleTicketUpdated).not.toHaveBeenCalled();
    expect(handlers.handleTicketMoved).not.toHaveBeenCalled();
    expect(handlers.handleTicketDeleted).not.toHaveBeenCalled();
    expect(handlers.handleCommentAdded).not.toHaveBeenCalled();
    expect(handlers.handleDepAdded).not.toHaveBeenCalled();
    expect(handlers.handleDepRemoved).not.toHaveBeenCalled();
    disconnect();
  });

  it('calls disconnect to close EventSource', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();

    const mockSource = eventSourceInstances[eventSourceInstances.length - 1] as MockEventSource;
    disconnect();

    expect(mockSource.close).toHaveBeenCalled();
  });

  it('does not create a second EventSource when connect is called twice', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();
    connect(); // should not create a second instance

    expect(eventSourceInstances.length).toBe(1);
    disconnect();
  });

  it('creates a new EventSource after disconnect and reconnect', () => {
    const { connect, disconnect } = useSSE('test-project', handlers);
    connect();
    disconnect();
    connect();

    expect(eventSourceInstances.length).toBe(2);
    disconnect();
  });
});

describe('useSSE store integration', () => {
  it('insertTicket adds a new ticket to the list', () => {
    const store = useTicketStore();
    store.tickets = [];
    const newTicket = { id: 10, project_id: 1, column_id: 1, title: 'New Ticket', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.insertTicket(newTicket);

    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].title).toBe('New Ticket');
  });

  it('insertTicket avoids duplicate tickets with same ID', () => {
    const store = useTicketStore();
    const existingTicket = { id: 10, project_id: 1, column_id: 1, title: 'Original', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.tickets = [existingTicket];
    const updatedTicket = { id: 10, project_id: 1, column_id: 1, title: 'Updated via SSE', description: 'new', labels: '[]', priority: 1, estimate: 2, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.insertTicket(updatedTicket);

    // Should replace, not duplicate
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].title).toBe('Updated via SSE');
  });

  it('removeTicket removes ticket from the list', () => {
    const store = useTicketStore();
    const ticket1 = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    const ticket2 = { id: 2, project_id: 1, column_id: 1, title: 'T2', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket1, ticket2];

    store.removeTicket(1);

    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].id).toBe(2);
  });

  it('removeTicket clears selectedTicket if it was removed', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];
    store.selectedTicket = ticket;

    store.removeTicket(1);

    expect(store.selectedTicket).toBeNull();
  });

  it('updateTicketInline updates existing ticket and selectedTicket', () => {
    const store = useTicketStore();
    const original = { id: 1, project_id: 1, column_id: 1, title: 'Original', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.tickets = [original];
    store.selectedTicket = original;

    const updated = { id: 1, project_id: 1, column_id: 1, title: 'Updated via SSE', description: 'new', labels: '[]', priority: 1, estimate: 2, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.updateTicketInline(updated);

    expect(store.tickets[0].title).toBe('Updated via SSE');
    expect(store.selectedTicket?.title).toBe('Updated via SSE');
  });

  it('updateTicketInline only updates tickets list when ticket not in list', () => {
    const store = useTicketStore();
    const original = { id: 1, project_id: 1, column_id: 1, title: 'Original', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.tickets = [original];
    store.selectedTicket = { ...original, id: 5 }; // different ticket is selected

    const updated = { id: 99, project_id: 1, column_id: 1, title: 'Unknown', description: 'new', labels: '[]', priority: 1, estimate: 2, created_at: '2024-01-01', updated_at: '2024-01-02', created_by_role_id: 1, comments: [], column_slug: 'todo', column_name: 'ToDo' };
    store.updateTicketInline(updated);

    // Should not modify existing ticket
    expect(store.tickets[0].title).toBe('Original');
    expect(store.selectedTicket?.id).toBe(5);
  });

  it('addCommentInline appends comment to ticket', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];

    const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'Great work!', created_at: '2024-01-02' };
    store.addCommentInline(1, comment);

    expect(store.tickets[0].comments).toHaveLength(1);
    expect(store.tickets[0].comments[0].content).toBe('Great work!');
  });

  it('addCommentInline appends comment to selectedTicket if matching', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];
    store.selectedTicket = ticket;

    const comment = { id: 1, ticket_id: 1, author_role_id: 1, content: 'LGTM!', created_at: '2024-01-02' };
    store.addCommentInline(1, comment);

    expect(store.selectedTicket?.comments).toHaveLength(1);
    expect(store.selectedTicket?.comments[0].content).toBe('LGTM!');
  });

  it('repositionTicket emits ticket-moved event for component to refetch', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];

    // Should not throw
    expect(() => store.repositionTicket(1, 'in_review')).not.toThrow();
    // Column should remain unchanged (store does not modify column; component refetches)
    expect(store.tickets[0].column_id).toBe(1);

    // Verify event was dispatched
    const event = new CustomEvent('ticket-moved', { detail: { ticketId: 1, toColumn: 'in_review' } });
    const handler = vi.fn();
    window.addEventListener('ticket-moved', handler);
    store.repositionTicket(2, 'done');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ detail: { ticketId: 2, toColumn: 'done' } }));
    window.removeEventListener('ticket-moved', handler);
  });

  it('refreshDependencies is a no-op when called without projectSlug', async () => {
    const store = useTicketStore();
    // Without projectSlug, refreshDependencies is a no-op (doesn't throw)
    await expect(store.refreshDependencies(1)).resolves.not.toThrow();
  });

  it('addCommentInline avoids duplicate comments with same ID', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];

    const comment = { id: 100, ticket_id: 1, author_role_id: 1, content: 'First comment', created_at: '2024-01-02' };
    store.addCommentInline(1, comment);
    // Simulate SSE arriving with the same comment (e.g., SSE + local insert race)
    store.addCommentInline(1, comment);

    // Should still have only 1 comment, not duplicated
    expect(store.tickets[0].comments).toHaveLength(1);
    expect(store.tickets[0].comments[0].content).toBe('First comment');
  });

  it('addCommentInline avoids duplicate comments on selectedTicket', () => {
    const store = useTicketStore();
    const ticket = { id: 1, project_id: 1, column_id: 1, title: 'T1', description: '', labels: '[]', priority: 3, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', created_by_role_id: 1, comments: [] };
    store.tickets = [ticket];
    store.selectedTicket = ticket;

    const comment = { id: 200, ticket_id: 1, author_role_id: 1, content: 'Duplicate test', created_at: '2024-01-02' };
    store.addCommentInline(1, comment);
    store.addCommentInline(1, comment);

    expect(store.selectedTicket?.comments).toHaveLength(1);
    expect(store.selectedTicket?.comments[0].content).toBe('Duplicate test');
  });
});
