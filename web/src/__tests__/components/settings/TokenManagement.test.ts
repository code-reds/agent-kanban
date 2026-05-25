import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory, useRoute } from 'vue-router';
import { nextTick } from 'vue';
import TokenManagement from '@/components/settings/TokenManagement.vue';
import * as projectApi from '@/stores/projects';

vi.mock('@/api', () => ({
  getTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  getRoles: vi.fn(),
  getRolePlaintextToken: vi.fn(),
  generateOpencodeConfig: vi.fn(),
}));

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: vi.fn(),
    useRouter: vi.fn(),
  };
});

import { useRoute as vueRouterUseRoute } from 'vue-router';
import * as api from '@/api';

function createMockProjectStore(overrides: Partial<projectApi.ProjectStore> = {}): projectApi.ProjectStore {
  const mockStore = {
    loading: false,
    ...overrides,
  } as projectApi.ProjectStore;
  return mockStore;
}

function createWrapper({ routeSlug = 'test-project' }: { routeSlug?: string } = {}) {
  const mockProjectStore = createMockProjectStore();

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/projects/:slug/settings', name: 'settings', component: { template: '<div/>' } },
    ],
  });

  setActivePinia(createPinia());
  (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);
  (vueRouterUseRoute as any).mockReturnValue({ params: { slug: routeSlug } });

  return {
    wrapper: mount(TokenManagement, {
      global: {
        plugins: [router],
      },
    }),
    router,
  };
}

describe('TokenManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('OpenCode config expose function', () => {
    it('exposes generateOpencodeConfig via defineExpose', () => {
      const { wrapper } = createWrapper();
      // The generateOpencodeConfig function should be exposed
      const exposed = (wrapper.vm as any).generateOpencodeConfig;
      expect(exposed).toBeDefined();
      expect(typeof exposed).toBe('function');
      wrapper.unmount();
    });

    it('generateOpencodeConfig calls the API and returns data', async () => {
      (api.generateOpencodeConfig as any).mockResolvedValue({
        success: true,
        data: { connections: [] },
      });

      const { wrapper } = createWrapper();
      const result = await (wrapper.vm as any).generateOpencodeConfig({
        host: 'localhost',
        port: 3001,
      });

      expect(api.generateOpencodeConfig).toHaveBeenCalledWith(
        'test-project',
        { serverPort: 3001, serverHost: 'localhost' }
      );
      expect(result).toEqual({ connections: [] });
      wrapper.unmount();
    });

    it('generateOpencodeConfig handles API errors gracefully', async () => {
      (api.generateOpencodeConfig as any).mockRejectedValue(new Error('API error'));

      const { wrapper } = createWrapper();
      const result = await (wrapper.vm as any).generateOpencodeConfig({
        host: 'localhost',
        port: 3001,
      });

      expect(result).toBeNull();
      wrapper.unmount();
    });

    it('uses the correct project slug from route params', async () => {
      (api.generateOpencodeConfig as any).mockResolvedValue({
        success: true,
        data: { connections: [] },
      });

      const { wrapper } = createWrapper({ routeSlug: 'my-project' });
      await (wrapper.vm as any).generateOpencodeConfig({
        host: 'localhost',
        port: 3001,
      });

      expect(api.generateOpencodeConfig).toHaveBeenCalledWith(
        'my-project',
        { serverPort: 3001, serverHost: 'localhost' }
      );
      wrapper.unmount();
    });
  });
});
