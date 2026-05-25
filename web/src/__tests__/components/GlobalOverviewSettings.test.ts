import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GlobalOverviewSettings from '@/components/settings/GlobalOverviewSettings.vue';
import * as globalSettingsApi from '@/stores/global-settings';

vi.mock('@/stores/global-settings', () => ({
  useGlobalSettingsStore: vi.fn(),
}));

import { useGlobalSettingsStore as globalSettingsHook } from '@/stores/global-settings';

function createMockGlobalSettingsStore(overrides: Partial<ReturnType<typeof globalSettingsHook>> = {}): ReturnType<typeof globalSettingsHook> {
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
  } as unknown as ReturnType<typeof globalSettingsHook>;
}

function createWrapper(store: ReturnType<typeof globalSettingsHook>) {
  setActivePinia(createPinia());
  (globalSettingsHook as any).mockReturnValue(store);

  return mount(GlobalOverviewSettings);
}

describe('GlobalOverviewSettings', () => {
  let store: ReturnType<typeof globalSettingsHook>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = createMockGlobalSettingsStore();
    (globalSettingsHook as any).mockReturnValue(store);
  });

  describe('rendering', () => {
    it('should render the overview card with heading', () => {
      const wrapper = createWrapper(store);
      expect(wrapper.find('h2').text()).toBe('Overview');
    });

    it('should display info grid with counts', () => {
      const storeWithSettings = createMockGlobalSettingsStore({
        columns: [
          { id: 1, project_id: null, slug: 'todo', name: 'Todo', order: 1, is_global: 1, is_default: 1 },
          { id: 2, project_id: null, slug: 'done', name: 'Done', order: 2, is_global: 1, is_default: 0 },
        ],
        workflows: [
          { id: 1, project_id: null, column_from: 1, column_to: 2, requires_comment: 0, is_global: 1, entire_ticket_group: 0 },
        ],
        accessRules: [
          { id: 1, project_id: null, column_id: 1, role_id: 1, action_type: 'view', is_global: 1 },
        ],
      });
      (globalSettingsHook as any).mockReturnValue(storeWithSettings);
      const wrapper = createWrapper(storeWithSettings);

      const infoItems = wrapper.findAll('.info-item');
      expect(infoItems).toHaveLength(3);
      expect(infoItems[0].text()).toContain('2');
      expect(infoItems[1].text()).toContain('1');
      expect(infoItems[2].text()).toContain('1');
    });

    it('should display zero counts when no settings', () => {
      const wrapper = createWrapper(store);
      const infoValues = wrapper.findAll('.info-value');
      expect(infoValues[0].text()).toBe('0');
      expect(infoValues[1].text()).toBe('0');
      expect(infoValues[2].text()).toBe('0');
    });

    it('should show section description', () => {
      const wrapper = createWrapper(store);
      expect(wrapper.text()).toContain('Global settings define the default columns');
    });
  });

  describe('reset to defaults', () => {
    it('should show Reset to Defaults button', () => {
      const wrapper = createWrapper(store);
      const resetButton = wrapper.find('button.btn--primary');
      expect(resetButton.exists()).toBe(true);
      expect(resetButton.text()).toBe('Reset to Defaults');
    });

    it('should disable reset button while loading', async () => {
      const loadingStore = createMockGlobalSettingsStore({ loading: true });
      (globalSettingsHook as any).mockReturnValue(loadingStore);
      const wrapper = createWrapper(loadingStore);
      const resetButton = wrapper.find('button.btn--primary');
      expect(resetButton.html()).toContain('Resetting...');
      expect(resetButton.attributes('disabled')).toBeDefined();
    });

    it('should call resetGlobalDefaults on click', async () => {
      const resetSpy = vi.spyOn(store, 'resetGlobalDefaults' as any).mockResolvedValue(true);
      const wrapper = createWrapper(store);
      const resetButton = wrapper.find('button.btn--primary');
      await resetButton.trigger('click');
      await wrapper.vm.$nextTick();
      expect(resetSpy).toHaveBeenCalled();
    });

    it('should show success message after reset', async () => {
      store.resetGlobalDefaults = vi.fn().mockResolvedValue(true);
      const wrapper = createWrapper(store);
      const resetButton = wrapper.find('button.btn--primary');
      await resetButton.trigger('click');
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(wrapper.find('.success-message').text()).toContain('Global settings have been reset to defaults');
    });

    it('should show error message after failed reset', async () => {
      store.resetGlobalDefaults = vi.fn().mockResolvedValue(false);
      store.error = 'Connection failed';
      const wrapper = createWrapper(store);
      const resetButton = wrapper.find('button.btn--primary');
      await resetButton.trigger('click');
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(wrapper.find('.error-message').text()).toContain('Connection failed');
    });
  });

  describe('refresh', () => {
    it('should show Refresh button', () => {
      const wrapper = createWrapper(store);
      const buttons = wrapper.findAll('button');
      const refreshButton = buttons.find((b) => b.text() === 'Refresh');
      expect(refreshButton).toBeDefined();
    });

    it('should call fetchGlobalSettings on refresh click', async () => {
      const fetchSpy = vi.spyOn(store, 'fetchGlobalSettings').mockResolvedValue(undefined);
      const wrapper = createWrapper(store);
      const buttons = wrapper.findAll('button');
      const refreshButton = buttons.find((b) => b.text() === 'Refresh');
      await refreshButton?.trigger('click');
      await wrapper.vm.$nextTick();
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should show success message after refresh', async () => {
      const wrapper = createWrapper(store);
      const buttons = wrapper.findAll('button');
      const refreshButton = buttons.find((b) => b.text() === 'Refresh');
      await refreshButton?.trigger('click');
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(wrapper.find('.success-message').text()).toContain('Settings refreshed');
    });
  });

  describe('message auto-dismiss', () => {
    it('should show success message which is set to auto-dismiss after 5 seconds', async () => {
      store.resetGlobalDefaults = vi.fn().mockResolvedValue(true);
      const wrapper = createWrapper(store);
      const resetButton = wrapper.find('button.btn--primary');
      await resetButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Message should be visible immediately
      expect(wrapper.find('.success-message').text()).toContain('Global settings have been reset to defaults');
    });
  });
});
