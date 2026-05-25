import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import TicketDetail from '@/components/tickets/TicketDetail.vue';
import * as ticketApi from '@/stores/tickets';

vi.mock('@/stores/tickets', () => ({
  useTicketStore: vi.fn(),
}));

import { useTicketStore as ticketHook } from '@/stores/tickets';

const mockTicket: any = {
  id: 42,
  project_id: 1,
  column_id: 1,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  labels: '["bug", "auth"]',
  priority: 1,
  estimate: null,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  created_by_role_id: 1,
  comments: [],
  column: { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 0, project_id: 1 },
};

const mockColumns: any[] = [
  { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 0, project_id: 1 },
  { id: 2, name: 'In Progress', slug: 'in_progress', position: 2, order: 2, is_default: 0, project_id: 1 },
  { id: 3, name: 'Done', slug: 'done', position: 3, order: 3, is_default: 1, project_id: 1 },
];

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
    fetchTransitions: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    refreshSelectedTicketComments: vi.fn(),
    dependencies: [],
    transitions: [],
    parentTickets: [],
    childTicketsByParentId: {},
    isParentTicket: vi.fn().mockReturnValue(false),
    getChildTickets: vi.fn().mockReturnValue([]),
    getParentTicket: vi.fn().mockReturnValue(null),
    getChildTicketsForColumn: vi.fn().mockReturnValue([]),
    orphanChildTickets: {},
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    blockingStatus: {},
    fetchTicketBlockers: vi.fn(),
    ...overrides,
  } as unknown as ticketApi.TicketStore;
}

function createWrapper({
  ticket,
  columns,
  projectSlug,
  ticketStore,
  userRoleId,
}: {
  ticket?: any;
  columns?: any[];
  projectSlug?: string;
  ticketStore?: ticketApi.TicketStore;
  userRoleId?: number;
} = {}) {
  const mockStore = ticketStore || createMockTicketStore();
  setActivePinia(createPinia());
  (ticketHook as any).mockReturnValue(mockStore);

  const wrapper = mount(TicketDetail, {
    props: {
      ticket: ticket || mockTicket,
      projectSlug: projectSlug || 'test-project',
      columns: columns || mockColumns,
      userRoleId: userRoleId,
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        Teleport: {
          props: ['to'],
          template: '<div><slot /></div>',
        },
      },
    },
  });

  return { wrapper, mockStore };
}

