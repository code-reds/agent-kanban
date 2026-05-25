import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import Dashboard from '@/views/Dashboard.vue';
import * as projectsApi from '@/stores/projects';

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

let mockStore: projectsApi.ProjectStore;

function createMockStore(): projectsApi.ProjectStore {
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
  } as unknown as projectsApi.ProjectStore;
}

function createWrapper(): VueWrapper {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
  });

  return mount(Dashboard, {
    global: {
      plugins: [router, createPinia()],
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a class="router-link-stub" :href="to"><slot /></a>',
        },
      },
    },
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStore = createMockStore();
    vi.mocked(projectsApi.useProjectStore).mockReturnValue(mockStore as any);
  });

  it('renders the dashboard heading', () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('Dashboard');
    wrapper.unmount();
  });

  it('renders the create project button', () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('Create Project');
    wrapper.unmount();
  });

  it('calls fetchProjects on mount', async () => {
    const fetchSpy = vi.spyOn(mockStore, 'fetchProjects');
    createWrapper();
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it('toggles create form visibility when button clicked', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    expect(wrapper.find('.create-form').exists()).toBe(true);
    expect(btn.text()).toContain('Cancel');
    await btn.trigger('click');
    expect(wrapper.find('.create-form').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows create form inputs when toggled', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('#project-name').exists()).toBe(true);
    expect(wrapper.find('#project-slug').exists()).toBe(true);
    wrapper.unmount();
  });

  it('auto-generates slug from name via watchEffect', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    const nameInput = wrapper.find('#project-name');
    await nameInput.setValue('My Test Project');
    await vi.waitFor(() => {
      const slugInput = wrapper.find('#project-slug');
      expect((slugInput.element as HTMLInputElement).value).toBe('my-test-project');
    });
    wrapper.unmount();
  });

  it('validates slug format on submission', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    await wrapper.vm.$nextTick();

    const slugInput = wrapper.find('#project-slug');
    await slugInput.setValue('Invalid Slug!');

    const form = wrapper.find('form');
    await form.trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.form-error').text()).toContain('lowercase letters');
    wrapper.unmount();
  });

  it('calls store.createProject with correct args on valid submission', async () => {
    mockStore.createProject.mockResolvedValue(true);
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.create-form').exists()).toBe(true);
    });

    await wrapper.find('#project-name').setValue('Test Project');
    await vi.waitFor(() => {
      const slugInput = wrapper.find('#project-slug');
      expect((slugInput.element as HTMLInputElement).value).toBe('test-project');
    });
    await wrapper.find('#project-slug').setValue('test-project');

    const form = wrapper.find('form');
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(mockStore.createProject).toHaveBeenCalledWith('Test Project', 'test-project');
    });
    wrapper.unmount();
  });

  it('closes form and resets on successful creation', async () => {
    mockStore.createProject.mockResolvedValue(true);
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.create-form').exists()).toBe(true);
    });

    await wrapper.find('#project-name').setValue('New Project');
    await wrapper.find('#project-slug').setValue('new-project');

    const form = wrapper.find('form');
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(wrapper.find('.create-form').exists()).toBe(false);
    });
    expect(wrapper.find('.form-error').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows loading state when projects are loading and list is empty', async () => {
    mockStore.loading = true;
    mockStore.projects = [];
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.loading-state').text()).toContain('Loading projects...');
    wrapper.unmount();
  });

  it('shows error state with retry button when error and no projects', async () => {
    mockStore.error = 'Network error';
    mockStore.projects = [];
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    const errorState = wrapper.find('.error-state');
    expect(errorState.exists()).toBe(true);
    expect(errorState.text()).toContain('Network error');
    const retryBtn = errorState.find('button');
    expect(retryBtn.exists()).toBe(true);
    wrapper.unmount();
  });

  it('displays project cards from store', async () => {
    mockStore.projects = [
      { id: 1, name: 'Project A', slug: 'project-a', description: 'Desc A', created_at: '2024-01-01' as any },
      { id: 2, name: 'Project B', slug: 'project-b', description: 'Desc B', created_at: '2024-01-02' as any },
    ];
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    const cards = wrapper.findAll('.router-link-stub');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('Project A');
    expect(cards[0].text()).toContain('Desc A');
    wrapper.unmount();
  });

  it('shows empty state when no projects', async () => {
    mockStore.projects = [];
    mockStore.loading = false;
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.empty-state').text()).toContain('No projects yet');
    wrapper.unmount();
  });

  it('shows description or fallback for projects', async () => {
    mockStore.projects = [{ id: 1, name: 'No Desc', slug: 'no-desc', description: '', created_at: '2024-01-01' as any }];
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    const card = wrapper.find('.router-link-stub');
    expect(card.find('.project-description').text()).toBe('No description');
    wrapper.unmount();
  });

  it('renders router-link for each project card', async () => {
    mockStore.projects = [{ id: 1, name: 'Test', slug: 'test', description: '', created_at: '2024-01-01' as any }];
    const wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    const link = wrapper.find('.router-link-stub');
    expect(link.attributes('href')).toBe('/projects/test/board');
    wrapper.unmount();
  });

  it('generates slug with special characters correctly', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    const nameInput = wrapper.find('#project-name');
    await nameInput.setValue('Hello World! @#$%^');
    await vi.waitFor(() => {
      const slugInput = wrapper.find('#project-slug');
      expect((slugInput.element as HTMLInputElement).value).toBe('hello-world');
    });
    wrapper.unmount();
  });

  it('generates slug with consecutive spaces correctly', async () => {
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    const nameInput = wrapper.find('#project-name');
    await nameInput.setValue('Test   Multiple   Spaces');
    await vi.waitFor(() => {
      const slugInput = wrapper.find('#project-slug');
      expect((slugInput.element as HTMLInputElement).value).toBe('test-multiple-spaces');
    });
    wrapper.unmount();
  });

  it('shows loading text when store is loading', async () => {
    mockStore.loading = true;
    const wrapper = createWrapper();
    const btn = wrapper.find('.dashboard-header button');
    await btn.trigger('click');
    const submitBtn = wrapper.find('form button[type="submit"]');
    expect(submitBtn.text()).toContain('Creating...');
    wrapper.unmount();
  });
});
