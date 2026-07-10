import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { createRouter, createWebHashHistory, useRoute } from 'vue-router';
import Conversations from '@/views/Conversations.vue';
import * as conversationApi from '@/stores/conversations';
import * as projectApi from '@/stores/projects';

vi.mock('@/stores/conversations', () => ({
  useConversationStore: vi.fn(),
}));

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: vi.fn(),
  };
});

vi.mock('@/composables/useSSE', () => ({
  useSSE: vi.fn(() => ({
    connected: { value: false },
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

import { useSSE } from '@/composables/useSSE';

import { useRoute as vueRouterUseRoute } from 'vue-router';

function createMockConversationStore(overrides: Partial<conversationApi.ConversationStore> = {}): conversationApi.ConversationStore {
  return {
    conversations: [],
    currentConversation: null,
    activeConversation: null,
    loading: false,
    error: null,
    unreadCount: 0,
    unreadIndex: -1,
    isHumanConversation: false,
    messageInput: '',
    fetchConversations: vi.fn(),
    fetchUnread: vi.fn(),
    createConversation: vi.fn(),
    selectConversation: vi.fn(),
    deleteConversation: vi.fn(),
    addMessage: vi.fn(),
    sendMessage: vi.fn(),
    markAsRead: vi.fn(),
    handleConversationCreated: vi.fn(),
    handleConversationMessageSent: vi.fn(),
    handleConversationReadUpdated: vi.fn(),
    handleConversationDeleted: vi.fn(),
    ...overrides,
  } as unknown as conversationApi.ConversationStore;
}

function createMockProjectStore(overrides: Partial<projectApi.ProjectStore> = {}): projectApi.ProjectStore {
  return {
    projects: [],
    currentProject: null,
    loading: false,
    error: null,
    fetchProjects: vi.fn(),
    createProject: vi.fn(),
    setCurrentProject: vi.fn(),
    deleteProject: vi.fn(),
    addColumn: vi.fn(),
    currentProjectById: vi.fn(),
    ...overrides,
  } as unknown as projectApi.ProjectStore;
}

function createWrapper({
  conversationStore,
  projectStore,
  routeSlug,
}: {
  conversationStore?: conversationApi.ConversationStore;
  projectStore?: projectApi.ProjectStore;
  routeSlug?: string;
} = {}) {
  const mockConvStore = conversationStore || createMockConversationStore();
  const mockProjectStore = projectStore || createMockProjectStore();

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/projects/:slug/conversations', name: 'conversations', component: { template: '<div/>' } }],
  });

  setActivePinia(createPinia());

  (vueRouterUseRoute as any).mockReturnValue({ params: { slug: routeSlug || 'test-project' } });
  (conversationApi.useConversationStore as any).mockReturnValue(mockConvStore);
  (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);

  return {
    wrapper: mount(Conversations, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
          },
        },
      },
    }),
    mockConvStore,
    mockProjectStore,
    router,
  };
}

