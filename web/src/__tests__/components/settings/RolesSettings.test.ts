import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import RolesSettings from '@/components/settings/RolesSettings.vue';
import * as globalSettingsModule from '@/stores/global-settings';
import * as apiModule from '@/api';
import type { Column, RolesColumn, Role } from '@/api';

function createMockStore(overrides: Partial<globalSettingsModule.ReturnType<typeof globalSettingsModule.useGlobalSettingsStore>> = {}): ReturnType<typeof globalSettingsModule.useGlobalSettingsStore> {
  const mockStore = {
    rolesColumns: [] as RolesColumn[],
    rolesColumnsLoading: false,
    projectRolesColumns: [] as RolesColumn[],
    projectRolesColumnsLoading: false,
    loading: false,
    error: null as string | null,
    loadProjectRolesColumns: vi.fn().mockResolvedValue(undefined),
    upsertProjectRolesColumn: vi.fn().mockResolvedValue(null),
    deleteProjectRolesColumn: vi.fn().mockResolvedValue(false),
    loadRolesColumns: vi.fn().mockResolvedValue(undefined),
    upsertGlobalRolesColumn: vi.fn().mockResolvedValue(null),
    deleteGlobalRolesColumn: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as ReturnType<typeof globalSettingsModule.useGlobalSettingsStore>;
  return mockStore;
}

const mockColumns: Column[] = [
  { id: 1, name: 'To Do', slug: 'todo', order: 1, is_default: 1, project_id: 1 },
  { id: 2, name: 'In Progress', slug: 'in-progress', order: 2, is_default: 0, project_id: 1 },
  { id: 3, name: 'Done', slug: 'done', order: 3, is_default: 0, project_id: 1 },
];

const mockRoles: Role[] = [
  { id: 1, name: 'AI code developer', description: 'Develops code' },
  { id: 2, name: 'AI reviewer', description: 'Reviews code' },
  { id: 3, name: 'AI teamleader', description: 'Manages team' },
];

describe('RolesSettings (project mode)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders roles table with all headers including Default Column in project mode', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const headers = wrapper.findAll('table thead th');
    const headerTexts = headers.map(h => h.text());
    expect(headerTexts).toContain('Default Column');
    expect(headerTexts).toContain('Name');
    expect(headerTexts).toContain('Description');
    expect(headerTexts).toContain('Actions');
    expect(headerTexts.length).toBe(4);
    expect(wrapper.find('table tbody tr').exists()).toBe(true);
    expect(wrapper.findAll('table tbody tr').length).toBe(3);
    wrapper.unmount();
  });

  it('does not render Add Role form in project mode', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    expect(wrapper.findComponent({ name: 'AddRoleForm' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not render Edit and Delete buttons in project mode', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        userRole: mockRoles[0],
      },
    });

    await flushPromises();

    const buttons = wrapper.findAll('table tbody button');
    const buttonTexts = buttons.map(b => b.text());
    expect(buttonTexts).not.toContain('Edit');
    expect(buttonTexts).not.toContain('Delete');
    expect(buttonTexts).not.toContain('Reset to global');
    wrapper.unmount();
  });

  it('renders column dropdowns for each role in project mode', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const selects = wrapper.findAll('select');
    expect(selects.length).toBe(3);

    // Each select should have "Select column" + "None" + 3 column options
    selects.forEach((select) => {
      expect(select.findAll('option').length).toBe(5); // placeholder + None + 3 columns
    });
    wrapper.unmount();
  });

  it('dropdown selects correct column when project-specific mapping exists', async () => {
    const mockRolesColumns: RolesColumn[] = [
      { id: 1, role_id: 1, role_name: 'AI code developer', column_id: 2, column_name: 'In Progress', is_default: 1, is_override: 1 },
    ];
    const mockStore = createMockStore({
      projectRolesColumns: mockRolesColumns,
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const selects = wrapper.findAll('select');
    // First row should have column_id=2 (In Progress) selected
    expect(selects[0]?.element.value).toBe('2');
    // Second and third rows: "None" option should be preselected (no project-specific mapping)
    expect(selects[1]?.element.value).toBe('__none__');
    expect(selects[2]?.element.value).toBe('__none__');
    wrapper.unmount();
  });

  it('highlights rows with project-specific overrides', async () => {
    const mockRolesColumns: RolesColumn[] = [
      { id: 1, role_id: 1, role_name: 'AI code developer', column_id: 2, column_name: 'In Progress', is_default: 1, is_override: 1 },
    ];
    const mockStore = createMockStore({
      projectRolesColumns: mockRolesColumns,
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const rows = wrapper.findAll('table tbody tr');
    expect(rows[0].classes()).toContain('row-overridden');
    expect(rows[1].classes()).not.toContain('row-overridden');
    expect(rows[2].classes()).not.toContain('row-overridden');
    wrapper.unmount();
  });

  it('handleColumnChange calls upsertProjectRolesColumn on change', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
      is_override: 1,
    };
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(mockStore.upsertProjectRolesColumn).toHaveBeenCalledWith('test-project', {
      role_id: 1,
      column_id: 3,
    });
    wrapper.unmount();
  });

  it('handleColumnChange emits roles-updated on success', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
      is_override: 1,
    };
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.emitted('roles-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('handleColumnChange shows success message on save', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
      is_override: 1,
    };
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
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
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockResolvedValue(null),
      error: 'Save failed',
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
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
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
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
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockReturnValue(new Promise(() => {
        // Never resolves - simulate long-running request
      })),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');

    expect(wrapper.find('.column-select').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('select becomes disabled while saving and re-enabled after', async () => {
    let resolveSave: () => void = () => {};
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
      ),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    // Should be disabled while saving
    expect(select?.attributes('disabled')).toBeDefined();

    // Resolve the save
    resolveSave();
    await flushPromises();

    // Should no longer be disabled
    expect(select?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('loads project roles columns on mount', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    expect(mockStore.loadProjectRolesColumns).toHaveBeenCalledWith('test-project');
  });

  it('shows None option in dropdown for roles without a default column', async () => {
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    // Check that the None option exists
    const selects = wrapper.findAll('select');
    selects.forEach((select) => {
      const options = select.findAll('option');
      const optionTexts = options.map(o => o.text());
      expect(optionTexts).toContain('None');
      expect(optionTexts).toContain('Select column');
      expect(optionTexts).toContain('To Do');
      expect(optionTexts).toContain('In Progress');
      expect(optionTexts).toContain('Done');
    });
    wrapper.unmount();
  });

  it('handleColumnChange sends column_id=null when None is selected (project mode)', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: null,
      column_name: null,
      is_default: 0,
      is_override: 0,
    };
    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('__none__');
    await select?.trigger('change');
    await flushPromises();

    expect(mockStore.upsertProjectRolesColumn).toHaveBeenCalledWith('test-project', {
      role_id: 1,
      column_id: null,
    });
    wrapper.unmount();
  });

  it('shows loading state while loading', async () => {
    const deferred = { resolve: null as unknown as () => void };
    const loadPromise = new Promise<void>((resolve) => {
      deferred.resolve = () => resolve();
    });

    const mockStore = createMockStore({
      projectRolesColumns: [],
      projectRolesColumnsLoading: true,
      loadProjectRolesColumns: vi.fn().mockReturnValue(loadPromise),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();
    expect(wrapper.find('.loading-state').exists()).toBe(true);

    deferred.resolve?.();
    await flushPromises();
    wrapper.unmount();
  });

  it('updates local projectRolesColumns after successful save', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
      is_override: 1,
    };
    // Use a shared array so both mock and store see updates
    const sharedProjectRolesColumns: RolesColumn[] = [];
    const mockStore = createMockStore({
      projectRolesColumns: sharedProjectRolesColumns,
      projectRolesColumnsLoading: false,
      upsertProjectRolesColumn: vi.fn().mockImplementation(async (slug: string, data: { role_id: number; column_id: number | null }) => {
        // Simulate the store's internal array update logic
        const idx = sharedProjectRolesColumns.findIndex((r) => r.role_id === data.role_id);
        if (idx !== -1) {
          sharedProjectRolesColumns[idx] = { ...updatedMapping, column_id: data.column_id };
        } else {
          sharedProjectRolesColumns.push({ ...updatedMapping, column_id: data.column_id });
        }
        return { ...updatedMapping, column_id: data.column_id };
      }),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'project',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    // Before change - select shows "None" option (no column set yet)
    const firstSelect = wrapper.findAll('select').at(0);
    expect(firstSelect?.element.value).toBe('__none__');

    // Trigger change
    await firstSelect?.setValue('3');
    await firstSelect?.trigger('change');
    await flushPromises();

    // After change - store's projectRolesColumns should be updated
    expect(sharedProjectRolesColumns).toHaveLength(1);
    expect(sharedProjectRolesColumns[0].column_id).toBe(3);
    wrapper.unmount();
  });
});

describe('RolesSettings (global mode)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders roles table with Default Column header in global mode', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
      },
    });

    await flushPromises();

    const headers = wrapper.findAll('table thead th');
    const headerTexts = headers.map(h => h.text());
    expect(headerTexts).toContain('Default Column');
    // Global mode: Name, Description, Default Column, Actions = 4 columns
    expect(headerTexts.length).toBe(4);
    wrapper.unmount();
  });

  it('renders Add Role form in global mode', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: { id: 1, name: 'Human User' },
      },
    });

    await flushPromises();

    expect(wrapper.findComponent({ name: 'AddRoleForm' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('does not render Add Role form in global mode for non-admin users', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: { id: 2, name: 'AI reviewer' },
      },
    });

    await flushPromises();

    expect(wrapper.findComponent({ name: 'AddRoleForm' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders Edit and Delete buttons in global mode', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: { id: 1, name: 'Human User' },
      },
    });

    await flushPromises();

    const buttons = wrapper.findAll('table tbody button');
    const buttonTexts = buttons.map(b => b.text());
    expect(buttonTexts).toContain('Edit');
    expect(buttonTexts).toContain('Delete');
    wrapper.unmount();
  });

  it('renders column dropdowns for each role in global mode', async () => {
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const selects = wrapper.findAll('select');
    expect(selects.length).toBe(3);
    wrapper.unmount();
  });

  it('dropdown selects correct column when global mapping exists', async () => {
    const mockRolesColumns: RolesColumn[] = [
      { id: 1, role_id: 1, role_name: 'AI code developer', column_id: 2, column_name: 'In Progress', is_default: 1, is_override: 0 },
    ];
    const mockStore = createMockStore({
      rolesColumns: mockRolesColumns,
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const selects = wrapper.findAll('select');
    // First row should have column_id=2 (In Progress) selected
    expect(selects[0]?.element.value).toBe('2');
    // Other rows: "None" option should be preselected (no global mapping)
    expect(selects[1]?.element.value).toBe('__none__');
    expect(selects[2]?.element.value).toBe('__none__');
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
      is_override: 0,
    };
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

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

  it('handleColumnChange emits roles-updated on success (global mode)', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: 3,
      column_name: 'Done',
      is_default: 1,
      is_override: 0,
    };
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('3');
    await select?.trigger('change');
    await flushPromises();

    expect(wrapper.emitted('roles-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('handles role editing in global mode', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: mockRoles[0],
      },
    });

    await flushPromises();

    // Click Edit button on first role
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Should show name and description inputs
    expect(wrapper.find('#role-name-edit').exists()).toBe(true);
    expect(wrapper.find('.cell-input--wide').exists()).toBe(true);
    expect(wrapper.find('.save-btn').exists()).toBe(true);
    expect(wrapper.find('.cancel-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('cancels role editing', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
      },
    });

    await flushPromises();

    // Start editing
    wrapper.find('.edit-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('#role-name-edit').exists()).toBe(true);

    // Cancel
    wrapper.find('.cancel-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('#role-name-edit').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows Delete confirmation modal in global mode', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: { id: 1, name: 'Human User' },
      },
    });

    await flushPromises();

    // Click Delete button on second role (role id=1 is protected)
    const deleteBtn = wrapper.findAll('.delete-btn').at(0);
    await deleteBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.find('.modal-overlay h2').text()).toContain('Confirm Deletion');
    wrapper.unmount();
  });

  it('does not show Delete button for role id=1 (protected role)', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        userRole: { id: 1, name: 'Human User' },
      },
    });

    await flushPromises();

    const deleteBtns = wrapper.findAll('.delete-btn');
    expect(deleteBtns.length).toBe(2); // roles 2 and 3, not role 1
    wrapper.unmount();
  });

  it('shows empty state when no roles', async () => {
    const mockStore = createMockStore();
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: [] });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
      },
    });

    await flushPromises();

    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('No roles defined');
    wrapper.unmount();
  });

  it('shows loading state while loading', async () => {
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
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
      },
    });

    await flushPromises();
    expect(wrapper.find('.loading-state').exists()).toBe(true);

    deferred.resolve?.();
    await flushPromises();
    wrapper.unmount();
  });

  it('loads global roles columns on mount', async () => {
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
      },
    });

    await flushPromises();

    expect(mockStore.loadRolesColumns).toHaveBeenCalled();
    expect(mockStore.loadProjectRolesColumns).not.toHaveBeenCalled();
  });

  it('handleColumnChange sends column_id=null when None is selected (global mode)', async () => {
    const updatedMapping: RolesColumn = {
      id: 1,
      role_id: 1,
      role_name: 'AI code developer',
      column_id: null,
      column_name: null,
      is_default: 0,
      is_override: 0,
    };
    const mockStore = createMockStore({
      rolesColumns: [],
      rolesColumnsLoading: false,
      upsertGlobalRolesColumn: vi.fn().mockResolvedValue(updatedMapping),
    });
    vi.spyOn(globalSettingsModule, 'useGlobalSettingsStore').mockReturnValue(mockStore);
    vi.spyOn(apiModule, 'getGlobalRoles').mockResolvedValue({ success: true, data: mockRoles });

    const wrapper = mount(RolesSettings, {
      props: {
        mode: 'global',
        projectSlug: 'test-project',
        columns: mockColumns,
      },
    });

    await flushPromises();

    const select = wrapper.findAll('select').at(0);
    await select?.setValue('__none__');
    await select?.trigger('change');
    await flushPromises();

    expect(mockStore.upsertGlobalRolesColumn).toHaveBeenCalledWith({
      role_id: 1,
      column_id: null,
    });
    wrapper.unmount();
  });
});
