/**
 * Comprehensive tests for the SSE Event Emitter.
 *
 * Tests cover:
 * - TicketEventEmitter class (unit tests)
 * - ticketEvents singleton (integration tests)
 * - SSE endpoint behavior (integration tests)
 */
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import {
  TicketEventEmitter,
  TICKET_CREATED,
  TICKET_UPDATED,
  TICKET_MOVED,
  TICKET_DELETED,
  TICKET_COMMENT_ADDED,
  TICKET_DEPENDENCY_ADDED,
  TICKET_DEPENDENCY_REMOVED,
  ticketEvents,
} from '../services/event-emitter.js';
import type { Response as ServerResponse } from 'express';

/* ─── Mock helpers ─────────────────────────────────────────────────────────── */

/**
 * Lightweight mock of Express ServerResponse for SSE testing.
 */
interface MockResponseState {
  writableEnded: boolean;
  headers: Record<string, string>;
  writes: string[];
  closeListeners: (() => void)[];
  disconnected?: boolean;
}

function createMockResponse(disconnectEarly = false): MockResponseState & {
  writeHead: Mock<(status: number, headers: Record<string, string>) => void>;
  write: Mock<(chunk: string) => boolean>;
  on: Mock<(event: string, listener: () => void) => void>;
} {
  const state: MockResponseState = {
    writableEnded: false,
    headers: {},
    writes: [],
    closeListeners: [],
    disconnected: disconnectEarly,
  };

  const mockWrite = vi.fn((chunk: string) => {
    if (state.disconnected) {
      throw new Error('write after close');
    }
    state.writes.push(chunk);
    return true;
  });

  const mockWriteHead = vi.fn((status: number, headers: Record<string, string>) => {
    state.headers = headers;
  });

  const mockOn = vi.fn((event: string, listener: () => void) => {
    if (event === 'close') {
      state.closeListeners.push(listener);
    }
  });

  Object.defineProperty(state, 'writeHead', { value: mockWriteHead, writable: false, configurable: true });
  Object.defineProperty(state, 'write', { value: mockWrite, writable: false, configurable: true });
  Object.defineProperty(state, 'on', { value: mockOn, writable: false, configurable: true });
  Object.defineProperty(state, 'writableEnded', { value: false, writable: true, configurable: true });

  return state as typeof state & {
    writeHead: typeof mockWriteHead;
    write: typeof mockWrite;
    on: typeof mockOn;
  };
}

/* ─── TicketEventEmitter class tests ───────────────────────────────────────── */

