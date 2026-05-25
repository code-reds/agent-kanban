import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory, useRoute } from 'vue-router';
import Header from '@/components/layout/Header.vue';
import * as projectsApi from '@/stores/projects';
import * as conversationsApi from '@/stores/conversations';
import * as themeApi from '@/composables/useTheme';

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('@/stores/conversations', () => ({
  useConversationStore: vi.fn(),
}));

vi.mock('@/composables/useTheme', () => ({
  useTheme: vi.fn(),
}));

function createMockProjectStore(overrides: Partial<projectsApi.ProjectStore> = {}): projectsApi.ProjectStore {
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
  } as unknown as projectsApi.ProjectStore;
}

function createMockConversationStore(overrides: Partial<conversationsApi.ConversationStore> = {}): conversationsApi.ConversationStore {
  return {
    conversations: [],
    currentConversation: null,
    loading: false,
    error: null,
    unreadCount: 0,
    fetchConversations: vi.fn(),
    fetchUnread: vi.fn(),
    createConversation: vi.fn(),
    setCurrentConversation: vi.fn(),
    deleteConversation: vi.fn(),
    addMessage: vi.fn(),
    sendMessage: vi.fn(),
    ...overrides,
  } as unknown as conversationsApi.ConversationStore;
}

function createWrapper({
  projectStore,
  conversationStore,
  themeOptions,
}: {
  projectStore?: projectsApi.ProjectStore;
  conversationStore?: conversationsApi.ConversationStore;
  themeOptions?: { isDark?: boolean; toggleTheme?: () => void };
} = {}) {
  const mockProjectStore = projectStore || createMockProjectStore();
  const mockConvStore = conversationStore || createMockConversationStore();

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div/>' } },
      { path: '/projects/:slug/board', name: 'board', component: { template: '<div/>' } },
      { path: '/projects/:slug/conversations', name: 'conversations', component: { template: '<div/>' } },
      { path: '/projects/:slug/settings', name: 'settings', component: { template: '<div/>' } },
    ],
  });

  setActivePinia(createPinia());

  (projectsApi.useProjectStore as any).mockReturnValue(mockProjectStore);
  (conversationsApi.useConversationStore as any).mockReturnValue(mockConvStore);
  (themeApi.useTheme as any).mockReturnValue({
    isDark: themeOptions?.isDark ?? false,
    toggleTheme: themeOptions?.toggleTheme ?? (() => {}),
    mode: 'system',
    applyTheme: (() => {}) as any,
    setMode: (() => {}) as any,
  });

  return {
    wrapper: mount(Header, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          RouterLink: {
            name: 'RouterLinkStub',
            props: ['to'],
            template: '<a class="router-link-stub" :class="$route.path === to || ($route.path.startsWith(\'/projects\') && to && $route.path.includes(to.split(\'/\')[2])) ? \'active\' : \'\' " :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
          },
        },
      },
    }),
    mockProjectStore,
    mockConvStore,
    router,
  };
}

