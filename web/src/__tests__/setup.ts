// Global test setup — provides browser API mocks for jsdom environment

// Mock EventSource for SSE testing
class MockEventSource {
  url: string;
  readyState: number;
  private _listeners: Map<string, Set<EventListener>>;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
    this._listeners = new Map();

    // Simulate connection open
    setImmediate(() => {
      if (this.readyState !== MockEventSource.CLOSED) {
        this.readyState = MockEventSource.OPEN;
        this.onopen?.(new Event('open'));
      }
    });
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this._listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  dispatchEvent(type: string, data: string): void {
    const event = new MessageEvent(type, { data });
    this._listeners.get(type)?.forEach((listener) => {
      if (typeof listener === 'function') {
        listener(event);
      }
    });
  }
}

// Global mock
global.EventSource = class EventSourcePolyfill {
  static readonly CONNECTING = MockEventSource.CONNECTING;
  static readonly OPEN = MockEventSource.OPEN;
  static readonly CLOSED = MockEventSource.CLOSED;

  constructor(url: string) {
    return new MockEventSource(url);
  }
} as unknown as typeof EventSource;

// Make MessageEvent available (jsdom sometimes doesn't include it properly)
if (typeof global.MessageEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MessageEvent = MessageEvent;
}
