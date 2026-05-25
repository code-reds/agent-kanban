import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory, useRoute, useRouter } from 'vue-router';
import { nextTick } from 'vue';
import Settings from '@/views/Settings.vue';
import * as projectApi from '@/stores/projects';

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('@/api', () => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  createTransition: vi.fn(),
  deleteTransition: vi.fn(),
  getRoles: vi.fn(),
  updateRole: vi.fn(),
  getAccessRules: vi.fn(),
  updateAccessRules: vi.fn(),
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
  let currentProjectValue: projectApi.ProjectWithRelations | null = overrides.currentProject || null;
  const setCurrentProject = vi.fn().mockImplementation(async (_slug: string) => {
    if (overrides.currentProject) {
      currentProjectValue = overrides.currentProject;
    }
    return true;
  });
  const { currentProject: _cp, ...rest } = overrides;
  const mockStore = {
    projects: [],
    loading: false,
    error: null,
    fetchProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    addColumn: vi.fn(),
    currentProjectById: vi.fn(),
    get currentProject() { return currentProjectValue; },
    set currentProject(val: projectApi.ProjectWithRelations | null) { currentProjectValue = val; },
    setCurrentProject: setCurrentProject,
    ...rest,
  } as projectApi.ProjectStore;
  return mockStore;
}

