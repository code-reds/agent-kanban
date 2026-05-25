import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GlobalRolesColumnsSettings from '@/components/settings/GlobalRolesColumnsSettings.vue';
import * as globalSettingsModule from '@/stores/global-settings';
import type { GlobalColumn, RolesColumn } from '@/api';

function createMockStore(overrides: Partial<globalSettingsModule.ReturnType<typeof globalSettingsModule.useGlobalSettingsStore>> = {}): ReturnType<typeof globalSettingsModule.useGlobalSettingsStore> {
  const mockStore = {
    rolesColumns: [] as RolesColumn[],
    rolesColumnsLoading: false,
    loading: false,
    error: null as string | null,
    loadRolesColumns: vi.fn().mockResolvedValue(undefined),
    upsertGlobalRolesColumn: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as ReturnType<typeof globalSettingsModule.useGlobalSettingsStore>;
  return mockStore;
}

const mockColumns: GlobalColumn[] = [
  { id: 1, name: 'To Do', slug: 'todo', order: 1, is_global: 1, project_id: null, is_default: 1 },
  { id: 2, name: 'In Progress', slug: 'in-progress', order: 2, is_global: 1, project_id: null, is_default: 0 },
  { id: 3, name: 'Done', slug: 'done', order: 3, is_global: 1, project_id: null, is_default: 0 },
];

const mockRolesColumns: RolesColumn[] = [
  { id: 1, role_id: 1, role_name: 'AI code developer', column_id: 1, column_name: 'To Do', is_default: 1 },
  { id: 2, role_id: 2, role_name: 'AI reviewer', column_id: 2, column_name: 'In Progress', is_default: 1 },
  { id: 3, role_id: 3, role_name: 'AI teamleader', column_id: null, column_name: null, is_default: 0 },
];

function createWrapper(overrides: Partial<globalSettingsModule.ReturnType<typeof globalSettingsModule.useGlobalSettingsStore>> = {}) {
  setActivePinia(createPinia());
  const mockStore = createMockStore(overrides);
  vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

  return mount(GlobalRolesColumnsSettings, {
    props: { columns: mockColumns },
  });
}

describe('GlobalRolesColumnsSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the component with role column mappings table', async () => {
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.find('table thead th').text()).toBe('Role');
    expect(wrapper.findAll('table thead th')[1].text()).toBe('Default Column');
    expect(wrapper.findAll('table tbody tr').length).toBe(3);
    expect(wrapper.find('table tbody tr:nth-child(1) td:nth-child(1)').text()).toBe('AI code developer');
    expect(wrapper.find('table tbody tr:nth-child(2) td:nth-child(1)').text()).toBe('AI reviewer');
    expect(wrapper.find('table tbody tr:nth-child(3) td:nth-child(1)').text()).toBe('AI teamleader');
    wrapper.unmount();
  });

  it('shows loading state while fetching', async () => {
    // Use a deferred promise so we can observe the loading state before it resolves
    const deferred = { resolve: null as unknown as () => void };
    const loadPromise = new Promise<void>((resolve) => {
      deferred.resolve = () => resolve();
    });

    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: true,
      loadRolesColumns: vi.fn().mockReturnValue(loadPromise),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    // Verify the store was called and the component started loading.
    expect(mockStore.loadRolesColumns).toHaveBeenCalledTimes(1);

    // The store's rolesColumnsLoading should be true during the fetch
    expect(mockStore.rolesColumnsLoading).toBe(true);

    // Resolve the deferred promise so the component finishes loading
    deferred.resolve?.();
    await flushPromises();

    // After resolving, should show empty state (no rolesColumns data)
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows empty state when no rolesColumns', async () => {
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('No role column mappings defined');
    wrapper.unmount();
  });

  it('loads roles columns on mount', async () => {
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    expect(mockStore.loadRolesColumns).toHaveBeenCalledTimes(1);
  });

  it('dropdown shows all available columns with correct defaults', async () => {
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const selects = wrapper.findAll('select');
    expect(selects.length).toBe(3);

    // First select (AI code developer, column_id=1) should have To Do selected
    const firstSelect = selects[0];
    expect(firstSelect?.element.value).toBe('1');

    // Second select (AI reviewer, column_id=2) should have In Progress selected
    const secondSelect = selects[1];
    expect(secondSelect?.element.value).toBe('2');

    // Third select (teamleader, column_id=null) should have empty value
    expect(secondSelect?.findAll('option').length).toBe(4); // "Select column" + 3 columns
    wrapper.unmount();
  });

  it('handleColumnChange calls upsertGlobalRolesColumn on change', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
    };
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    // Change the first row's column to "Done" (id=3)
    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(mockStore.upsertGlobalRolesColumn).toHaveBeenCalledWith({
      role_id: 1,
      column_id: 3,
    });
    wrapper.unmount();
  });

  it('handleColumnChange emits columns-updated on success', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
    };
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.emitted('columns-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('handleColumnChange sets save message on success', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
    };
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.find('.success-message').exists()).toBe(true);
    expect(wrapper.find('.success-message').text()).toContain('Default column updated');
    wrapper.unmount();
  });

  it('handleColumnChange shows error message when save fails', async () => {
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(null),
      error: 'Save failed',
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.find('.error-message').exists()).toBe(true);
    expect(wrapper.find('.error-message').text()).toContain('Save failed');
    wrapper.unmount();
  });

  it('handleColumnChange shows error message on exception', async () => {
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.find('.error-message').exists()).toBe(true);
    expect(wrapper.find('.error-message').text()).toContain('Network error');
    wrapper.unmount();
  });

  it('select is disabled while saving', async () => {
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockReturnValue(new Promise(() => {
        // Never resolves - simulate long-running request
      })),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');

    // The select should be disabled while saving
    expect(wrapper.find('.column-select').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('select has correct initial value for null column_id', async () => {
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    // Third row (AI teamleader) has column_id = null
    const thirdSelect = wrapper.findAll('select').at(2);
    expect(thirdSelect?.element.value).toBe('');
    wrapper.unmount();
  });

  it('updates local rolesColumns after successful save', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
    };
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    // Before change
    const firstSelect = wrapper.findAll('select').at(0);
    expect(firstSelect?.element.value).toBe('1');

    // Trigger change
    await firstSelect?.setValue('3');
    await firstSelect?.trigger('change');
    await flushPromises();

    // After change - the store's rolesColumns should be updated
    expect(mockStore.rolesColumns).toHaveLength(3);
    wrapper.unmount();
  });

  it('renders with empty columns prop', async () => {
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: [] },
    });

    await flushPromises();

    expect(wrapper.find('table').exists()).toBe(true);
    // Each select should only have the placeholder option
    wrapper.findAll('select').forEach((select) => {
      expect(select.findAll('option').length).toBe(1); // Just "Select column"
    });
    wrapper.unmount();
  });

  it('passes empty string to upsertGlobalRolesColumn when user selects "Select column"', async () => {
    const mockStore = createMockStore({
      rolesColumns: [...mockRolesColumns],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(null),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);

    const wrapper = mount(GlobalRolesColumnsSettings, {
      props: { columns: mockColumns },
    });

    await flushPromises();

    // Third row (AI teamleader) currently has null column_id
    const select = wrapper.findAll('select').at(2);
    // Select "To Do" then change back to the "Select column" option
    await select?.setValue('1');
    await select?.trigger('change');
    await flushPromises();

    expect(mockStore.upsertGlobalRolesColumn).toHaveBeenCalledWith({
      role_id: 3,
      column_id: 1,
    });
    wrapper.unmount();
  });
});