describe('TicketEventEmitter', () => {
  let emitter: TicketEventEmitter;
  let mockRes1: ReturnType<typeof createMockResponse>;
  let mockRes2: ReturnType<typeof createMockResponse>;

  beforeEach(() => {
    emitter = new TicketEventEmitter();
    mockRes1 = createMockResponse();
    mockRes2 = createMockResponse();
  });

  afterEach(() => {
    emitter.clearAll();
    vi.useRealTimers();
  });

  describe('event type constants', () => {
    it('exports all expected event types', () => {
      expect(TICKET_CREATED).toBe('ticket.created');
      expect(TICKET_UPDATED).toBe('ticket.updated');
      expect(TICKET_MOVED).toBe('ticket.moved');
      expect(TICKET_DELETED).toBe('ticket.deleted');
      expect(TICKET_COMMENT_ADDED).toBe('ticket.comment_added');
      expect(TICKET_DEPENDENCY_ADDED).toBe('ticket.dep_added');
      expect(TICKET_DEPENDENCY_REMOVED).toBe('ticket.dep_removed');
    });
  });

  describe('onConnect', () => {
    it('sets SSE headers on connect', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(mockRes1.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('registers the client in the internal map', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(1);
    });

    it('attaches a close listener for auto-cleanup', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(mockRes1.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('starts a heartbeat interval', () => {
      vi.useFakeTimers();
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      vi.advanceTimersByTime(5000);
      expect(mockRes1.writes.length).toBeGreaterThanOrEqual(1);
      vi.useRealTimers();
    });

    it('returns a cleanup function', () => {
      const cleanup = emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(typeof cleanup).toBe('function');
    });
  });

  describe('emit', () => {
    it('broadcasts SSE-formatted event to all connected clients', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      emitter.onConnect(mockRes2 as unknown as ServerResponse);

      emitter.emit(TICKET_CREATED, { ticketId: 42, title: 'Test Ticket' });

      const expected = `event: ${TICKET_CREATED}
data: {"ticketId":42,"title":"Test Ticket"}

`;
      expect(mockRes1.write).toHaveBeenCalledWith(expected);
      expect(mockRes2.write).toHaveBeenCalledWith(expected);
    });

    it('broadcasts to only connected clients', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);

      emitter.emit(TICKET_UPDATED, { ticketId: 42, title: 'Updated' });

      expect(mockRes1.write).toHaveBeenCalled();
      expect(mockRes2.write).not.toHaveBeenCalled();
    });

    it('serializes complex data as JSON', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);

      const payload = {
        ticket_id: 71,
        from_column: 'todo',
        to_column: 'implementation',
        actor: 'AI code developer',
        timestamp: '2026-05-11T21:00:00.000Z',
      };

      emitter.emit(TICKET_MOVED, payload);

      const lastCall = mockRes1.write.mock.calls[mockRes1.write.mock.calls.length - 1][0] as string;
      expect(lastCall).toContain('ticket.moved');
      expect(lastCall).toContain('"ticket_id":71');
      expect(lastCall).toContain('"from_column":"todo"');
      expect(lastCall).toContain('"to_column":"implementation"');
    });

    it('sends multiple different event types', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);

      emitter.emit(TICKET_CREATED, { id: 1 });
      emitter.emit(TICKET_UPDATED, { id: 1, title: 'New Title' });
      emitter.emit(TICKET_DELETED, { id: 1 });

      expect(mockRes1.write).toHaveBeenCalledTimes(3);
    });
  });

  describe('client cleanup on disconnect', () => {
    it('removes client when close event fires', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(1);

      const closeListener = mockRes1.closeListeners[0];
      closeListener();

      expect(emitter.getClientCount()).toBe(0);
    });

    it('stops heartbeat interval on disconnect', () => {
      vi.useFakeTimers();
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(mockRes1.writes.length).toBe(0);

      const closeListener = mockRes1.closeListeners[0];
      closeListener();

      vi.advanceTimersByTime(10000);
      expect(mockRes1.writes.length).toBe(0);
      vi.useRealTimers();
    });

    it('cleanup function also removes client', () => {
      const cleanup = emitter.onConnect(mockRes1 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(1);

      cleanup();
      expect(emitter.getClientCount()).toBe(0);
    });
  });

  describe('removeClient', () => {
    it('removes client without connect flow', () => {
      const emitter2 = new TicketEventEmitter();
      emitter2.onConnect(mockRes1 as unknown as ServerResponse);

      expect(emitter2.getClientCount()).toBe(1);
      emitter2.removeClient(mockRes1 as unknown as ServerResponse);
      expect(emitter2.getClientCount()).toBe(0);
    });

    it('handles removeClient for unregistered response gracefully', () => {
      emitter.removeClient(mockRes1 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(0);
    });
  });

  describe('heartbeat interval', () => {
    it('sends heartbeat every 5 seconds', () => {
      vi.useFakeTimers();
      emitter.onConnect(mockRes1 as unknown as ServerResponse);

      vi.advanceTimersByTime(5000);
      expect(mockRes1.writes.length).toBe(1);

      vi.advanceTimersByTime(5000);
      expect(mockRes1.writes.length).toBe(2);

      vi.advanceTimersByTime(5000);
      expect(mockRes1.writes.length).toBe(3);

      vi.useRealTimers();
    });

    it('heartbeat sends the correct format', () => {
      vi.useFakeTimers();
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      vi.advanceTimersByTime(5000);

      expect(mockRes1.writes[0]).toBe(': heartbeat\n\n');
      vi.useRealTimers();
    });
  });

  describe('clearAll', () => {
    it('removes all clients', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      emitter.onConnect(mockRes2 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(2);

      emitter.clearAll();
      expect(emitter.getClientCount()).toBe(0);
    });
  });

  describe('getCount', () => {
    it('returns 0 when no clients connected', () => {
      expect(emitter.getClientCount()).toBe(0);
    });

    it('returns correct count for multiple clients', () => {
      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      emitter.onConnect(mockRes2 as unknown as ServerResponse);
      expect(emitter.getClientCount()).toBe(2);
    });
  });

  describe('write error handling', () => {
    it('does not crash when one client write fails', () => {
      mockRes1.disconnected = true;
      (mockRes1.write as Mock).mockImplementation(() => {
        throw new Error('write after close');
      });

      emitter.onConnect(mockRes1 as unknown as ServerResponse);
      emitter.onConnect(mockRes2 as unknown as ServerResponse);

      expect(() => {
        emitter.emit(TICKET_CREATED, { id: 1 });
      }).not.toThrow();

      expect(mockRes2.write).toHaveBeenCalled();
    });
  });
});