function createWrapper({
  projectStore,
  routeSlug,
}: {
  projectStore?: projectApi.ProjectStore;
  routeSlug?: string;
} = {}) {
  const mockProjectStore = projectStore || createMockProjectStore();

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/projects/:slug/settings', name: 'settings', component: { template: '<div/>' } }],
  });

  setActivePinia(createPinia());

  (vueRouterUseRoute as any).mockReturnValue({ params: { slug: routeSlug || 'test-project' } });
  (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);

  return {
    wrapper: mount(Settings, {
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
    mockProjectStore,
    router,
  };
}

describe('Settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the settings heading', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Project Settings');
    wrapper.unmount();
  });

  it('renders all five tabs', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Overview');
    expect(wrapper.text()).toContain('Columns');
    expect(wrapper.text()).toContain('Roles');
    expect(wrapper.text()).toContain('Workflow');
    expect(wrapper.text()).toContain('Access Rules');
    wrapper.unmount();
  });

  it('shows overview tab content by default', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.settings-content .card').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows project information in overview tab', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test Project', slug: 'test', description: 'A test project',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    expect(wrapper.text()).toContain('Test Project');
    expect(wrapper.text()).toContain('A test project');
    expect(wrapper.text()).toContain('test');
    wrapper.unmount();
  });

  it('shows danger zone with delete button', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.danger-zone').exists()).toBe(true);
    expect(wrapper.find('.danger-btn').text()).toContain('Delete Project');
    wrapper.unmount();
  });

  it('opens delete confirmation modal when delete button clicked', async () => {
    const { wrapper } = createWrapper();
    const deleteBtn = wrapper.find('.danger-btn');
    await deleteBtn.trigger('click');
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.find('.modal p').text()).toContain('Are you sure');
    wrapper.unmount();
  });

  it('closes delete modal with cancel button', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.danger-btn').trigger('click');
    const cancelBtn = wrapper.find('.modal .cancel-btn');
    await cancelBtn.trigger('click');
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches to columns tab', async () => {
    const { wrapper } = createWrapper();
    const columnsTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns');
    await columnsTab?.trigger('click');
    expect(wrapper.find('.add-column-form').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders column form with name, slug, and position inputs', async () => {
    const { wrapper } = createWrapper();
    await wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns')?.trigger('click');
    expect(wrapper.find('#column-name').exists()).toBe(true);
    expect(wrapper.find('#column-slug').exists()).toBe(true);
    expect(wrapper.find('#column-position').exists()).toBe(true);
    expect(wrapper.find('#add-column-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders roles tab with roles table', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [{ id: 1, name: 'Admin', access_level: 'admin', description: 'Administrator' }] });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Admin', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    await nextTick();
    const rolesBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Roles');
    if (rolesBtn) {
      await rolesBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.card h2').text()).toContain('Roles');
    expect(wrapper.find('table thead th').exists()).toBe(true);
    wrapper.unmount();
  });

 it('shows empty state when no roles', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [] });

    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    await nextTick();
    const rolesBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Roles');
    if (rolesBtn) {
      await rolesBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows editing mode for project name', async () => {
    const { wrapper } = createWrapper();
    const editBtn = wrapper.find('.edit-btn');
    expect(editBtn.exists()).toBe(true);
    await editBtn.trigger('click');
    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.find('.save-btn').exists()).toBe(true);
    expect(wrapper.find('.cancel-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows editing mode for project description', async () => {
    const { wrapper } = createWrapper();
    const editBtns = wrapper.findAll('.edit-btn');
    if (editBtns.length > 1) {
      await editBtns[1].trigger('click');
    } else {
      await editBtns[0].trigger('click');
    }
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('.save-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('cancels edit mode for description', async () => {
    const { wrapper } = createWrapper();
    const editBtns = wrapper.findAll('.edit-btn');
    if (editBtns.length > 1) {
      await editBtns[1].trigger('click');
    }
    const cancelBtn = wrapper.find('.cancel-btn');
    if (cancelBtn.exists()) {
      await cancelBtn.trigger('click');
    }
    expect(wrapper.find('textarea[disabled]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('cancels edit mode for project name', async () => {
    const { wrapper } = createWrapper();
    const editBtn = wrapper.find('.edit-btn');
    await editBtn.trigger('click');
    const cancelBtn = wrapper.find('.cancel-btn');
    await cancelBtn.trigger('click');
    expect(wrapper.find('input[disabled]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches to workflow tab', async () => {
    const { wrapper } = createWrapper();
    await wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow')?.trigger('click');
    expect(wrapper.find('.card h2').text()).toContain('Workflow Transitions');
    wrapper.unmount();
  });

  it('displays slug in slug-display class', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'my-project', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    expect(wrapper.find('.slug-display').text()).toBe('my-project');
    wrapper.unmount();
  });

  it('shows columns table with columns when columns exist', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const columnsTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns');
    if (columnsTab) {
      await columnsTab.trigger('click');
    }
    await nextTick();
    const rows = wrapper.findAll('table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Todo');
    expect(rows[1].text()).toContain('Done');
    wrapper.unmount();
  });

  it('has settings-view class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.settings-view').exists()).toBe(true);
    wrapper.unmount();
  });

  it('calls startEditColumn when edit button clicked', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const columnsTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns');
    if (columnsTab) {
      await columnsTab.trigger('click');
    }
    await nextTick();
    const editBtn = wrapper.findAll('.edit-btn');
    if (editBtn.length > 0) {
      await editBtn[0].trigger('click');
    }
    await flushPromises();
    const cellInputs = wrapper.findAll('.cell-input');
    expect(cellInputs.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('calls cancelEditColumn when cancel button clicked', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const columnsTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns');
    if (columnsTab) {
      await columnsTab.trigger('click');
    }
    await nextTick();
    const editBtn = wrapper.findAll('.edit-btn');
    if (editBtn.length > 0) {
      await editBtn[0].trigger('click');
    }
    await flushPromises();
    const cancelBtn = wrapper.find('.cancel-btn');
    if (cancelBtn.exists()) {
      await cancelBtn.trigger('click');
    }
    await flushPromises();
    const cellInputs = wrapper.findAll('.cell-input');
    expect(cellInputs.length).toBe(0);
    wrapper.unmount();
  });

  it('switches to access-rules tab', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
        ],
        roles: [
          { id: 1, name: 'Admin', access_level: 'admin' },
          { id: 2, name: 'Developer', access_level: 'developer' },
        ],
        workflows: [], access_rules: [],
      },
    });
    (api.getAccessRules as any).mockResolvedValue({ success: true, data: [] });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const accessRulesTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Access Rules');
    if (accessRulesTab) {
      await accessRulesTab.trigger('click');
    }
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.empty-state').text()).toContain('No access rules defined');
    wrapper.unmount();
  });

  it('toggles access rule checkbox when clicked', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
        ],
        roles: [
          { id: 1, name: 'Admin', access_level: 'admin' },
        ],
        workflows: [], access_rules: [],
      },
    });
    (api.getAccessRules as any).mockResolvedValue({ success: true, data: [] });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const accessRulesTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Access Rules');
    if (accessRulesTab) {
      await accessRulesTab.trigger('click');
    }
    await flushPromises();
    await nextTick();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      await checkboxes[0].trigger('change');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('shows delete transition modal when delete button clicked', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [],
        workflows: [
          { id: 1, column_from: 1, column_to: 2, project_id: 1, requires_comment: false },
        ],
        access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowTab) {
      await workflowTab.trigger('click');
    }
    await nextTick();
    const deleteBtn = wrapper.findAll('.delete-btn');
    if (deleteBtn.length > 0) {
      await deleteBtn[0].trigger('click');
    }
    await nextTick();
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    wrapper.unmount();
  });

  it('saves project name when save button clicked', async () => {
    (api.updateProject as any).mockResolvedValue({ success: true, data: { id: 1, name: 'Updated Name', slug: 'test', description: '', created_at: '2024-01-01' } });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    await nextTick();
    const editBtn = wrapper.find('.edit-btn');
    if (editBtn.exists()) {
      await editBtn.trigger('click');
    }
    const nameInput = wrapper.find('input');
    if (nameInput.exists()) {
      await nameInput.setValue('Updated Name');
    }
    const saveBtn = wrapper.find('.save-btn');
    if (saveBtn.exists()) {
      await saveBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('saves project description when save button clicked', async () => {
    (api.updateProject as any).mockResolvedValue({ success: true, data: { id: 1, name: 'Test', slug: 'test', description: 'New description', created_at: '2024-01-01' } });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: 'Original',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    await nextTick();
    const editBtns = wrapper.findAll('.edit-btn');
    if (editBtns.length > 1) {
      await editBtns[1].trigger('click');
    }
    const textarea = wrapper.find('textarea');
    if (textarea.exists()) {
      await textarea.setValue('New description');
    }
    const saveBtn = wrapper.find('.save-btn');
    if (saveBtn.exists()) {
      await saveBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('saves access rules when save button clicked', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [{ id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 }],
        roles: [{ id: 1, name: 'Admin', access_level: 'admin' }],
        workflows: [], access_rules: [],
      },
    });
    (api.getAccessRules as any).mockResolvedValue({ success: true, data: [] });
    (api.updateAccessRules as any).mockResolvedValue({ success: true, data: [] });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const accessRulesTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Access Rules');
    if (accessRulesTab) {
      await accessRulesTab.trigger('click');
    }
    await flushPromises();
    await nextTick();
    const saveBtn = wrapper.find('.access-rules-actions .btn');
    if (saveBtn.exists()) {
      await saveBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('deletes transition when confirm button clicked', async () => {
    (api.deleteTransition as any).mockResolvedValue({ success: true });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [],
        workflows: [
          { id: 1, column_from: 1, column_to: 2, project_id: 1, requires_comment: false },
        ],
        access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowTab) {
      await workflowTab.trigger('click');
    }
    await nextTick();
    const deleteBtn = wrapper.findAll('.delete-btn');
    if (deleteBtn.length > 0) {
      await deleteBtn[0].trigger('click');
    }
    await nextTick();
    const confirmBtn = wrapper.find('.modal .danger-btn');
    if (confirmBtn.exists()) {
      await confirmBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('deletes column when confirm button clicked', async () => {
    (api.deleteColumn as any).mockResolvedValue({ success: true });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Backlog', slug: 'backlog', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const columnsTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'Columns');
    if (columnsTab) {
      await columnsTab.trigger('click');
    }
    await nextTick();
    const deleteBtn = wrapper.findAll('.delete-btn');
    if (deleteBtn.length > 0) {
      await deleteBtn[0].trigger('click');
    }
    await nextTick();
    const confirmBtn = wrapper.find('.modal .danger-btn');
    if (confirmBtn.exists()) {
      await confirmBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('edits role name and saves changes', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [{ id: 1, name: 'Admin', access_level: 'admin', description: 'Original desc' }] });
    (api.updateRole as any).mockResolvedValue({ success: true });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Admin', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const rolesBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Roles');
    if (rolesBtn) {
      await rolesBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    const editBtns = wrapper.findAll('.edit-btn');
    if (editBtns.length > 0) {
      await editBtns[0].trigger('click');
    }
    await nextTick();
    const roleInput = wrapper.find('#role-name-edit');
    if (roleInput.exists()) {
      await roleInput.setValue('Updated Admin');
    }
    const saveBtns = wrapper.findAll('.save-btn');
    if (saveBtns.length > 0) {
      await saveBtns[0].trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('cancels editing role', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [{ id: 1, name: 'Admin', access_level: 'admin', description: 'Desc' }] });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [{ id: 1, name: 'Admin', access_level: 'admin' }], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const rolesBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Roles');
    if (rolesBtn) {
      await rolesBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    const editBtns = wrapper.findAll('.edit-btn');
    if (editBtns.length > 0) {
      await editBtns[0].trigger('click');
    }
    await nextTick();
    const cancelBtns = wrapper.findAll('.cancel-btn');
    if (cancelBtns.length > 0) {
      await cancelBtns[0].trigger('click');
    }
    await flushPromises();
    const cellInputs = wrapper.findAll('.cell-input');
    expect(cellInputs.length).toBe(0);
    wrapper.unmount();
  });

  it('selects roles in workflow transition', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [
          { id: 1, name: 'Admin', access_level: 'admin' },
          { id: 2, name: 'Developer', access_level: 'developer' },
        ],
        workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await nextTick();
    const rolePickerBtn = wrapper.find('.role-multiselect .btn');
    if (rolePickerBtn.exists()) {
      await rolePickerBtn.trigger('click');
    }
    await nextTick();
    const roleOption = wrapper.find('.role-option');
    if (roleOption.exists()) {
      await roleOption.trigger('click');
    }
    await nextTick();
    expect(wrapper.text()).toContain('1 selected');
    wrapper.unmount();
  });

  it('adds a workflow transition', async () => {
    (api.createTransition as any).mockResolvedValue({ success: true });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await nextTick();
    const fromSelect = wrapper.find('#transition-from');
    if (fromSelect.exists()) {
      await fromSelect.setValue('1');
    }
    const toSelect = wrapper.find('#transition-to');
    if (toSelect.exists()) {
      await toSelect.setValue('2');
    }
    const addBtn = wrapper.find('.add-transition-form .btn--primary');
    if (addBtn.exists()) {
      await addBtn.trigger('click');
    }
    await flushPromises();
    wrapper.unmount();
  });

  it('shows role names for workflow with allowed roles', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [
      { id: 1, name: 'Admin', access_level: 'admin' },
      { id: 2, name: 'Developer', access_level: 'developer' },
    ]});
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [
          { id: 1, name: 'Admin', access_level: 'admin' },
          { id: 2, name: 'Developer', access_level: 'developer' },
        ],
        workflows: [
          { id: 1, column_from: 1, column_to: 2, project_id: 1, requires_comment: false, allowed_role_ids: '1,2' },
        ],
        access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('Admin');
    expect(wrapper.text()).toContain('Developer');
    wrapper.unmount();
  });

  it('displays Entire Ticket Group column header in workflow table', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [],
        workflows: [{ id: 1, column_from: 1, column_to: 2, project_id: 1, requires_comment: false }],
        access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await nextTick();
    const theadRows = wrapper.findAll('table thead tr');
    expect(theadRows.length).toBeGreaterThan(0);
    expect(theadRows[0].text()).toContain('Entire Ticket Group');
    wrapper.unmount();
  });

  it('shows Entire Ticket Group flag in workflow table row', async () => {
    (api.getRoles as any).mockResolvedValue({ success: true, data: [] });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [],
        workflows: [
          { id: 1, column_from: 1, column_to: 2, project_id: 1, requires_comment: false, entire_ticket_group: true },
          { id: 2, column_from: 1, column_to: 2, project_id: 1, requires_comment: true, entire_ticket_group: false },
        ],
        access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('Yes');
    wrapper.unmount();
  });

  it('toggles Entire Ticket Group checkbox in add transition form', async () => {
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await nextTick();
    const checkboxes = wrapper.findAll('.add-transition-form input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    // Second checkbox is "Entire ticket group"
    await checkboxes[1].trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('Requires entire ticket group');
    wrapper.unmount();
  });

  it('sends entire_ticket_group when creating a workflow transition', async () => {
    (api.createTransition as any).mockResolvedValue({ success: true });
    const mockStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01',
        columns: [
          { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 1, project_id: 1 },
          { id: 2, name: 'Done', slug: 'done', position: 2, order: 2, is_default: 0, project_id: 1 },
        ],
        roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    await flushPromises();
    const workflowBtn = wrapper.findAll('.tab-btn').find(t => t.text() === 'Workflow');
    if (workflowBtn) {
      await workflowBtn.trigger('click');
    }
    await nextTick();
    const fromSelect = wrapper.find('#transition-from');
    if (fromSelect.exists()) {
      await fromSelect.setValue('1');
    }
    const toSelect = wrapper.find('#transition-to');
    if (toSelect.exists()) {
      await toSelect.setValue('2');
    }
    // Check the entire ticket group checkbox
    const checkboxes = wrapper.findAll('.add-transition-form input[type="checkbox"]');
    if (checkboxes.length >= 2) {
      await checkboxes[1].setValue(true);
    }
    const addBtn = wrapper.find('.add-transition-form .btn--primary');
    if (addBtn.exists()) {
      await addBtn.trigger('click');
    }
    await flushPromises();
    expect(api.createTransition).toHaveBeenCalledWith('test-project', {
      column_from: 1,
      column_to: 2,
      requires_comment: false,
      entire_ticket_group: true,
      allowed_roles: [],
    });
    wrapper.unmount();
  });

  // --- Integration tests for "Create OpenCode config" feature (ticket #126) ---

  it('shows the OpenCode Config card in the Overview tab', () => {
    const { wrapper } = createWrapper();
    // The card should be visible since Overview is the default tab
    expect(wrapper.find('.opencode-config').exists()).toBe(true);
    expect(wrapper.find('.opencode-config h2').text()).toBe('OpenCode Config');
    wrapper.unmount();
  });

  it('shows the "Create OpenCode config" button in the Overview tab', () => {
    const { wrapper } = createWrapper();
    // Find the button inside the opencode-config card
    const card = wrapper.find('.opencode-config');
    expect(card.find('button').text()).toContain('Create OpenCode config');
    wrapper.unmount();
  });

  it('emits "generate-opencode-config" event when the OpenCode config button is clicked', async () => {
    const { wrapper } = createWrapper();
    // Find the OverviewSettings child component and get the button inside its opencode-config card
    const overviewSettings = wrapper.findComponent({ name: 'OverviewSettings' });
    expect(overviewSettings.exists()).toBe(true);
    const card = overviewSettings.find('.opencode-config');
    const button = card.find('button');
    await button.trigger('click');
    // The event is emitted by the OverviewSettings child component
    expect(overviewSettings.emitted('generate-opencode-config')).toBeTruthy();
    expect(overviewSettings.emitted('generate-opencode-config')).toHaveLength(1);
    wrapper.unmount();
  });

  it('opens the opencode config modal when the generate-opencode-config event is emitted', async () => {
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockProjectStore });
    await nextTick();

    // Call the openOpencodeConfigModal handler (simulates the event being handled)
    wrapper.vm.openOpencodeConfigModal();
    await nextTick();

    // Verify the modal is now visible
    expect(wrapper.vm.showOpencodeConfigModal).toBe(true);
    wrapper.unmount();
  });

  it('shows the opencode config modal with correct content when open', async () => {
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockProjectStore });
    await nextTick();

    // Initially modal should not be visible
    expect(wrapper.vm.showOpencodeConfigModal).toBe(false);
    expect(wrapper.find('.modal-overlay.modal--large').exists()).toBe(false);

    // Open the modal
    wrapper.vm.openOpencodeConfigModal();
    await nextTick();

    // Modal should now be visible
    expect(wrapper.vm.showOpencodeConfigModal).toBe(true);
    expect(wrapper.find('.modal--large').exists()).toBe(true);
    expect(wrapper.find('.modal--large h2').text()).toContain('Create OpenCode config');

    // Verify the form fields exist
    expect(wrapper.find('#opencode-host').exists()).toBe(true);
    expect(wrapper.find('#opencode-port').exists()).toBe(true);

    // Verify generate and close buttons exist
    expect(wrapper.find('.btn--primary').text()).toContain('Generate Config');
    expect(wrapper.find('.cancel-btn').text()).toContain('Close');

    wrapper.unmount();
  });

  it('resets config state when opening the opencode config modal', async () => {
    const mockProjectStore = createMockProjectStore({
      currentProject: {
        id: 1, name: 'Test', slug: 'test', description: '',
        created_at: '2024-01-01', columns: [], roles: [], workflows: [], access_rules: [],
      },
    });
    const { wrapper } = createWrapper({ projectStore: mockProjectStore });
    await nextTick();

    // Manually set some state as if config was previously generated
    wrapper.vm.opencodeConfigCode = 'some previous config';
    wrapper.vm.opencodeConfigResult = { connections: [] };

    // Open the modal again
    wrapper.vm.openOpencodeConfigModal();
    await nextTick();

    // State should be reset
    expect(wrapper.vm.showOpencodeConfigModal).toBe(true);
    expect(wrapper.vm.opencodeConfigCode).toBe('');
    expect(wrapper.vm.opencodeConfigResult).toBeNull();

    wrapper.unmount();
  });

  it('does not show "Create OpenCode config" button in the API Tokens tab', async () => {
    const { wrapper } = createWrapper();
    // Navigate to the tokens tab
    const tokensTab = wrapper.findAll('.tab-btn').find(t => t.text() === 'API Tokens');
    if (tokensTab) {
      await tokensTab.trigger('click');
    }
    await nextTick();
    // The opencode config button should NOT be in the tokens tab
    expect(wrapper.find('.token-management .opencode-config').exists()).toBe(false);
    // The "Create New Token" button should still be in the tokens tab
    expect(wrapper.find('.btn--primary').text()).toContain('Create New Token');
    wrapper.unmount();
  });
});
