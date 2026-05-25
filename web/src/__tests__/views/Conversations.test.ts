import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
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

import { useRoute as vueRouterUseRoute } from 'vue-router';

function createMockConversationStore(overrides: Partial<conversationApi.ConversationStore> = {}): conversationApi.ConversationStore {
  return {
    conversations: [],
    currentConversation: null,
    activeConversation: null,
    loading: false,
    error: null,
    unreadCount: 0,
    messageInput: '',
    fetchConversations: vi.fn(),
    fetchUnread: vi.fn(),
    createConversation: vi.fn(),
    selectConversation: vi.fn(),
    deleteConversation: vi.fn(),
    addMessage: vi.fn(),
    sendMessage: vi.fn(),
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
          fetched_until_id: 1,
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
          fetched_until_id: 1,
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
});