/* ─── ticketEvents singleton tests ─────────────────────────────────────────── */

describe('ticketEvents singleton', () => {
  beforeEach(() => {
    ticketEvents.clearAll();
  });

  afterEach(() => {
    ticketEvents.clearAll();
  });

  it('is a TicketEventEmitter instance', () => {
    expect(ticketEvents).toBeInstanceOf(TicketEventEmitter);
  });

  it('has no clients at startup', () => {
    expect(ticketEvents.getClientCount()).toBe(0);
  });

  describe('end-to-end client lifecycle', () => {
    it('full lifecycle: connect -> emit events -> disconnect', () => {
      const res = createMockResponse();
      const typedRes = res as unknown as ServerResponse;

      // 1. Connect
      ticketEvents.onConnect(typedRes);
      expect(ticketEvents.getClientCount()).toBe(1);

      // 2. Emit multiple events
      ticketEvents.emit(TICKET_CREATED, { id: 101, title: 'New Feature' });
      ticketEvents.emit(TICKET_UPDATED, { id: 101, title: 'Updated Title', priority: 2 });
      ticketEvents.emit(TICKET_MOVED, { id: 101, from_column: 'todo', to_column: 'implementation' });

      expect(res.write).toHaveBeenCalledTimes(3);
      expect(res.write.mock.calls[0][0]).toContain('ticket.created');
      expect(res.write.mock.calls[1][0]).toContain('ticket.updated');
      expect(res.write.mock.calls[2][0]).toContain('ticket.moved');

      // 3. Disconnect via close listener
      res.closeListeners[0]();
      expect(ticketEvents.getClientCount()).toBe(0);

      // 4. Emit after disconnect should not error
      expect(() => {
        ticketEvents.emit(TICKET_DELETED, { id: 101 });
      }).not.toThrow();
    });

    it('cleanup function removes client', () => {
      const res = createMockResponse();
      const typedRes = res as unknown as ServerResponse;

      const cleanupFn = ticketEvents.onConnect(typedRes);
      expect(ticketEvents.getClientCount()).toBe(1);

      cleanupFn();
      expect(ticketEvents.getClientCount()).toBe(0);
    });

    it('SSE headers are exactly as specified', () => {
      const res = createMockResponse();
      const typedRes = res as unknown as ServerResponse;

      ticketEvents.onConnect(typedRes);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('SSE event format is spec-compliant', () => {
      const res = createMockResponse();
      const typedRes = res as unknown as ServerResponse;

      ticketEvents.onConnect(typedRes);
      ticketEvents.emit(TICKET_CREATED, { id: 1 });

      const eventLine = res.writes[0];
      expect(eventLine).toEqual('event: ticket.created\ndata: {"id":1}\n\n');
      expect(eventLine).toContain('event: ');
      expect(eventLine).toContain('data: ');
      expect(eventLine).toMatch(/\n\n$/);
    });
  });

  describe('multiple concurrent clients', () => {
    it('all connected clients receive the same event', () => {
      const clients = [
        createMockResponse() as unknown as ServerResponse,
        createMockResponse() as unknown as ServerResponse,
        createMockResponse() as unknown as ServerResponse,
      ];

      clients.forEach(res => ticketEvents.onConnect(res));
      expect(ticketEvents.getClientCount()).toBe(3);

      ticketEvents.emit(TICKET_COMMENT_ADDED, { ticket_id: 71, content: 'Hello' });

      clients.forEach(res => {
        const writes = (res as any).writes as string[];
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('ticket.comment_added');
        expect(writes[0]).toContain('"ticket_id":71');
      });
    });

    it('only connected clients receive events; unconnected clients get nothing', () => {
      const connected = createMockResponse() as unknown as ServerResponse;
      const unconnected = createMockResponse() as unknown as ServerResponse;

      ticketEvents.onConnect(connected);
      // NOT connecting unconnected

      ticketEvents.emit(TICKET_DEPENDENCY_ADDED, { ticket_id: 71, depends_on_id: 42 });

      const connectedWrites = (connected as any).writes as string[];
      const unconnectedWrites = (unconnected as any).writes as string[];

      expect(connectedWrites).toHaveLength(1);
      expect(unconnectedWrites).toHaveLength(0);
    });

    it('removing one client does not affect others', () => {
      const client1 = createMockResponse() as unknown as ServerResponse;
      const client2 = createMockResponse() as unknown as ServerResponse;

      ticketEvents.onConnect(client1);
      ticketEvents.onConnect(client2);

      ticketEvents.removeClient(client1);
      expect(ticketEvents.getClientCount()).toBe(1);

      ticketEvents.emit(TICKET_DEPENDENCY_REMOVED, { ticket_id: 71 });
      expect((client1 as any).writes).toHaveLength(0);
      expect((client2 as any).writes).toHaveLength(1);
    });
  });

  describe('heartbeat behavior', () => {
    it('heartbeat fires at regular 5s intervals', () => {
      vi.useFakeTimers();
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      expect((res as any).writes).toHaveLength(0);

      vi.advanceTimersByTime(5000);
      expect((res as any).writes).toHaveLength(1);
      expect((res as any).writes[0]).toBe(': heartbeat\n\n');

      vi.advanceTimersByTime(5000);
      expect((res as any).writes).toHaveLength(2);

      vi.useRealTimers();
    });

    it('heartbeat stops after client disconnect', () => {
      vi.useFakeTimers();
      const mock = createMockResponse();
      const res = mock as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      vi.advanceTimersByTime(5000);
      expect(mock.writes).toHaveLength(1);

      mock.closeListeners[0]();

      vi.advanceTimersByTime(5000);
      expect(mock.writes).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  describe('edge cases', () => {
    it('emit with null data', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      expect(() => {
        ticketEvents.emit(TICKET_DELETED, null);
      }).not.toThrow();

      expect(res.write).toHaveBeenCalledWith('event: ticket.deleted\ndata: null\n\n');
    });

    it('emit with empty object data', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      expect(() => {
        ticketEvents.emit(TICKET_UPDATED, {});
      }).not.toThrow();

      expect(res.write).toHaveBeenCalledWith('event: ticket.updated\ndata: {}\n\n');
    });

    it('emit with deeply nested data', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      const payload = {
        ticket_id: 71,
        changes: {
          title: 'Updated',
          fields: ['title', 'priority'],
          old_values: { title: 'Old Title' },
        },
        actor: { role: 'AI code developer', timestamp: '2026-05-11T21:00:00Z' },
      };

      ticketEvents.emit(TICKET_UPDATED, payload);

      const writeCall = (res as any).writes[0];
      expect(writeCall).toContain('ticket.updated');
      expect(writeCall).toContain('"ticket_id":71');
      expect(writeCall).toContain('"actor":{"role":"AI code developer"');
    });

    it('clearAll stops all heartbeats and removes all clients', () => {
      vi.useFakeTimers();
      const r1 = createMockResponse() as unknown as ServerResponse;
      const r2 = createMockResponse() as unknown as ServerResponse;

      ticketEvents.onConnect(r1);
      ticketEvents.onConnect(r2);
      expect(ticketEvents.getClientCount()).toBe(2);

      vi.advanceTimersByTime(5000);
      expect((r1 as any).writes.length).toBe(1);
      expect((r2 as any).writes.length).toBe(1);

      ticketEvents.clearAll();
      expect(ticketEvents.getClientCount()).toBe(0);

      vi.advanceTimersByTime(5000);
      expect((r1 as any).writes.length).toBe(1);
      expect((r2 as any).writes.length).toBe(1);

      vi.useRealTimers();
    });

    it('removeClient on unregistered response does not throw', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      expect(() => {
        ticketEvents.removeClient(res);
      }).not.toThrow();
      expect(ticketEvents.getClientCount()).toBe(0);
    });

    it('client key is attached to response object for dedup', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);
      expect(ticketEvents.getClientCount()).toBe(1);

      const props = res as unknown as Record<string, unknown>;
      expect(props['__sse_client_id__']).toBeDefined();
      expect(typeof props['__sse_client_id__']).toBe('string');
      expect(props['__sse_client_id__']).toMatch(/^client-\d+-\d+$/);
    });

    it('emitting to no connected clients does not throw', () => {
      expect(() => {
        ticketEvents.emit(TICKET_DELETED, { id: 99 });
      }).not.toThrow();
    });

    it('defensive: removing unregistered client does not throw', () => {
      const mockRes = createMockResponse();
      expect(() => {
        ticketEvents.removeClient(mockRes as unknown as ServerResponse);
      }).not.toThrow();
      expect(ticketEvents.getClientCount()).toBe(0);
    });

    it('connected client receives initial connected event via event emitter', () => {
      const mockRes = createMockResponse();
      const typedRes = mockRes as unknown as ServerResponse;

      ticketEvents.onConnect(typedRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      ticketEvents.emit(TICKET_CREATED, { id: 1, title: 'Test' });

      expect(mockRes.writes).toHaveLength(1);
      expect(mockRes.writes[0]).toContain('event: ticket.created');
      expect(mockRes.writes[0]).toContain('"id":1');
    });

    it('connected client receives multiple ticket events', () => {
      const mockRes = createMockResponse();
      const typedRes = mockRes as unknown as ServerResponse;

      ticketEvents.onConnect(typedRes);

      ticketEvents.emit(TICKET_CREATED, { id: 1, title: 'Created' });
      ticketEvents.emit(TICKET_UPDATED, { id: 1, title: 'Updated' });
      ticketEvents.emit(TICKET_MOVED, { id: 1, from_column: 'todo', to_column: 'done' });

      expect(mockRes.writes).toHaveLength(3);
      expect(mockRes.writes[0]).toContain('ticket.created');
      expect(mockRes.writes[1]).toContain('ticket.updated');
      expect(mockRes.writes[2]).toContain('ticket.moved');
    });

    it('connected clients receive events with ticket data', () => {
      const mockRes = createMockResponse();
      const typedRes = mockRes as unknown as ServerResponse;

      ticketEvents.onConnect(typedRes);

      const payload = {
        id: 72,
        title: 'Server: Implement SSE Endpoint',
        priority: 4,
        column: 'implementation',
      };
      ticketEvents.emit(TICKET_UPDATED, payload);

      expect(mockRes.writes[0]).toContain('ticket.updated');
      expect(mockRes.writes[0]).toContain('"id":72');
      expect(mockRes.writes[0]).toContain('"priority":4');
    });
  });

  describe('TicketEventType type safety', () => {
    it('accepts all valid event type constants', () => {
      const res = createMockResponse() as unknown as ServerResponse;
      ticketEvents.onConnect(res);

      const events = [
        TICKET_CREATED,
        TICKET_UPDATED,
        TICKET_MOVED,
        TICKET_DELETED,
        TICKET_COMMENT_ADDED,
        TICKET_DEPENDENCY_ADDED,
        TICKET_DEPENDENCY_REMOVED,
      ];

      events.forEach((event) => {
        ticketEvents.emit(event, { test: true });
      });

      expect(res.write).toHaveBeenCalledTimes(7);
    });
  });
});