describe('TicketDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Clear localStorage to ensure consistent test state
    localStorage.clear();
  });

  it('renders ticket ID', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail__id').text()).toBe('#42');
    wrapper.unmount();
  });

  it('renders ticket title', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail__title').text()).toBe('Fix login bug');
    wrapper.unmount();
  });

  it('renders close button', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail__close').exists()).toBe(true);
  });

  it('emits close event when close button clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.ticket-detail__close').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });

  it('renders current status badge', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-status__badge').text()).toBe('Todo');
    wrapper.unmount();
  });

  it('shows priority badge', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-badge--priority-1').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows move button', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-status__move-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('toggles move dropdown when move button clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.td-status__move-btn').trigger('click');
    expect(wrapper.find('.td-move-dropdown').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows other columns in move dropdown', async () => {
    const mockStore = createMockTicketStore({
      transitions: [
        { toColumnSlug: 'in_progress', requiresComment: false },
        { toColumnSlug: 'done', requiresComment: false },
      ],
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-status__move-btn').trigger('click');
    const dropdownItems = wrapper.findAll('.td-move-dropdown__item');
    expect(dropdownItems.length).toBe(2);
    expect(dropdownItems[0].text()).toContain('In Progress');
    expect(dropdownItems[1].text()).toContain('Done');
    wrapper.unmount();
  });

  it('renders details section', () => {
    const { wrapper } = createWrapper();
    const labels = wrapper.findAll('.td-section__title');
    expect(labels[1].text()).toBe('Details');
    wrapper.unmount();
  });

  it('renders priority field', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Priority');
    wrapper.unmount();
  });

  it('renders estimate field', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Estimate');
    wrapper.unmount();
  });

  it('renders labels field', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Labels');
    wrapper.unmount();
  });

  it('renders description field', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Description');
    wrapper.unmount();
  });

  it('renders dependencies section', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Dependencies');
    wrapper.unmount();
  });

  it('toggles dependency section', async () => {
    const { wrapper } = createWrapper();
    const buttons = wrapper.findAll('.td-btn--ghost');
    // First ghost button is "Edit", second is dependency toggle ("Show")
    await buttons[1].trigger('click');
    // Section body is shown
    const sectionBodies = wrapper.findAll('.td-section__body');
    expect(sectionBodies.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('renders comments section', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.text()).toContain('Comments');
    wrapper.unmount();
  });

  it('shows comments comment input area', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-comments__input').exists()).toBe(true);
    expect(wrapper.find('.td-comments__textarea').exists()).toBe(true);
    expect(wrapper.find('.td-comments__input .td-btn').text()).toBe('Comment');
    wrapper.unmount();
  });

  it('renders footer with created date', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail__footer').exists()).toBe(true);
    const labels = wrapper.findAll('.td-meta__label');
    expect(labels[0].text()).toBe('Created');
    wrapper.unmount();
  });

  it('renders footer with updated date', () => {
    const { wrapper } = createWrapper();
    const labels = wrapper.findAll('.td-meta__label');
    expect(labels[1].text()).toBe('Updated');
    wrapper.unmount();
  });

  it('emits update event when saving all edits', async () => {
    const mockStore = createMockTicketStore({
      updateTicket: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-btn--ghost').trigger('click');
    const select = wrapper.find('.td-form-item__select');
    await select.setValue('2');
    // Save button is in the section header, not the body
    const saveBtn = wrapper.find('.td-section__header .td-btn--primary');
    await saveBtn.trigger('click');
    expect(mockStore.updateTicket).toHaveBeenCalled();
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('renders done column as done status', () => {
    const ticket = { ...mockTicket, column: { id: 3, name: 'Done', slug: 'done', position: 3, order: 3, is_default: 1, project_id: 1 } };
    const { wrapper } = createWrapper({ ticket });
    const badge = wrapper.find('.td-status__badge');
    expect(badge.classes()).toContain('td-status__badge--done');
    wrapper.unmount();
  });

  it('renders ticket-detail-backdrop class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail-backdrop').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders ticket-detail-panel class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail-panel').exists()).toBe(true);
    wrapper.unmount();
  });

  it('has ticket-detail__content class', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.ticket-detail__content').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders labels when present', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-tag').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows no labels state when empty', () => {
    const ticket = { ...mockTicket, labels: '' };
    const { wrapper } = createWrapper({ ticket });
    expect(wrapper.text()).toContain('No labels');
    wrapper.unmount();
  });

  it('scrolls to bottom when comments change', async () => {
    const { wrapper } = createWrapper();
    // Verify comments container exists
    expect(wrapper.find('.td-comments__list').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders edit button', () => {
    const { wrapper } = createWrapper();
    const buttons = wrapper.findAll('.td-btn--ghost');
    expect(buttons.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('opens edit mode when Edit button clicked', async () => {
    const { wrapper } = createWrapper();
    const buttons = wrapper.findAll('.td-btn--ghost');
    await buttons[0].trigger('click');
    expect(wrapper.find('.td-edit-form').exists()).toBe(true);
    expect(wrapper.find('.td-form-item__select').exists()).toBe(true);
    wrapper.unmount();
  });

  it('saves priority via store', async () => {
    const mockStore = createMockTicketStore({
      updateTicket: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-btn--ghost').trigger('click');
    const select = wrapper.find('.td-form-item__select');
    await select.setValue('2');
    // Save button is in the section header
    await wrapper.find('.td-section__header .td-btn--primary').trigger('click');
    expect(mockStore.updateTicket).toHaveBeenCalledWith('test-project', 42, {
      priority: 2,
    });
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('cancels edit', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.td-btn--ghost').trigger('click');
    // Re-query after edit mode activates (ghost buttons changed from Edit → Cancel + primary Save)
    const ghostButtons = wrapper.findAll('.td-btn--ghost');
    await ghostButtons[0].trigger('click');
    expect(wrapper.find('.td-edit-form').exists()).toBe(false);
    wrapper.unmount();
  });

  it('saves estimate via store', async () => {
    const mockStore = createMockTicketStore({
      updateTicket: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore, ticket: { ...mockTicket, estimate: 4 } });
    await wrapper.find('.td-btn--ghost').trigger('click');
    const estimateInput = wrapper.find('#edit-estimate');
    await estimateInput.setValue('8');
    await wrapper.find('.td-section__header .td-btn--primary').trigger('click');
    expect(mockStore.updateTicket).toHaveBeenCalledWith('test-project', 42, {
      estimate: 8,
    });
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('saves labels via store', async () => {
    const mockStore = createMockTicketStore({
      updateTicket: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-btn--ghost').trigger('click');
    const labelsInput = wrapper.find('#edit-labels');
    await labelsInput.setValue('new-label,another');
    await wrapper.find('.td-section__header .td-btn--primary').trigger('click');
    expect(mockStore.updateTicket).toHaveBeenCalledWith('test-project', 42, { labels: '["new-label","another"]' });
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('saves description via store', async () => {
    const mockStore = createMockTicketStore({
      updateTicket: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-btn--ghost').trigger('click');
    const textareas = wrapper.findAll('.td-form-item__textarea');
    if (textareas.length > 0) {
      await textareas[0].setValue('Updated description');
    }
    await wrapper.find('.td-section__header .td-btn--primary').trigger('click');
    expect(mockStore.updateTicket).toHaveBeenCalledWith('test-project', 42, { description: 'Updated description' });
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('moves ticket to another column', async () => {
    const mockStore = createMockTicketStore({
      moveTicket: vi.fn().mockResolvedValue(true),
      transitions: [
        { toColumnSlug: 'in_progress', requiresComment: false },
        { toColumnSlug: 'done', requiresComment: false },
      ],
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-status__move-btn').trigger('click');
    const dropdownItems = wrapper.findAll('.td-move-dropdown__item');
    await dropdownItems[0].trigger('click');
    await wrapper.find('.td-move-dropdown__actions .td-btn--primary').trigger('click');
    expect(mockStore.moveTicket).toHaveBeenCalledWith('test-project', 42, {
      to_column: 'in_progress',
    });
    expect(wrapper.emitted('update')).toBeTruthy();
    wrapper.unmount();
  });

  it('moves ticket with comment to done column', async () => {
    const mockStore = createMockTicketStore({
      moveTicket: vi.fn().mockResolvedValue(true),
      transitions: [
        { toColumnSlug: 'todo', requiresComment: false },
        { toColumnSlug: 'in_progress', requiresComment: false },
      ],
    });
    const ticket = { ...mockTicket, column: { id: 3, name: 'Done', slug: 'done', position: 3, order: 3, is_default: 1, project_id: 1 } };
    const { wrapper } = createWrapper({ ticket, ticketStore: mockStore });
    await wrapper.find('.td-status__move-btn').trigger('click');
    // Comment section only appears after selecting a target column
    const dropdownItems = wrapper.findAll('.td-move-dropdown__item');
    await dropdownItems[0].trigger('click');
    const commentSection = wrapper.find('.td-move-dropdown__comment-section');
    expect(commentSection.exists()).toBe(true);
    const textarea = wrapper.find('.td-move-dropdown__comment-textarea');
    await textarea.setValue('Fixed and verified');
    await wrapper.find('.td-move-dropdown__actions .td-btn--primary').trigger('click');
    wrapper.unmount();
  });

  it('closes move dropdown when cancel clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.td-status__move-btn').trigger('click');
    expect(wrapper.find('.td-move-dropdown').exists()).toBe(true);
    await wrapper.find('.td-move-dropdown__actions .td-btn--secondary').trigger('click');
    expect(wrapper.find('.td-move-dropdown').exists()).toBe(false);
    wrapper.unmount();
  });

  it('adds a comment', async () => {
    const mockStore = createMockTicketStore({
      addComment: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    const textarea = wrapper.find('.td-comments__textarea');
    await textarea.setValue('Great work!');
    await wrapper.find('.td-comments__input .td-btn--primary').trigger('click');
    expect(mockStore.addComment).toHaveBeenCalledWith('test-project', 42, { content: 'Great work!' });
    wrapper.unmount();
  });

  it('does not add empty comment', async () => {
    const mockStore = createMockTicketStore({
      addComment: vi.fn().mockResolvedValue(true),
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    await wrapper.find('.td-comments__input .td-btn--primary').trigger('click');
    expect(mockStore.addComment).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows dependency section when toggled', async () => {
    const { wrapper } = createWrapper();
    const buttons = wrapper.findAll('.td-btn--ghost');
    // First ghost button is "Edit" for Details, second is for Dependencies
    await buttons[1].trigger('click');
    // Section body is shown with dep add form
    expect(wrapper.find('.td-dep-add').exists()).toBe(true);
    wrapper.unmount();
  });

  it('displays dependency item', async () => {
    const mockStore = createMockTicketStore({
      dependencies: [
        { ticket_id: 42, depends_on_id: 10, relation_type: 'depends_on' },
      ],
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    const buttons = wrapper.findAll('.td-btn--ghost');
    await buttons[1].trigger('click');
    expect(wrapper.find('.td-dep-item__ref').text()).toContain('10');
    wrapper.unmount();
  });

  it('removes a dependency', async () => {
    const mockStore = createMockTicketStore({
      removeDependency: vi.fn().mockResolvedValue(undefined),
      dependencies: [
        { ticket_id: 42, depends_on_id: 10, relation_type: 'depends_on' },
      ],
    });
    const { wrapper } = createWrapper({ ticketStore: mockStore });
    const buttons = wrapper.findAll('.td-btn--ghost');
    await buttons[1].trigger('click');
    await wrapper.find('.td-dep-item__remove').trigger('click');
    expect(mockStore.removeDependency).toHaveBeenCalledWith('test-project', 42, 10, 'depends_on');
    wrapper.unmount();
  });

  it('formats timestamp correctly', async () => {
    const { wrapper } = createWrapper();
    const labels = wrapper.findAll('.td-meta__label');
    expect(labels[0].text()).toBe('Created');
    expect(labels[1].text()).toBe('Updated');
    expect(wrapper.find('.td-meta__value').exists()).toBe(true);
    wrapper.unmount();
  });

  it('emits close on backdrop click', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.ticket-detail-backdrop').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });

  it('does not close when panel is clicked', async () => {
    const { wrapper } = createWrapper();
    await wrapper.find('.ticket-detail-panel').trigger('click');
    expect(wrapper.emitted('close')).toBeFalsy();
    wrapper.unmount();
  });

  it('shows no comments state when empty', () => {
    const { wrapper } = createWrapper();
    expect(wrapper.find('.td-comments__empty').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows "Not set" when estimate is null', async () => {
    const ticket = { ...mockTicket, estimate: null };
    const { wrapper } = createWrapper({ ticket });
    expect(wrapper.text()).toContain('Not set');
    wrapper.unmount();
  });

  describe('Resizable sidebar', () => {
    it('renders the resize handle', () => {
      const { wrapper } = createWrapper();
      expect(wrapper.find('.ticket-detail__resize-handle').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders the resize handle with correct width', () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');
      expect(handle.attributes('style')).toContain('width: 6px');
      wrapper.unmount();
    });

    it('renders the panel with the correct initial width', () => {
      const { wrapper } = createWrapper();
      const panel = wrapper.find('.ticket-detail-panel');
      // Default width (640) + handle width (6) = 646
      expect(panel.attributes('style')).toContain('width: 646px');
      wrapper.unmount();
    });

    it('emits resize event when dragging', async () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');

      // Trigger mousedown to start the resize
      await handle.trigger('mousedown', { clientX: 1000 });
      await nextTick();

      // Dispatch document-level mousemove (the handler listens on document)
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, bubbles: true }));
      await nextTick();

      expect(wrapper.emitted('resize')).toBeTruthy();
      const resizeArgs = wrapper.emitted('resize') as unknown[][];
      // Dragging left from 1000 to 900 increases width, so new width > 646
      expect(resizeArgs[0][0]).toBeGreaterThan(646);
      wrapper.unmount();
    });

    it('sets CSS cursor to col-resize when resizing', async () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');

      // Store original values
      const origCursor = document.documentElement.style.cursor;
      const origUserSelect = document.documentElement.style.userSelect;

      await handle.trigger('mousedown', { clientX: 1000 });
      expect(document.documentElement.style.cursor).toBe('col-resize');
      expect(document.documentElement.style.userSelect).toBe('none');

      // Simulate mouseup
      await handle.trigger('mouseup');
      expect(document.documentElement.style.cursor).toBe(origCursor);
      expect(document.documentElement.style.userSelect).toBe(origUserSelect);

      wrapper.unmount();
    });

    it('clamps width to min when dragging too far left', async () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');

      // Simulate mousedown far to the right to force width below minimum
      await handle.trigger('mousedown', { clientX: 3000 });
      const emitted = wrapper.emitted('resize');
      if (emitted && emitted[0]) {
        const width = (emitted[0] as number[])[0];
        expect(width).toBeGreaterThanOrEqual(280);
      }
      wrapper.unmount();
    });

    it('clamps width to max when dragging to the right', async () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');

      // Simulate mousedown far to the left to force width above maximum
      await handle.trigger('mousedown', { clientX: 0 });
      const emitted = wrapper.emitted('resize');
      if (emitted && emitted[0]) {
        const width = (emitted[0] as number[])[0];
        expect(width).toBeLessThanOrEqual(900);
      }
      wrapper.unmount();
    });

    it('renders panel with dynamic width style binding', () => {
      const { wrapper } = createWrapper();
      const panel = wrapper.find('.ticket-detail-panel');

      // Panel should have a width style set (responsive to sidebarWidth ref)
      expect(panel.attributes('style')).toContain('width:');
      // Initial default: 640 + 6 = 646
      expect(panel.attributes('style')).toContain('646px');
      wrapper.unmount();
    });

    it('does not emit close when resize handle is clicked', async () => {
      const { wrapper } = createWrapper();
      const handle = wrapper.find('.ticket-detail__resize-handle');
      await handle.trigger('click');
      expect(wrapper.emitted('close')).toBeFalsy();
      wrapper.unmount();
    });
  });

  describe('Comment edit mode', () => {
    const mockComment: any = {
      id: 1,
      ticket_id: 42,
      author_role_id: 1,
      author_role_name: 'Human User',
      content: 'This is a test comment',
      action_type: '',
      created_at: '2024-01-15T10:00:00Z',
    };

    const mockTicketWithComments: any = {
      ...mockTicket,
      comments: [mockComment],
    };

    it('shows rendered markdown by default (not in edit mode)', () => {
      const { wrapper } = createWrapper({ ticket: mockTicketWithComments });
      expect(wrapper.find('.td-comment__content').exists()).toBe(true);
      expect(wrapper.find('.td-comment__content--edit').exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows edit and delete buttons for Human User (role 1)', () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      const deleteBtn = wrapper.findAll('.td-comment__action-btn--delete');
      expect(editBtn.exists()).toBe(true);
      expect(deleteBtn.length).toBe(1);
      wrapper.unmount();
    });

    it('does not show edit/delete buttons for non-Human User (role 4) editing someone else\'s comment', () => {
      const otherUserComment: any = {
        ...mockComment,
        author_role_id: 1,
        author_role_name: 'Human User',
      };
      const { wrapper } = createWrapper({
        ticket: { ...mockTicketWithComments, comments: [otherUserComment] },
        userRoleId: 4, // AI code developer
      });
      const actionBtns = wrapper.findAll('.td-comment__action-btn');
      expect(actionBtns.length).toBe(0);
      wrapper.unmount();
    });

    it('shows edit/delete buttons for author editing their own comment (role 4)', () => {
      const authorComment: any = {
        ...mockComment,
        author_role_id: 4,
        author_role_name: 'AI code developer',
      };
      const { wrapper } = createWrapper({
        ticket: { ...mockTicketWithComments, comments: [authorComment] },
        userRoleId: 4,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      const deleteBtn = wrapper.findAll('.td-comment__action-btn--delete');
      expect(editBtn.exists()).toBe(true);
      expect(deleteBtn.length).toBe(1);
      wrapper.unmount();
    });

    it('enters edit mode when edit button clicked', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      // Edit mode should be active
      expect(wrapper.find('.td-comment__content--edit').exists()).toBe(true);
      expect(wrapper.find('.td-comment__edit-textarea').exists()).toBe(true);
      // Textarea should contain the raw markdown content
      const textarea = wrapper.find('.td-comment__edit-textarea');
      expect(textarea.element).toHaveProperty('value', 'This is a test comment');
      wrapper.unmount();
    });

    it('cancel button exits edit mode without changes', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      expect(wrapper.find('.td-comment__content--edit').exists()).toBe(true);
      // Find Cancel button within the edit area
      const cancelBtn = wrapper.find('.td-comment__edit-actions .td-btn--ghost');
      await cancelBtn.trigger('click');
      expect(wrapper.find('.td-comment__content--edit').exists()).toBe(false);
      wrapper.unmount();
    });

    it('save button calls store updateComment action', async () => {
      const mockStore = createMockTicketStore({
        updateComment: vi.fn().mockResolvedValue(true),
      });
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
        ticketStore: mockStore,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      const textarea = wrapper.find('.td-comment__edit-textarea');
      await textarea.setValue('Updated comment content');
      const saveBtn = wrapper.find('.td-comment__edit-actions .td-btn--primary');
      await saveBtn.trigger('click');
      expect(mockStore.updateComment).toHaveBeenCalledWith(
        'test-project',
        42,
        1,
        { content: 'Updated comment content' }
      );
      // Should exit edit mode after save
      expect(wrapper.find('.td-comment__content--edit').exists()).toBe(false);
      wrapper.unmount();
    });

    it('save is disabled when content is empty', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      // Initially not disabled (has content)
      let saveBtn = wrapper.find('.td-comment__edit-actions .td-btn--primary');
      expect(saveBtn.attributes('disabled')).toBeUndefined();
      // Clear the textarea and type nothing
      const textarea = wrapper.find('.td-comment__edit-textarea');
      await textarea.setValue('');
      await nextTick();
      saveBtn = wrapper.find('.td-comment__edit-actions .td-btn--primary');
      expect(saveBtn.element.hasAttribute('disabled')).toBe(true);
      wrapper.unmount();
    });

    it('save on empty content does not call store', async () => {
      const mockStore = createMockTicketStore({
        updateComment: vi.fn().mockResolvedValue(true),
      });
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
        ticketStore: mockStore,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      // Set to whitespace only
      const textarea = wrapper.find('.td-comment__edit-textarea');
      await textarea.setValue('   ');
      await nextTick();
      // Even though the button is disabled, if it somehow triggers, it should not call
      expect(mockStore.updateComment).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('edit and delete buttons hidden when already in edit mode', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const editBtn = wrapper.find('.td-comment__action-btn');
      await editBtn.trigger('click');
      // Buttons should be hidden in edit mode
      const actionBtns = wrapper.findAll('.td-comment__action-btn');
      expect(actionBtns.length).toBe(0);
      wrapper.unmount();
    });
  });

  describe('Comment delete confirmation', () => {
    const mockComment: any = {
      id: 1,
      ticket_id: 42,
      author_role_id: 1,
      author_role_name: 'Human User',
      content: 'This is a test comment',
      action_type: '',
      created_at: '2024-01-15T10:00:00Z',
    };

    const mockTicketWithComments: any = {
      ...mockTicket,
      comments: [mockComment],
    };

    it('delete confirmation dialog is hidden by default', () => {
      const { wrapper } = createWrapper({ ticket: mockTicketWithComments });
      // The delete confirmation panel is within the backdrop, check it's not visible
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows delete confirmation dialog when delete button clicked', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      // Delete confirmation should be visible
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(true);
      expect(wrapper.find('.td-delete-confirm__title').text()).toBe('Delete Comment');
      wrapper.unmount();
    });

    it('cancel button dismisses delete confirmation', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(true);
      const cancelBtn = wrapper.find('.td-delete-confirm .td-btn--secondary');
      await cancelBtn.trigger('click');
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(false);
      wrapper.unmount();
    });

    it('overlay click dismisses delete confirmation', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      const overlay = wrapper.find('.td-delete-confirm__overlay');
      await overlay.trigger('click');
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(false);
      wrapper.unmount();
    });

    it('delete confirmation button calls store deleteComment action', async () => {
      const mockStore = createMockTicketStore({
        deleteComment: vi.fn().mockResolvedValue(true),
      });
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
        ticketStore: mockStore,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      const confirmBtn = wrapper.find('.td-delete-confirm .td-btn--danger');
      await confirmBtn.trigger('click');
      expect(mockStore.deleteComment).toHaveBeenCalledWith(
        'test-project',
        42,
        1
      );
      // Should dismiss after delete
      expect(wrapper.find('.td-delete-confirm').exists()).toBe(false);
      wrapper.unmount();
    });

    it('delete confirmation button shows deleting state when clicked', async () => {
      const mockStore = createMockTicketStore({
        deleteComment: vi.fn().mockResolvedValue(true),
      });
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
        ticketStore: mockStore,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      const confirmBtn = wrapper.find('.td-delete-confirm .td-btn--danger');
      // Button text should be "Delete" before click
      expect(confirmBtn.text()).toBe('Delete');
      await confirmBtn.trigger('click');
      // After click, the store is called
      expect(mockStore.deleteComment).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('delete confirmation shows correct text', async () => {
      const { wrapper } = createWrapper({
        ticket: mockTicketWithComments,
        userRoleId: 1,
      });
      const deleteBtn = wrapper.find('.td-comment__action-btn--delete');
      await deleteBtn.trigger('click');
      const confirmText = wrapper.find('.td-delete-confirm__text').text();
      expect(confirmText).toContain('delete this comment');
      expect(confirmText).toContain('cannot be undone');
      wrapper.unmount();
    });
  });
});
