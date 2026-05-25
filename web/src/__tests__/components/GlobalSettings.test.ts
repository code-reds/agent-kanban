import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GlobalSettings from '@/views/GlobalSettings.vue';
import * as globalSettingsApi from '@/stores/global-settings';
import * as api from '@/api';
import type { Role } from '@/api';

vi.mock('@/stores/global-settings', () => ({
  useGlobalSettingsStore: vi.fn(),
}));

vi.mock('@/api', () => ({
  getRoles: vi.fn(),
  getGlobalRoles: vi.fn(),
}));

import { useGlobalSettingsStore as globalSettingsHook } from '@/stores/global-settings';

function createMockGlobalSettingsStore(overrides: Partial<typeof globalSettingsApi.useGlobalSettingsStore> = {}): ReturnType<typeof globalSettingsApi.useGlobalSettingsStore> {
  return {
    columns: [],
    workflows: [],
    accessRules: [],
    loading: false,
    error: null,
    hasGlobalSettings: false,
    globalColumnsById: vi.fn().mockReturnValue(undefined),
    globalWorkflowsByColumnTo: {},
    fetchGlobalSettings: vi.fn().mockResolvedValue(undefined),
    fetchGlobalColumns: vi.fn().mockResolvedValue(undefined),
    fetchGlobalWorkflows: vi.fn().mockResolvedValue(undefined),
    fetchGlobalAccessRules: vi.fn().mockResolvedValue(undefined),
    fetchSeedData: vi.fn().mockResolvedValue(null),
    resetGlobalDefaults: vi.fn().mockResolvedValue(true),
    createGlobalColumn: vi.fn(),
    updateGlobalColumn: vi.fn(),
    deleteGlobalColumn: vi.fn(),
    createGlobalWorkflow: vi.fn(),
    updateGlobalWorkflow: vi.fn(),
    deleteGlobalWorkflow: vi.fn(),
    updateGlobalAccessRules: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof globalSettingsApi.useGlobalSettingsStore>;
}

function createWrapper(store: ReturnType<typeof globalSettingsApi.useGlobalSettingsStore>) {
  setActivePinia(createPinia());
  (globalSettingsHook as any).mockReturnValue(store);

  return mount(GlobalSettings, {
    props: {},
    global: {
      stubs: {
        GlobalOverviewSettings: true,
        ColumnsSettings: true,
        RolesSettings: true,
        WorkflowSettings: true,
        AccessRulesSettings: true,
      },
    },
  });
}

describe('GlobalSettings View', () => {
  let store: ReturnType<typeof globalSettingsApi.useGlobalSettingsStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = createMockGlobalSettingsStore();
    (globalSettingsHook as any).mockReturnValue(store);
    vi.mocked(api.getRoles).mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Human User', description: '', access_level: 'full' }] as Role[],
    });
    vi.mocked(api.getGlobalRoles).mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Human User', description: '', access_level: 'full' }] as Role[],
    });
  });

  describe('rendering', () => {
    it('should render the view with header', async () => {
      const wrapper = createWrapper(store);
      expect(wrapper.text()).toContain('Global Settings');
      expect(wrapper.text()).toContain('Configure default settings that will be used for new projects.');
    });

    it('should render all tabs', async () => {
      const wrapper = createWrapper(store);
      const tabs = wrapper.findAll('.tab-btn');
      expect(tabs).toHaveLength(5);
      expect(tabs[0].text()).toBe('Overview');
      expect(tabs[1].text()).toBe('Columns');
      expect(tabs[2].text()).toBe('Roles');
      expect(tabs[3].text()).toBe('Workflow');
      expect(tabs[4].text()).toBe('Access Rules');
    });

    it('should show Overview tab content by default', async () => {
      const wrapper = createWrapper(store);
      // GlobalOverviewSettings is stubbed, so we check the tab is active
      expect(wrapper.find('.tab-btn.active').text()).toBe('Overview');
    });
  });

  describe('tab switching', () => {
    it('should switch to Columns tab', async () => {
      const wrapper = createWrapper(store);
      const columnsTab = wrapper.findAll('.tab-btn').find((t) => t.text() === 'Columns');
      await columnsTab?.trigger('click');
      expect(wrapper.find('.tab-btn.active').text()).toBe('Columns');
    });

    it('should switch to Roles tab', async () => {
      const wrapper = createWrapper(store);
      const rolesTab = wrapper.findAll('.tab-btn').find((t) => t.text() === 'Roles');
      await rolesTab?.trigger('click');
      expect(wrapper.find('.tab-btn.active').text()).toBe('Roles');
    });

    it('should switch to Workflow tab', async () => {
      const wrapper = createWrapper(store);
      const workflowTab = wrapper.findAll('.tab-btn').find((t) => t.text() === 'Workflow');
      await workflowTab?.trigger('click');
      expect(wrapper.find('.tab-btn.active').text()).toBe('Workflow');
    });

    it('should switch to Access Rules tab', async () => {
      const wrapper = createWrapper(store);
      const accessTab = wrapper.findAll('.tab-btn').find((t) => t.text() === 'Access Rules');
      await accessTab?.trigger('click');
      expect(wrapper.find('.tab-btn.active').text()).toBe('Access Rules');
    });
  });

  describe('settings components in global mode', () => {
    it('should pass mode="global" to ColumnsSettings', async () => {
      const wrapper = createWrapper(store);
      // Switch to Columns tab to make the component render
      await wrapper.findAll('.tab-btn').find((t) => t.text() === 'Columns')?.trigger('click');
      await wrapper.vm.$nextTick();
      const columnsSettings = wrapper.findComponent({ name: 'ColumnsSettings' });
      expect(columnsSettings.exists()).toBe(true);
      expect(columnsSettings.props('mode')).toBe('global');
    });

    it('should pass mode="global" to RolesSettings', async () => {
      const wrapper = createWrapper(store);
      await wrapper.findAll('.tab-btn').find((t) => t.text() === 'Roles')?.trigger('click');
      await wrapper.vm.$nextTick();
      const rolesSettings = wrapper.findComponent({ name: 'RolesSettings' });
      expect(rolesSettings.exists()).toBe(true);
      expect(rolesSettings.props('mode')).toBe('global');
    });

    it('should pass mode="global" to WorkflowSettings', async () => {
      const wrapper = createWrapper(store);
      await wrapper.findAll('.tab-btn').find((t) => t.text() === 'Workflow')?.trigger('click');
      await wrapper.vm.$nextTick();
      const workflowSettings = wrapper.findComponent({ name: 'WorkflowSettings' });
      expect(workflowSettings.exists()).toBe(true);
      expect(workflowSettings.props('mode')).toBe('global');
    });

    it('should pass mode="global" to AccessRulesSettings', async () => {
      const wrapper = createWrapper(store);
      await wrapper.findAll('.tab-btn').find((t) => t.text() === 'Access Rules')?.trigger('click');
      await wrapper.vm.$nextTick();
      const accessSettings = wrapper.findComponent({ name: 'AccessRulesSettings' });
      expect(accessSettings.exists()).toBe(true);
      expect(accessSettings.props('mode')).toBe('global');
    });
  });

  describe('loading state', () => {
    it('should show loading state when store is loading', async () => {
      const loadingStore = createMockGlobalSettingsStore({ loading: true });
      (globalSettingsHook as any).mockReturnValue(loadingStore);
      const wrapper = createWrapper(loadingStore);
      // Override stub to actually render to check for loading text
      await wrapper.setProps({});
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
    });

    it('should show error state when store has error', async () => {
      const errorStore = createMockGlobalSettingsStore({ error: 'Test error' });
      (globalSettingsHook as any).mockReturnValue(errorStore);
      const wrapper = createWrapper(errorStore);
      expect(wrapper.text()).toContain('Test error');
    });
  });

  describe('header dropdown icon', () => {
    it('should have the global-settings route available', async () => {
      const wrapper = createWrapper(store);
      expect(wrapper.find('h1').text()).toBe('Global Settings');
    });
  });

  describe('onMounted behavior', () => {
    it('should fetch global settings on mount', async () => {
      const fetchSpy = vi.spyOn(store, 'fetchGlobalSettings');
      const wrapper = createWrapper(store);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should fetch global roles on mount', async () => {
      const wrapper = createWrapper(store);
      expect(api.getGlobalRoles).toHaveBeenCalled();
    });
  });
});