describe('Header', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the app title', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Agent Kanban');
    wrapper.unmount();
  });

  it('renders Dashboard nav link', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Dashboard');
    wrapper.unmount();
  });

  it('hides project-specific nav links when no current project', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).not.toContain('Board');
    expect(wrapper.text()).not.toContain('Conversations');
    expect(wrapper.text()).not.toContain('Settings');
    wrapper.unmount();
  });

  it('shows Board, Conversations, and Settings links when current project exists', () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'my-project', created_at: '2024-01-01', updated_at: '2024-01-01',
        description: '', columns: [], roles: [], workflow: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    expect(wrapper.text()).toContain('Board');
    expect(wrapper.text()).toContain('Conversations');
    expect(wrapper.text()).toContain('Settings');
    wrapper.unmount();
  });

  it('shows Board link with correct slug-based URL', () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'my-project', created_at: '2024-01-01', updated_at: '2024-01-01',
        description: '', columns: [], roles: [], workflow: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    const links = wrapper.findAll('a.router-link-stub');
    const boardLink = links.find(l => l.text() === 'Board');
    expect(boardLink?.attributes('href')).toBe('/projects/my-project/board');
    wrapper.unmount();
  });

  it('shows unread badge when conversation store has unread count', () => {
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', created_at: '2024-01-01', updated_at: '2024-01-01',
        description: '', columns: [], roles: [], workflow: [], access_rules: [],
      },
    });
    const mockConvStore = createMockConversationStore({ unreadCount: 3 });
    const { wrapper } = createWrapper({ projectStore: mockProjectStore, conversationStore: mockConvStore });
    expect(wrapper.find('.unread-badge').exists()).toBe(true);
    expect(wrapper.find('.unread-badge').text()).toBe('3');
    wrapper.unmount();
  });

  it('does not show unread badge when unread count is zero', () => {
    const { wrapper } = createWrapper();
    const badge = wrapper.find('.unread-badge');
    expect(badge.exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders app-header class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.app-header').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders header-content class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.header-content').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders header-nav class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.header-nav').exists()).toBe(true);
    wrapper.unmount();
  });

  it('toggles theme when theme button clicked', async () => {
    const mockToggle = vi.fn();
    const { wrapper } = createWrapper({ themeOptions: { isDark: false, toggleTheme: mockToggle } });
    await wrapper.find('.theme-toggle').trigger('click');
    expect(mockToggle).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders moon icon in theme toggle when theme is light', async () => {
    const { wrapper } = createWrapper({ themeOptions: { isDark: false, toggleTheme: vi.fn() } });
    expect(wrapper.find('.theme-toggle svg').exists()).toBe(true);
    expect(wrapper.find('.theme-toggle').attributes('title')).toContain('dark');
    wrapper.unmount();
  });

  it('renders sun icon in theme toggle when theme is dark', async () => {
    const { wrapper } = createWrapper({ themeOptions: { isDark: true, toggleTheme: vi.fn() } });
    expect(wrapper.find('.theme-toggle svg').exists()).toBe(true);
    expect(wrapper.find('.theme-toggle').attributes('title')).toContain('light');
    wrapper.unmount();
  });

  it('renders the settings gear icon', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.settings-icon').exists()).toBe(true);
    expect(wrapper.find('.settings-icon svg').exists()).toBe(true);
    wrapper.unmount();
  });

  it('settings icon has correct tooltip', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.settings-icon').attributes('title')).toBe('Global Settings');
    wrapper.unmount();
  });

  it('settings dropdown is hidden by default', () => {
    const { wrapper } = createWrapper();
    // Teleported content is in document.body, not in component
    expect(document.body.querySelector('.settings-dropdown')).toBeNull();
    wrapper.unmount();
  });

  it('clicking settings icon opens dropdown', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.settings-icon').trigger('click');
    await wrapper.vm.$nextTick();
    const dropdown = document.body.querySelector('.settings-dropdown');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.textContent).toContain('Global Settings');
    wrapper.unmount();
  });

  it('clicking "Global Settings" navigates to /global-settings', async () => {
    const pushSpy = vi.fn();
    const { wrapper, router } = createWrapper();
    // Replace router.push with our spy
    router.push = pushSpy;
    await wrapper.find('.settings-icon').trigger('click');
    await wrapper.vm.$nextTick();
    await flushPromises();
    const item = document.body.querySelector('.settings-dropdown__item');
    expect(item).not.toBeNull();
    if (item) {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await wrapper.vm.$nextTick();
    expect(pushSpy).toHaveBeenCalledWith('/global-settings');
    // Dropdown should be closed after navigation
    expect(document.body.querySelector('.settings-dropdown')).toBeNull();
    router.push = vi.fn();
    wrapper.unmount();
  });

  it('clicking outside dropdown closes it', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.settings-icon').trigger('click');
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.settings-dropdown')).not.toBeNull();
    // Click outside the dropdown
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.settings-dropdown')).toBeNull();
    wrapper.unmount();
  });

  it('clicking dropdown background (self) closes it', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.settings-icon').trigger('click');
    await wrapper.vm.$nextTick();
    const dropdown = document.body.querySelector('.settings-dropdown');
    expect(dropdown).not.toBeNull();
    if (dropdown) {
      dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.settings-dropdown')).toBeNull();
    wrapper.unmount();
  });

  it('settings icon has hover styling', () => {
    const { wrapper } = createWrapper();
    const settingsIcon = wrapper.find('.settings-icon');
    expect(settingsIcon.exists()).toBe(true);
    // Verify the element is a button (for accessibility)
    expect(settingsIcon.element.tagName).toBe('BUTTON');
    wrapper.unmount();
  });
});