describe('Conversations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the conversations heading', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Conversations');
    wrapper.unmount();
  });

  it('renders refresh button', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.refresh-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows empty state when no conversations', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.empty-state').text()).toContain('No conversations yet');
    wrapper.unmount();
  });

  it('shows error state when store has error', () => {
    const mockStore = createMockConversationStore({ error: 'Network error' });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    expect(wrapper.find('.error-state').text()).toContain('Network error');
    wrapper.unmount();
  });

  it('shows placeholder when no active conversation', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.message-placeholder').text()).toContain('Select a conversation');
    wrapper.unmount();
  });

  it('renders conversation list items when conversations exist', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
    };
    const mockStore = createMockConversationStore({ conversations: [conv] });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    const items = wrapper.findAll('.conversation-item');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain('Conversation #1');
    wrapper.unmount();
  });

  it('shows active class on selected conversation', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({
      conversations: [conv],
      activeConversation: conv,
    });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    const activeItem = wrapper.find('.conversation-item.active');
    expect(activeItem.exists()).toBe(true);
    wrapper.unmount();
  });

  it('clicking conversation item calls selectConversation', async () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
    };
    const mockStore = createMockConversationStore({ conversations: [conv] });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    const item = wrapper.find('.conversation-item');
    await item.trigger('click');
    expect(mockStore.selectConversation).toHaveBeenCalledWith('test-project', 1);
    wrapper.unmount();
  });

  it('shows message pane with conversation when selected', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    expect(wrapper.find('.message-header').exists()).toBe(true);
    expect(wrapper.find('.message-header-info').text()).toContain('Human');
    expect(wrapper.find('.message-header-info').text()).toContain('Agent');
    wrapper.unmount();
  });

  it('shows empty messages state', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    expect(wrapper.find('.empty-messages').text()).toContain('No messages yet');
    wrapper.unmount();
  });

  it('renders message bubbles with messages', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [
        {
          id: 1, conversation_id: 1, sender_role_id: 1,
          sender_role_name: 'Human', content: 'Hello', created_at: '2024-01-01T00:00:00Z',
          last_read_message_id: 1,
        },
      ],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Human', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ conversationStore: mockStore, projectStore: mockProjectStore });
    const bubbles = wrapper.findAll('.message-bubble');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].text()).toContain('Hello');
    wrapper.unmount();
  });

  it('renders markdown content in message bubbles using v-html', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [
        {
          id: 1, conversation_id: 1, sender_role_id: 1,
          sender_role_name: 'Human', content: '**bold text** and *italic*',
          created_at: '2024-01-01T00:00:00Z',
          last_read_message_id: 1,
        },
      ],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Human', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ conversationStore: mockStore, projectStore: mockProjectStore });
    const bubbles = wrapper.findAll('.message-bubble');
    expect(bubbles).toHaveLength(1);
    const contentEl = bubbles[0].find('.message-content');
    expect(contentEl.exists()).toBe(true);
    // v-html renders markdown, so bold text appears as <strong>bold text</strong>
    expect(contentEl.html()).toContain('<strong>bold text</strong>');
    expect(contentEl.html()).toContain('<em>italic</em>');
    wrapper.unmount();
  });

  it('shows message input area', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    expect(wrapper.find('.message-input-area textarea').exists()).toBe(true);
    expect(wrapper.find('.send-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('disables send button when no input', () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({ activeConversation: conv });
    const { wrapper } = createWrapper({ conversationStore: mockStore });
    const sendBtn = wrapper.find('.send-btn');
    expect(sendBtn.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('calls sendMessage when send button clicked', async () => {
    const conv = {
      id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
      from_role_name: 'Human', to_role_name: 'Agent',
      messages: [],
    };
    const mockStore = createMockConversationStore({
      activeConversation: conv,
      messageInput: 'Hello there',
    });
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Human', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ conversationStore: mockStore, projectStore: mockProjectStore });
    const sendBtn = wrapper.find('.send-btn');
    await sendBtn.trigger('click');
    expect(mockStore.sendMessage).toHaveBeenCalledWith('test-project', 1, 1);
    wrapper.unmount();
  });

  it('renders conversations-layout class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.conversations-layout').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders conversation-list-pane class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.conversation-list-pane').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders message-pane class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.message-pane').exists()).toBe(true);
    wrapper.unmount();
  });

  describe('SSE integration', () => {
    it('SSE connects on mount', () => {
      const { wrapper } = createWrapper();
      const sseMock = (useSSE as any).mock.results[0].value;
      expect(sseMock.connect).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('SSE disconnects on unmount', () => {
      const { wrapper } = createWrapper();
      const sseMock = (useSSE as any).mock.results[0].value;
      wrapper.unmount();
      expect(sseMock.disconnect).toHaveBeenCalled();
    });

    it('SSE reconnects on slug change', async () => {
      const routeParams = reactive({ slug: 'project-a' });
      const mockConvStore = createMockConversationStore();
      const mockProjectStore = createMockProjectStore();

      const router = createRouter({
        history: createWebHashHistory(),
        routes: [{ path: '/projects/:slug/conversations', name: 'conversations', component: { template: '<div/>' } }],
      });

      setActivePinia(createPinia());
      (vueRouterUseRoute as any).mockReturnValue({ params: routeParams });
      (conversationApi.useConversationStore as any).mockReturnValue(mockConvStore);
      (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);

      const wrapper = mount(Conversations, {
        global: {
          plugins: [router, createPinia()],
          stubs: {
            RouterLink: {
              props: ['to'],
              template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
            },
          },
        },
      });

      const sseMock = (useSSE as any).mock.results[0].value;

      // Reset mock call tracking (connect was called during mount)
      sseMock.connect.mockClear();
      sseMock.disconnect.mockClear();

      // Change the route slug reactively
      routeParams.slug = 'project-b';

      // Wait for Vue reactivity to process the watch
      await vi.waitFor(() => {
        expect(sseMock.disconnect).toHaveBeenCalled();
        expect(sseMock.connect).toHaveBeenCalled();
      }, { timeout: 1000 });

      wrapper.unmount();
    });

    it('new conversation appears without refresh', async () => {
      // Use the real store directly (bypass mock)
      const { useConversationStore: realUseStore } = await vi.importActual<typeof import('@/stores/conversations')>('@/stores/conversations');
      const store = realUseStore();

      const createdConv = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
        from_role_name: 'Human', to_role_name: 'Agent',
      };
      store.handleConversationCreated(createdConv);

      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe(1);
    });

    it('new message appears without refresh', async () => {
      const { useConversationStore: realUseStore } = await vi.importActual<typeof import('@/stores/conversations')>('@/stores/conversations');
      const store = realUseStore();

      const conv = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
        from_role_name: 'Human', to_role_name: 'Agent',
        messages: [],
      };
      store.activeConversation = conv;

      const newMessage = {
        id: 10, conversation_id: 1, sender_role_id: 2,
        sender_role_name: 'Agent', content: 'Hello back!',
        created_at: '2024-01-01T00:01:00Z', last_read_message_id: 0,
      };
      store.handleConversationMessageSent(1, newMessage);

      expect(store.activeConversation?.messages).toHaveLength(1);
      expect(store.activeConversation?.messages[0].content).toBe('Hello back!');
    });

    it('no duplicate messages on repeated SSE event', async () => {
      const { useConversationStore: realUseStore } = await vi.importActual<typeof import('@/stores/conversations')>('@/stores/conversations');
      const store = realUseStore();

      const conv = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
        from_role_name: 'Human', to_role_name: 'Agent',
        messages: [],
      };
      store.activeConversation = conv;

      const msg = {
        id: 10, conversation_id: 1, sender_role_id: 2,
        sender_role_name: 'Agent', content: 'Hello!',
        created_at: '2024-01-01T00:01:00Z', last_read_message_id: 0,
      };

      // Send the same message twice via SSE
      store.handleConversationMessageSent(1, msg);
      store.handleConversationMessageSent(1, msg);

      expect(store.activeConversation?.messages).toHaveLength(1);
    });

    it('read state updates via SSE', async () => {
      const { useConversationStore: realUseStore } = await vi.importActual<typeof import('@/stores/conversations')>('@/stores/conversations');
      const store = realUseStore();

      const conv = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
        from_role_name: 'Human', to_role_name: 'Agent',
        messages: [
          {
            id: 1, conversation_id: 1, sender_role_id: 1,
            sender_role_name: 'Human', content: 'Hi',
            created_at: '2024-01-01T00:00:00Z', last_read_message_id: 0,
          },
          {
            id: 2, conversation_id: 1, sender_role_id: 2,
            sender_role_name: 'Agent', content: 'Hello',
            created_at: '2024-01-01T00:01:00Z', last_read_message_id: 0,
          },
        ],
      };
      store.activeConversation = conv;

      // Simulate read update via SSE
      store.handleConversationReadUpdated(1, 2);

      expect(store.lastReadMessageId).toBe(2);
    });

    it('deleted conversation removed from list', async () => {
      const { useConversationStore: realUseStore } = await vi.importActual<typeof import('@/stores/conversations')>('@/stores/conversations');
      const store = realUseStore();

      const conv = {
        id: 1, project_id: 1, from_role_id: 1, to_role_id: 2,
        from_role_name: 'Human', to_role_name: 'Agent',
      };
      store.conversations = [conv];

      // Simulate deletion via SSE
      store.handleConversationDeleted(1);

      expect(store.conversations).toHaveLength(0);
    });
  });
});
