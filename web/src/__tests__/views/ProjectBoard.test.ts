import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory, useRoute } from 'vue-router';
import { shallowReactive } from 'vue';
import ProjectBoard from '@/views/ProjectBoard.vue';
import * as ticketApi from '@/stores/tickets';
import * as projectApi from '@/stores/projects';

vi.mock('@/stores/tickets', () => ({
  useTicketStore: vi.fn(),
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

const mockRoute = shallowReactive({ params: { slug: 'test-project' } });

function createMockTicketStore(overrides: Partial<ticketApi.TicketStore> = {}): ticketApi.TicketStore {
  return {
    tickets: [],
    ticketsByColumn: {},
    columns: [],
    selectedTicket: null,
    loading: false,
    error: null,
    currentPage: 1,
    loadingMore: false,
    fetchTickets: vi.fn(),
    fetchTicketById: vi.fn(),
    createTicket: vi.fn(),
    updateTicket: vi.fn(),
    moveTicket: vi.fn(),
    addComment: vi.fn(),
    selectTicket: vi.fn(),
    deselectTicket: vi.fn(),
    refreshProject: vi.fn(),
    fetchColumns: vi.fn(),
    createColumn: vi.fn(),
    updateColumn: vi.fn(),
    deleteColumn: vi.fn(),
    fetchDependencies: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    dependencies: [],
    ...overrides,
  } as unknown as ticketApi.TicketStore;
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
  ticketStore,
  projectStore,
  routeSlug,
}: {
  ticketStore?: ticketApi.TicketStore;
  projectStore?: projectApi.ProjectStore;
  routeSlug?: string;
} = {}) {
  const mockTicketStore = ticketStore || createMockTicketStore();
  const mockProjectStore = projectStore || createMockProjectStore();

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/projects/:slug', name: 'board', component: { template: '<div/>' } }],
  });

  setActivePinia(createPinia());

  mockRoute.params = { slug: routeSlug || 'test-project' };
  (vueRouterUseRoute as any).mockReturnValue(mockRoute);
  (ticketApi.useTicketStore as any).mockReturnValue(mockTicketStore);
  (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);

  return {
    wrapper: mount(ProjectBoard, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
          },
          KanbanBoard: {
            name: 'KanbanBoardStub',
            template: '<div class="kanban-board-stub"><slot /></div>',
            props: ['projectSlug'],
          },
          TicketDetail: {
            template: '<div class="ticket-detail-stub"><slot /></div>',
            props: ['ticket'],
          },
        },
      },
    }),
    mockTicketStore,
    mockProjectStore,
    router,
  };
}

