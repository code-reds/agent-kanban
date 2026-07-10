import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConversationStore } from '@/stores/conversations';
import * as api from '@/api';

vi.mock('@/api', () => ({
  getConversations: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  fetchUnread: vi.fn(),
  createConversation: vi.fn(),
}));

describe('useConversationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('fetchConversations sets conversations from API response', async () => {
    const conversations = [
      { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
      { id: 2, project_id: 1, from_role_id: 4, to_role_id: 1, from_role_name: 'AI Developer', to_role_name: 'Human User' },
    ];
    vi.mocked(api.getConversations).mockResolvedValue({ success: true, data: conversations });

    const store = useConversationStore();
    await store.fetchConversations('test-project');

    expect(store.conversations).toEqual(conversations);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchConversations sets error on failure', async () => {
    vi.mocked(api.getConversations).mockResolvedValue({ success: false, error: 'API error' });

    const store = useConversationStore();
    await store.fetchConversations('test-project');

    expect(store.error).toBe('API error');
    expect(store.conversations).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('selectConversation loads conversation with messages', async () => {
    const messages = [
      { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hello', created_at: '2024-01-01', last_read_message_id: 1 },
      { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hi there', created_at: '2024-01-01', last_read_message_id: 2 },
    ];
    const conversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages,
    };
    vi.mocked(api.getConversation).mockResolvedValue({ success: true, data: conversation });

    const store = useConversationStore();
    await store.selectConversation('test-project', 1);

    expect(store.activeConversation).toEqual(conversation);
    expect(store.lastReadMessageId).toBe(2);
    expect(store.loading).toBe(false);
  });

  it('selectConversation sets lastReadMessageId to 0 when no messages', async () => {
    const conversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    vi.mocked(api.getConversation).mockResolvedValue({ success: true, data: conversation });

    const store = useConversationStore();
    await store.selectConversation('test-project', 1);

    expect(store.lastReadMessageId).toBe(0);
  });

  it('selectConversation sets error on failure', async () => {
    vi.mocked(api.getConversation).mockResolvedValue({ success: false, error: 'Not found' });

    const store = useConversationStore();
    await store.selectConversation('test-project', 1);

    expect(store.error).toBe('Not found');
    expect(store.activeConversation).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('sendMessageAction sends message and appends to active conversation', async () => {
    const message = { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello!', created_at: '2024-01-01', last_read_message_id: 3 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: message });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    store.messageInput = 'Hello!';

    const result = await store.sendMessage('test-project', 1);

    expect(result).toBe(true);
    expect(store.activeConversation?.messages).toHaveLength(1);
    expect(store.activeConversation?.messages[0].content).toBe('Hello!');
    expect(store.messageInput).toBe('');
  });

  it('sendMessageAction updates lastReadMessageId to sent message ID (fixes "0 New" badge)', async () => {
    // Regression test for ticket #108: after sending a message in a new conversation,
    // lastReadMessageId should be updated to prevent false "0 New" badge
    const message = { id: 3, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hello!', created_at: '2024-01-01', last_read_message_id: 3 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: message });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    store.lastReadMessageId = 0; // Simulating a new conversation with no prior reads
    store.messageInput = 'Hello!';

    await store.sendMessage('test-project', 1);

    // lastReadMessageId should now be updated to the sent message's ID
    expect(store.lastReadMessageId).toBe(3);
    // unreadIndex should be -1 (no unread messages) since the sent message is now "read"
    expect(store.unreadIndex).toBe(-1);
  });

  it('sendMessageAction uses Math.max to prevent cursor from moving backward', async () => {
    // If a previous message had a higher ID, lastReadMessageId should not decrease
    const existingMessages = [
      { id: 10, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Old AI msg', created_at: '2024-01-01', last_read_message_id: 10 },
    ];
    const newMessage = { id: 5, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'New', created_at: '2024-01-01', last_read_message_id: 5 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: newMessage });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: existingMessages,
    };
    store.lastReadMessageId = 10; // Already read up to message 10
    store.messageInput = 'New';

    await store.sendMessage('test-project', 1);

    // lastReadMessageId should stay at 10 (Math.max(10, 5) = 10)
    expect(store.lastReadMessageId).toBe(10);
  });

  it('sendMessageAction does not update lastReadMessageId for non-active conversation', async () => {
    const message = { id: 3, conversation_id: 99, sender_role_id: 1, sender_role_name: 'Human', content: 'Hello!', created_at: '2024-01-01', last_read_message_id: 3 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: message });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    store.lastReadMessageId = 0;
    store.messageInput = 'Hello!';

    await store.sendMessage('test-project', 99); // Sending to different conversation

    // lastReadMessageId should NOT be updated since the active conversation doesn't match
    expect(store.lastReadMessageId).toBe(0);
  });

  it('sendMessageAction returns false on failure and restores input', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({ success: false, error: 'Send failed' });

    const store = useConversationStore();
    store.messageInput = 'Hello!';

    const result = await store.sendMessage('test-project', 1);

    expect(result).toBe(false);
    expect(store.error).toBe('Send failed');
    expect(store.messageInput).toBe('Hello!');
  });

  it('sendMessageAction returns false for empty message', async () => {
    const store = useConversationStore();
    store.messageInput = '   ';

    const result = await store.sendMessage('test-project', 1);

    expect(result).toBe(false);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('sendMessageAction only appends to active conversation if conversation ID matches', async () => {
    const message = { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello!', created_at: '2024-01-01', last_read_message_id: 3 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: message });

    const store = useConversationStore();
    store.activeConversation = {
      id: 2, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [{ id: 1, conversation_id: 2, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', last_read_message_id: 1 }],
    };

    await store.sendMessage('test-project', 1);

    expect(store.activeConversation?.messages).toHaveLength(1);
  });

  it('clearActive clears active conversation state', () => {
    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    store.lastReadMessageId = 42;

    store.clearActive();

    expect(store.activeConversation).toBeNull();
    expect(store.lastReadMessageId).toBe(0);
  });

  it('activeConversationId returns conversation ID or null', () => {
    const store = useConversationStore();
    expect(store.activeConversationId).toBeNull();

    store.activeConversation = {
      id: 5, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    expect(store.activeConversationId).toBe(5);
  });

  it('setUnreadCount sets the unread count', () => {
    const store = useConversationStore();
    store.setUnreadCount(5);
    expect(store.unreadCount).toBe(5);
  });

  describe('unreadIndex', () => {
    it('returns -1 when no active conversation', () => {
      const store = useConversationStore();
      store.activeConversation = null;
      expect(store.unreadIndex).toBe(-1);
    });

    it('returns -1 when no unread messages', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
        from_role_name: 'Human User', to_role_name: 'AI Developer',
        messages: [
          { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', last_read_message_id: 1 },
          { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01', last_read_message_id: 2 },
        ],
      };
      store.lastReadMessageId = 2;
      expect(store.unreadIndex).toBe(-1);
    });

    it('returns the index of the first unread message', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
        from_role_name: 'Human User', to_role_name: 'AI Developer',
        messages: [
          { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', last_read_message_id: 1 },
          { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01', last_read_message_id: 2 },
          { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'New!', created_at: '2024-01-01', last_read_message_id: 3 },
          { id: 4, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi again', created_at: '2024-01-01', last_read_message_id: 4 },
          { id: 5, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'More new!', created_at: '2024-01-01', last_read_message_id: 5 },
        ],
      };
      store.lastReadMessageId = 2;
      expect(store.unreadIndex).toBe(2);
    });
  });

  describe('isHumanConversation', () => {
    it('returns false when no active conversation', () => {
      const store = useConversationStore();
      store.activeConversation = null;
      expect(store.isHumanConversation).toBe(false);
    });

    it('returns true when conversation involves Human User (from_role_id)', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
        from_role_name: 'Human User', to_role_name: 'AI Developer',
        messages: [],
      };
      expect(store.isHumanConversation).toBe(true);
    });

    it('returns true when conversation involves Human User (to_role_id)', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 4, to_role_id: 1,
        from_role_name: 'AI Developer', to_role_name: 'Human User',
        messages: [],
      };
      expect(store.isHumanConversation).toBe(true);
    });

    it('returns false when conversation does not involve Human User', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 4, to_role_id: 5,
        from_role_name: 'AI Developer', to_role_name: 'AI Reviewer',
        messages: [],
      };
      expect(store.isHumanConversation).toBe(false);
    });
  });

  describe('markAsRead', () => {
    it('sets lastReadMessageId to last message id and resets unreadCount', () => {
      const store = useConversationStore();
      store.activeConversation = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
        from_role_name: 'Human User', to_role_name: 'AI Developer',
        messages: [
          { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', last_read_message_id: 1 },
          { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01', last_read_message_id: 2 },
        ],
      };
      store.unreadCount = 5;
      store.lastReadMessageId = 1;

      store.markAsRead();

      expect(store.lastReadMessageId).toBe(2);
      expect(store.unreadCount).toBe(0);
    });

    it('does nothing when no active conversation', () => {
      const store = useConversationStore();
      store.unreadCount = 5;
      store.lastReadMessageId = 10;

      store.markAsRead();

      expect(store.lastReadMessageId).toBe(10);
      expect(store.unreadCount).toBe(5);
    });
  });

  it('fetchUnreadAction appends unread messages to active conversation', async () => {
    const unreadMessages = [
      { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'New msg', created_at: '2024-01-01', last_read_message_id: 3 },
    ];
    vi.mocked(api.fetchUnread).mockResolvedValue({
      success: true,
      data: { messages: unreadMessages, last_read_message_id: 3 },
    });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [{ id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', last_read_message_id: 1 }],
    };

    await store.fetchUnread('test-project');

    expect(store.activeConversation?.messages).toHaveLength(2);
    expect(store.lastReadMessageId).toBe(3);
  });

  it('fetchUnreadAction increments unreadCount when messages arrive', async () => {
    const unreadMessages = [
      { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'New msg', created_at: '2024-01-01', last_read_message_id: 3 },
    ];
    vi.mocked(api.fetchUnread).mockResolvedValue({
      success: true,
      data: { messages: unreadMessages, last_read_message_id: 3 },
    });

    const store = useConversationStore();
    store.activeConversation = null;

    await store.fetchUnread('test-project');

    expect(store.unreadCount).toBe(1);
  });

  it('fetchUnreadAction fails silently', async () => {
    vi.mocked(api.fetchUnread).mockRejectedValue(new Error('Network error'));

    const store = useConversationStore();
    // Should not throw
    await expect(store.fetchUnread('test-project')).resolves.not.toThrow();
  });

  it('fetchUnreadAction does nothing when no messages', async () => {
    vi.mocked(api.fetchUnread).mockResolvedValue({
      success: true,
      data: { messages: [], last_read_message_id: 0 },
    });

    const store = useConversationStore();
    await store.fetchUnread('test-project');

    expect(store.unreadCount).toBe(0);
  });

  describe('conversationExistsWithRole', () => {
    it('returns false when no conversations exist', () => {
      const store = useConversationStore();
      expect(store.conversationExistsWithRole(4)).toBe(false);
    });

    it('returns true when a conversation exists in forward direction', () => {
      const store = useConversationStore();
      store.conversations = [
        { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
      ];
      expect(store.conversationExistsWithRole(4)).toBe(true);
    });

    it('returns true when a conversation exists in reverse direction', () => {
      const store = useConversationStore();
      store.conversations = [
        { id: 1, project_id: 1, from_role_id: 4, to_role_id: 1, from_role_name: 'AI Developer', to_role_name: 'Human User' },
      ];
      expect(store.conversationExistsWithRole(4)).toBe(true);
    });

    it('returns false when conversation is with a different role', () => {
      const store = useConversationStore();
      store.conversations = [
        { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
      ];
      expect(store.conversationExistsWithRole(5)).toBe(false);
    });
  });

  describe('findExistingConversation', () => {
    it('returns undefined when no conversations exist', () => {
      const store = useConversationStore();
      expect(store.findExistingConversation(99)).toBeUndefined();
    });

    it('returns the matching conversation', () => {
      const store = useConversationStore();
      store.conversations = [
        { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
        { id: 2, project_id: 1, from_role_id: 1, to_role_id: 5, from_role_name: 'Human User', to_role_name: 'AI Reviewer' },
      ];
      const result = store.findExistingConversation(4);
      expect(result?.id).toBe(1);
    });

    it('returns the reverse-direction conversation', () => {
      const store = useConversationStore();
      store.conversations = [
        { id: 1, project_id: 1, from_role_id: 4, to_role_id: 1, from_role_name: 'AI Developer', to_role_name: 'Human User' },
      ];
      const result = store.findExistingConversation(4);
      expect(result?.id).toBe(1);
    });
  });

  describe('SSE handlers', () => {
    describe('handleConversationCreated', () => {
      it('adds a new conversation to the list', () => {
        const store = useConversationStore();
        const conversation = {
          id: 10, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
        };

        store.handleConversationCreated(conversation);

        expect(store.conversations).toHaveLength(1);
        expect(store.conversations[0].id).toBe(10);
      });

      it('does not duplicate conversation if already in list', () => {
        const store = useConversationStore();
        const conversation = {
          id: 10, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
        };
        store.conversations = [conversation];

        store.handleConversationCreated(conversation);

        expect(store.conversations).toHaveLength(1);
      });

      it('adds conversation even when active conversation is set', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [],
        };
        store.conversations = [
          { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
        ];
        const newConversation = {
          id: 20, project_id: 1, from_role_id: 1, to_role_id: 5,
          from_role_name: 'Human User', to_role_name: 'AI Reviewer',
        };

        store.handleConversationCreated(newConversation);

        expect(store.conversations).toHaveLength(2);
        expect(store.conversations[1].id).toBe(20);
      });
    });

    describe('handleConversationMessageSent', () => {
      it('appends message to active conversation when conversation matches', () => {
        const store = useConversationStore();
        const message = {
          id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI',
          content: 'Hello!', created_at: '2024-01-01',
        };
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [
            { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01' },
          ],
        };
        store.lastReadMessageId = 1;

        store.handleConversationMessageSent(1, message);

        expect(store.activeConversation?.messages).toHaveLength(2);
        expect(store.activeConversation?.messages[1].content).toBe('Hello!');
        expect(store.lastReadMessageId).toBe(3);
      });

      it('does not duplicate message if same ID already exists', () => {
        const store = useConversationStore();
        const message = {
          id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI',
          content: 'Hello!', created_at: '2024-01-01',
        };
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [message],
        };
        store.lastReadMessageId = 1;

        store.handleConversationMessageSent(1, message);

        expect(store.activeConversation?.messages).toHaveLength(1);
      });

      it('increments unreadCount when conversation is not active', () => {
        const store = useConversationStore();
        const message = {
          id: 5, conversation_id: 99, sender_role_id: 4, sender_role_name: 'AI',
          content: 'Hey!', created_at: '2024-01-01',
        };
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [],
        };
        store.unreadCount = 2;

        store.handleConversationMessageSent(99, message);

        expect(store.unreadCount).toBe(3);
        expect(store.activeConversation?.messages).toHaveLength(0);
      });

      it('uses Math.max for lastReadMessageId when existing value is higher', () => {
        const store = useConversationStore();
        const message = {
          id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI',
          content: 'Old message', created_at: '2024-01-01',
        };
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [
            { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01' },
          ],
        };
        store.lastReadMessageId = 5; // Already read past message 2

        store.handleConversationMessageSent(1, message);

        expect(store.lastReadMessageId).toBe(5);
      });
    });

    describe('handleConversationReadUpdated', () => {
      it('updates lastReadMessageId for active conversation', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [
            { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01' },
            { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01' },
          ],
        };
        store.lastReadMessageId = 1;
        store.unreadCount = 1;

        store.handleConversationReadUpdated(1, 2);

        expect(store.lastReadMessageId).toBe(2);
      });

      it('sets unreadCount to 0 when all messages are read', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [
            { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01' },
            { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01' },
          ],
        };
        store.lastReadMessageId = 1;
        store.unreadCount = 3;

        store.handleConversationReadUpdated(1, 2);

        expect(store.lastReadMessageId).toBe(2);
        expect(store.unreadCount).toBe(0);
      });

      it('does not modify unreadCount when some messages remain unread', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [
            { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01' },
            { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello', created_at: '2024-01-01' },
            { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'More', created_at: '2024-01-01' },
          ],
        };
        store.lastReadMessageId = 1;
        store.unreadCount = 2;

        store.handleConversationReadUpdated(1, 2);

        expect(store.lastReadMessageId).toBe(2);
        expect(store.unreadCount).toBe(2); // Still has unread message 3
      });

      it('does nothing when conversation is not active', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [],
        };
        store.lastReadMessageId = 5;

        store.handleConversationReadUpdated(99, 10);

        expect(store.lastReadMessageId).toBe(5);
      });
    });

    describe('handleConversationDeleted', () => {
      it('removes conversation from list', () => {
        const store = useConversationStore();
        store.conversations = [
          { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
          { id: 2, project_id: 1, from_role_id: 1, to_role_id: 5, from_role_name: 'Human User', to_role_name: 'AI Reviewer' },
        ];

        store.handleConversationDeleted(1);

        expect(store.conversations).toHaveLength(1);
        expect(store.conversations[0].id).toBe(2);
      });

      it('clears active conversation when it is deleted', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [],
        };
        store.lastReadMessageId = 5;

        store.handleConversationDeleted(1);

        expect(store.activeConversation).toBeNull();
        expect(store.lastReadMessageId).toBe(0);
      });

      it('does not clear active conversation when a different conversation is deleted', () => {
        const store = useConversationStore();
        store.activeConversation = {
          id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
          from_role_name: 'Human User', to_role_name: 'AI Developer',
          messages: [],
        };
        store.conversations = [
          { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
          { id: 2, project_id: 1, from_role_id: 1, to_role_id: 5, from_role_name: 'Human User', to_role_name: 'AI Reviewer' },
        ];

        store.handleConversationDeleted(2);

        expect(store.activeConversation?.id).toBe(1);
        expect(store.conversations).toHaveLength(1);
      });

      it('handles deletion of non-existent conversation gracefully', () => {
        const store = useConversationStore();
        store.conversations = [
          { id: 1, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' },
        ];

        store.handleConversationDeleted(99);

        expect(store.conversations).toHaveLength(1);
      });
    });
  });

  describe('createConversation', () => {
    it('creates a new conversation and adds it to the list', async () => {
      const newConv = { id: 10, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' };
      vi.mocked(api.createConversation).mockResolvedValue({ success: true, data: newConv });

      const store = useConversationStore();
      const result = await store.createConversation('test-project', 4);

      expect(result).toBe(10);
      expect(api.createConversation).toHaveBeenCalledWith('test-project', { role_id: 4 });
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe(10);
      expect(store.conversations[0].to_role_id).toBe(4);
      expect(store.loading).toBe(false);
    });

    it('does not duplicate conversation if already in list', async () => {
      const existingConv = { id: 5, project_id: 1, from_role_id: 1, to_role_id: 4, from_role_name: 'Human User', to_role_name: 'AI Developer' };
      vi.mocked(api.createConversation).mockResolvedValue({ success: true, data: existingConv });

      const store = useConversationStore();
      store.conversations = [existingConv];

      const result = await store.createConversation('test-project', 4);

      expect(result).toBe(5);
      expect(store.conversations).toHaveLength(1);
    });

    it('returns null and sets error on failure', async () => {
      vi.mocked(api.createConversation).mockResolvedValue({ success: false, error: 'Failed' });

      const store = useConversationStore();
      const result = await store.createConversation('test-project', 4);

      expect(result).toBeNull();
      expect(store.error).toBe('Failed');
    });

    it('sets error on network error', async () => {
      vi.mocked(api.createConversation).mockRejectedValue(new Error('Network error'));

      const store = useConversationStore();
      const result = await store.createConversation('test-project', 4);

      expect(result).toBeNull();
      expect(store.error).toBe('Network error');
    });
  });
});
