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
      { id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hello', created_at: '2024-01-01', fetched_until_id: 1 },
      { id: 2, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hi there', created_at: '2024-01-01', fetched_until_id: 2 },
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
    expect(store.fetchedUntilId).toBe(2);
    expect(store.loading).toBe(false);
  });

  it('selectConversation sets fetchedUntilId to 0 when no messages', async () => {
    const conversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [],
    };
    vi.mocked(api.getConversation).mockResolvedValue({ success: true, data: conversation });

    const store = useConversationStore();
    await store.selectConversation('test-project', 1);

    expect(store.fetchedUntilId).toBe(0);
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
    const message = { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello!', created_at: '2024-01-01', fetched_until_id: 3 };
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
    const message = { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'Hello!', created_at: '2024-01-01', fetched_until_id: 3 };
    vi.mocked(api.sendMessage).mockResolvedValue({ success: true, data: message });

    const store = useConversationStore();
    store.activeConversation = {
      id: 2, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [{ id: 1, conversation_id: 2, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', fetched_until_id: 1 }],
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
    store.fetchedUntilId = 42;

    store.clearActive();

    expect(store.activeConversation).toBeNull();
    expect(store.fetchedUntilId).toBe(0);
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

  it('fetchUnreadAction appends unread messages to active conversation', async () => {
    const unreadMessages = [
      { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'New msg', created_at: '2024-01-01', fetched_until_id: 3 },
    ];
    vi.mocked(api.fetchUnread).mockResolvedValue({
      success: true,
      data: { messages: unreadMessages, fetched_until_id: 3 },
    });

    const store = useConversationStore();
    store.activeConversation = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 4,
      from_role_name: 'Human User', to_role_name: 'AI Developer',
      messages: [{ id: 1, conversation_id: 1, sender_role_id: 1, sender_role_name: 'Human', content: 'Hi', created_at: '2024-01-01', fetched_until_id: 1 }],
    };

    await store.fetchUnread('test-project');

    expect(store.activeConversation?.messages).toHaveLength(2);
    expect(store.fetchedUntilId).toBe(3);
  });

  it('fetchUnreadAction increments unreadCount when messages arrive', async () => {
    const unreadMessages = [
      { id: 3, conversation_id: 1, sender_role_id: 4, sender_role_name: 'AI', content: 'New msg', created_at: '2024-01-01', fetched_until_id: 3 },
    ];
    vi.mocked(api.fetchUnread).mockResolvedValue({
      success: true,
      data: { messages: unreadMessages, fetched_until_id: 3 },
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
      data: { messages: [], fetched_until_id: 0 },
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