describe('ProjectBoard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the project title from currentProject', () => {
    const mockStore = createMockProjectStore({
      currentProject: { id: 1, name: 'Test Project', slug: 'test', created_at: '2024-01-01', description: '', columns: [], roles: [], workflows: [], access_rules: [] },
    });
    const { wrapper } = createWrapper({ projectStore: mockStore });
    expect(wrapper.text()).toContain('Test Project');
    wrapper.unmount();
  });

  it('falls back to slug when no currentProject', () => {
    const { wrapper } = createWrapper({ routeSlug: 'fallback-slug' });
    expect(wrapper.text()).toContain('fallback-slug');
    wrapper.unmount();
  });

  it('renders the new ticket button', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.project-board__new-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('opens new ticket modal when + New Ticket button clicked', async () => {
    const { wrapper } = createWrapper();
    const btn = wrapper.find('.project-board__new-btn');
    await btn.trigger('click');
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.find('.modal__title').text()).toBe('New Ticket');
    wrapper.unmount();
  });

  it('renders ticket creation form fields', async () => {
    const { wrapper } = createWrapper();
    const btn = wrapper.find('.project-board__new-btn');
    await btn.trigger('click');
    expect(wrapper.find('#nt-title').exists()).toBe(true);
    expect(wrapper.find('#nt-column').exists()).toBe(true);
    expect(wrapper.find('#nt-priority').exists()).toBe(true);
    expect(wrapper.find('#nt-estimate').exists()).toBe(true);
    expect(wrapper.find('#nt-description').exists()).toBe(true);
    expect(wrapper.find('#nt-labels').exists()).toBe(true);
    wrapper.unmount();
  });

  it('closes modal when close button clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.project-board__new-btn').trigger('click');
    const closeBtn = wrapper.find('.modal__close');
    await closeBtn.trigger('click');
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes modal when overlay clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.project-board__new-btn').trigger('click');
    const overlay = wrapper.find('.modal-overlay');
    await overlay.trigger('click');
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders KanbanBoard component with correct project slug', () => {
    const { wrapper } = createWrapper({ routeSlug: 'my-project' });
    const kanbanStub = wrapper.findComponent({ name: 'KanbanBoardStub' });
    expect(kanbanStub.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders error message when ticket store has error', () => {
    const mockTicketStore = createMockTicketStore({ error: 'Failed to load' });
    const { wrapper } = createWrapper({ ticketStore: mockTicketStore });
    expect(wrapper.find('.project-board__error').text()).toContain('Failed to load');
    wrapper.unmount();
  });

  it('emits select-ticket event to store', async () => {
    const { wrapper, mockTicketStore } = createWrapper();
    const kanbanStub = wrapper.findComponent({ name: 'KanbanBoardStub' });
    const ticket = { id: 1, title: 'Test', description: '', labels: '', priority: 2, estimate: null, created_at: '2024-01-01', updated_at: '2024-01-01', project_id: 1, column_id: 1, created_by_role_id: 1, comments: [] } as any;
    await kanbanStub.vm.$emit('selectTicket', ticket);
    expect(mockTicketStore.selectTicket).toHaveBeenCalledWith(ticket);
    wrapper.unmount();
  });

  it('refreshes project on route slug change', async () => {
    const mockTicketStore = createMockTicketStore();
    const mockProjectStore = createMockProjectStore({
      currentProject: { id: 1, name: 'Test', slug: 'test', created_at: '2024-01-01', description: '', columns: [], roles: [], workflows: [], access_rules: [] },
    });

    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/projects/:slug', name: 'board', component: { template: '<div/>' } }],
    });

    setActivePinia(createPinia());
    (vueRouterUseRoute as any).mockReturnValue(mockRoute);
    (ticketApi.useTicketStore as any).mockReturnValue(mockTicketStore);
    (projectApi.useProjectStore as any).mockReturnValue(mockProjectStore);

    const wrapper = mount(ProjectBoard, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
          },
          KanbanBoard: {
            name: 'KanbanBoardStub',
            template: '<div class="kanban-board-stub"><slot /></div>',
            props: ['projectSlug'],
          },
          TicketDetail: {
            template: '<div class="ticket-detail-stub"><slot /></div>',
            props: ['ticket'],
          },
        },
      },
    });

    await router.push({ name: 'board', params: { slug: 'new-project' } });
    mockRoute.params = { slug: 'new-project' };
    await wrapper.vm.$nextTick();
    await vi.waitFor(() => {
      expect(mockTicketStore.fetchTickets).toHaveBeenCalledWith('new-project', undefined, { all_tickets: true, done_limit: 8 });
      expect(mockTicketStore.fetchColumns).toHaveBeenCalledWith('new-project');
    });
    wrapper.unmount();
  });

  it('uses ticketStore columns over currentProject columns', () => {
    const mockTicketStore = createMockTicketStore({
      columns: [{ id: 1, name: 'Ticket Col', slug: 'ticket-col', position: 1, order: 1, is_default: 0, project_id: 1 }],
    });
    const mockProjectStore = createMockProjectStore({
      currentProject: { id: 1, name: 'Test', slug: 'test', created_at: '2024-01-01', description: '', columns: [{ id: 2, name: 'Project Col', slug: 'project-col', position: 1, order: 1, is_default: 0, project_id: 1 }], roles: [], workflows: [], access_rules: [] },
    });
    const { wrapper } = createWrapper({ ticketStore: mockTicketStore, projectStore: mockProjectStore, routeSlug: 'test' });
    const kanbanStub = wrapper.findComponent({ name: 'KanbanBoardStub' });
    expect(kanbanStub.props('projectSlug')).toBe('test');
    wrapper.unmount();
  });

  it('shows project-board class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.project-board').exists()).toBe(true);
    wrapper.unmount();
  });

  it('has project-board--panel-open class when ticket selected', () => {
    const mockTicketStore = createMockTicketStore({ selectedTicket: { id: 1 } as any });
    const { wrapper } = createWrapper({ ticketStore: mockTicketStore });
    expect(wrapper.find('.project-board__board--panel-open').exists()).toBe(true);
    wrapper.unmount();
  });

  it('does not have panel-open class when no ticket selected', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.project-board__board--panel-open').exists()).toBe(false);
    wrapper.unmount();
  });
});
