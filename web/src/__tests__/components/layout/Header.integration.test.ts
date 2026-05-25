import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import Header from '@/components/layout/Header.vue';
// NOT mocking useTheme — this is an integration test with the real composable
import * as projectsApi from '@/stores/projects';
import * as conversationsApi from '@/stores/conversations';
import { resetThemeModule } from '@/composables/useTheme';

// Mock the stores but NOT useTheme
vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('@/stores/conversations', () => ({
  useConversationStore: vi.fn(),
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

// Provide a real in-memory localStorage polyfill — happy-dom does not include it
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => Object.hasOwn(store, key) ? store[key] : null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    length: 0,
    keys: () => Object.keys(store),
  },
  writable: true,
});

function createWrapper() {
  const mockProjectStore = createMockProjectStore();
  const mockConvStore = createMockConversationStore();

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

describe('Header integration with real useTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Ensure matchMedia returns light mode preference for tests
    if (typeof window !== 'undefined' && window.matchMedia) {
      const originalMatchMedia = window.matchMedia;
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
        const original = originalMatchMedia.bind(window);
        if (query === '(prefers-color-scheme: dark)') {
          return { matches: false, media: query } as MediaQueryList;
        }
        return original(query);
      });
    }
    // Reset composable module state (module-level singleton)
    resetThemeModule();
    // Clear localStorage between tests
    for (const k in store) delete store[k];
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('theme-dark');
  });

  it('shows moon icon (light mode) by default when system prefers light', async () => {
    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // In default system mode with light system preference, isDark should be false
    // So the sun icon (v-else) should be shown
    const sunIcon = themeButton.find('svg circle'); // sun icon has a circle element
    const moonIcon = themeButton.find('svg path[d*="M21 12.79"]'); // moon icon has the crescent path

    // The theme toggle button's title should reference the target mode ("dark") when in light mode
    expect(themeButton.attributes('title')).toContain('dark');

    // Verify the sun icon (v-else branch) is visible and moon icon (v-if) is not
    // In happy-dom, v-if="false" means the element is not in the DOM at all
    // v-else means it replaces the v-if element
    expect(themeButton.findAll('svg').length).toBe(1);
    const svg = themeButton.find('svg');
    // Sun icon has circle + lines; moon icon has a single path with the crescent
    expect(svg.html()).toContain('M21 12');
    wrapper.unmount();
  });

  it('switches to sun icon when toggled to dark mode', async () => {
    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Initially light (sun icon)
    expect(themeButton.attributes('title')).toContain('dark');

    // Click to toggle to dark
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();

    // Should now show dark mode
    expect(themeButton.attributes('title')).toContain('light');

    // Verify the moon icon is shown now
    expect(themeButton.findAll('svg').length).toBe(1);
    const svg = themeButton.find('svg');
    expect(svg.html()).toContain('circle');

    wrapper.unmount();
  });

  it('switches back to moon icon when toggled from dark to light', async () => {
    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Toggle to dark first
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(themeButton.attributes('title')).toContain('light');

    // Toggle back to light
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();

    // Should be light again
    expect(themeButton.attributes('title')).toContain('dark');
    expect(themeButton.findAll('svg').length).toBe(1);
    const svg = themeButton.find('svg');
    expect(svg.html()).toContain('M21 12.79');

    wrapper.unmount();
  });

  it('respects explicitly set dark mode from localStorage', async () => {
    // Pre-set localStorage to dark mode before mounting
    localStorage.setItem('theme-mode', 'dark');

    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Should show dark mode icon (moon)
    expect(themeButton.attributes('title')).toContain('light');
    expect(themeButton.findAll('svg').length).toBe(1);
    const svg = themeButton.find('svg');
    expect(svg.html()).toContain('circle'); // sun

    wrapper.unmount();
  });

  it('respects explicitly set light mode from localStorage', async () => {
    // Pre-set localStorage to light mode before mounting
    localStorage.setItem('theme-mode', 'light');

    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Should show light mode icon (sun)
    expect(themeButton.attributes('title')).toContain('dark');
    expect(themeButton.findAll('svg').length).toBe(1);
    const svg = themeButton.find('svg');
    expect(svg.html()).toContain('M21 12.79'); // moon

    wrapper.unmount();
  });

  it('toggles correctly from explicit light mode to dark and back', async () => {
    localStorage.setItem('theme-mode', 'light');

    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Start in light
    expect(themeButton.attributes('title')).toContain('dark');

    // Toggle to dark
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(themeButton.attributes('title')).toContain('light');

    // Toggle back to light
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(themeButton.attributes('title')).toContain('dark');

    wrapper.unmount();
  });

  it('toggles correctly from explicit dark mode to light and back', async () => {
    localStorage.setItem('theme-mode', 'dark');

    const { wrapper } = createWrapper();
    const themeButton = wrapper.find('.theme-toggle');

    // Start in dark
    expect(themeButton.attributes('title')).toContain('light');

    // Toggle to light
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(themeButton.attributes('title')).toContain('dark');

    // Toggle back to dark
    await themeButton.trigger('click');
    await wrapper.vm.$nextTick();
    expect(themeButton.attributes('title')).toContain('light');

    wrapper.unmount();
  });
});
