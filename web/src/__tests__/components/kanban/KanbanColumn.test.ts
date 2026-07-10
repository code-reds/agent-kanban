import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import KanbanColumn from '@/components/kanban/KanbanColumn.vue';
import type { Column, Ticket } from '@/api';

vi.mock('@/stores/tickets', () => ({
  useTicketStore: vi.fn(() => ({
    blockingStatus: {},
  })),
}));

beforeEach(() => {
  setActivePinia(createPinia());
});

const mockColumn: Column = {
  id: 1,
  name: 'Todo',
  slug: 'todo',
  position: 1,
  order: 1,
  is_default: 0,
  project_id: 1,
};

const mockTicket: Ticket = {
  id: 1,
  project_id: 1,
  column_id: 1,
  title: 'Test Ticket',
  description: 'Test description',
  labels: '[]',
  priority: 3,
  estimate: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  created_by_role_id: 1,
  comments: [],
};

function createWrapper({
  column,
  tickets,
  crossColumnChildrenIds,
}: {
  column?: Column;
  tickets?: Ticket[];
  crossColumnChildrenIds?: Set<number>;
} = {}) {
  return mount(KanbanColumn, {
    props: {
      column: column || mockColumn,
      tickets: tickets || [],
      crossColumnChildrenIds: crossColumnChildrenIds || new Set<number>(),
    },
  });
}

describe('KanbanColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders column name', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column__name').text()).toBe('Todo');
    wrapper.unmount();
  });

  it('renders ticket count', () => {
    const tickets = [mockTicket, { ...mockTicket, id: 2, title: 'Ticket 2' }];
    const wrapper = createWrapper({ tickets });
    expect(wrapper.find('.kanban-column__count').text()).toBe('2');
    wrapper.unmount();
  });

  it('shows 0 when no tickets', () => {
    const wrapper = createWrapper({ tickets: [] });
    expect(wrapper.find('.kanban-column__count').text()).toBe('0');
    wrapper.unmount();
  });

  it('includes child tickets in the count for same-column children', () => {
    const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
    const childTicket1 = { ...mockTicket, id: 2, title: 'Child 1', column_id: 1, parent_id: 1 };
    const childTicket2 = { ...mockTicket, id: 3, title: 'Child 2', column_id: 1, parent_id: 1 };
    const tickets = [parentTicket, childTicket1, childTicket2];
    const wrapper = createWrapper({ tickets });
    // 3 tickets total, 2 same-column children (included), 0 cross-column children
    // Count should be 3 (all tickets)
    expect(wrapper.find('.kanban-column__count').text()).toBe('3');
    wrapper.unmount();
  });

  it('excludes cross-column children from the count', () => {
    const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
    const childTicket1 = { ...mockTicket, id: 2, title: 'Child 1', column_id: 2, parent_id: 1 };
    const childTicket2 = { ...mockTicket, id: 3, title: 'Child 2', column_id: 1, parent_id: 1 };
    // Only parent and same-column child are in this column's tickets;
    // cross-column child is in another column's tickets
    const tickets = [parentTicket, childTicket2];
    const crossColChildIds = new Set<number>([2]);
    // crossColumnParentMap tells us the parent of the cross-column child
    const crossColumnParentMap = { 2: parentTicket };
    const wrapper = mount(KanbanColumn, {
      props: {
        column: mockColumn,
        tickets,
        crossColumnChildrenIds: crossColChildIds,
        crossColumnParentMap,
      },
    });
    // 2 tickets total, 0 cross-column children in this column, 0 orphans
    // Count should be 2 (parent + same-column child)
    expect(wrapper.find('.kanban-column__count').text()).toBe('2');
    wrapper.unmount();
  });

  it('correctly counts mixed same-column and cross-column children', () => {
    const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
    const sameColChild = { ...mockTicket, id: 2, title: 'Same Col Child', column_id: 1, parent_id: 1 };
    const crossColChild = { ...mockTicket, id: 3, title: 'Cross Col Child', column_id: 3, parent_id: 1 };
    // Only parent and same-col child in this column's tickets
    const tickets = [parentTicket, sameColChild];
    const crossColChildIds = new Set<number>([3]);
    const crossColumnParentMap = { 3: parentTicket };
    const wrapper = mount(KanbanColumn, {
      props: {
        column: mockColumn,
        tickets,
        crossColumnChildrenIds: crossColChildIds,
        crossColumnParentMap,
      },
    });
    // 2 tickets total, 0 cross-column children in this column, 0 orphans
    // Count should be 2
    expect(wrapper.find('.kanban-column__count').text()).toBe('2');
    wrapper.unmount();
  });

  it('renders ticket cards for each ticket', () => {
    const tickets = [mockTicket, { ...mockTicket, id: 2, title: 'Ticket 2' }];
    const wrapper = createWrapper({ tickets });
    const cards = wrapper.findAllComponents({ name: 'TicketCard' });
    expect(cards).toHaveLength(2);
    wrapper.unmount();
  });

  it('renders add ticket button', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column__add-btn').text()).toContain('+ Add ticket');
    wrapper.unmount();
  });

  it('emits select-ticket event when ticket card clicked', async () => {
    const wrapper = createWrapper({ tickets: [mockTicket] });
    const cards = wrapper.findAllComponents({ name: 'TicketCard' });
    await cards[0].vm.$emit('select', mockTicket);
    expect(wrapper.emitted('selectTicket')).toBeTruthy();
    expect(wrapper.emitted('selectTicket')?.[0]).toEqual([mockTicket]);
    wrapper.unmount();
  });

  it('emits add-ticket event when add button clicked', async () => {
    const wrapper = createWrapper();
    const addBtn = wrapper.find('.kanban-column__add-btn');
    await addBtn.trigger('click');
    expect(wrapper.emitted('addTicket')).toBeTruthy();
    expect(wrapper.emitted('addTicket')?.[0]).toEqual(['todo']);
    wrapper.unmount();
  });

  it('applies drag-over class when dragover event received', async () => {
    const wrapper = createWrapper();
    const columnEl = wrapper.find('.kanban-column');
    await columnEl.trigger('dragover');
    expect(wrapper.classes()).toContain('kanban-column--drag-over');
    wrapper.unmount();
  });

  it('removes drag-over class when dragleave event received', async () => {
    const wrapper = createWrapper();
    await wrapper.find('.kanban-column').trigger('dragover');
    await wrapper.find('.kanban-column').trigger('dragleave');
    expect(wrapper.classes()).not.toContain('kanban-column--drag-over');
    wrapper.unmount();
  });

  it('removes drag-over class when drop event received', async () => {
    const wrapper = createWrapper();
    await wrapper.find('.kanban-column').trigger('dragover');
    await wrapper.find('.kanban-column').trigger('drop');
    expect(wrapper.classes()).not.toContain('kanban-column--drag-over');
    wrapper.unmount();
  });

  it('prevents default on dragover', async () => {
    const preventDefaultSpy = vi.spyOn(Event.prototype, 'preventDefault');
    const wrapper = createWrapper();
    await wrapper.find('.kanban-column').trigger('dragover');
    expect(preventDefaultSpy).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('has kanban-column class', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column').exists()).toBe(true);
    wrapper.unmount();
  });

  it('has kanban-column__header class', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column__header').exists()).toBe(true);
    wrapper.unmount();
  });

  it('has kanban-column__cards class', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column__cards').exists()).toBe(true);
    wrapper.unmount();
  });

  it('has kanban-column__add-area class', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.kanban-column__add-area').exists()).toBe(true);
    wrapper.unmount();
  });

  describe('load-more done button', () => {
    const doneColumn: Column = {
      id: 5,
      name: 'Done',
      slug: 'done',
      position: 5,
      order: 5,
      is_default: 1,
      project_id: 1,
    };

    it('renders load-more button when column is done and hasMoreDone is true', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: true,
          doneCountLoaded: 5,
          doneTotalCount: 15,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Show all tickets (10 more)');
      wrapper.unmount();
    });

    it('does not render load-more button when total done tickets <= 8', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: false,
          doneCountLoaded: 5,
          doneTotalCount: 8,
        },
      });
      expect(wrapper.find('.kanban-column__load-more-btn').exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows Hide older button when showAllDone is true and total > 8', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: false,
          showAllDone: true,
          doneCountLoaded: 5,
          doneTotalCount: 15,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Hide older tickets');
      wrapper.unmount();
    });

    it('shows Show all button when showAllDone is false and total > 8', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: false,
          showAllDone: false,
          doneCountLoaded: 5,
          doneTotalCount: 15,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Show all tickets (10 more)');
      wrapper.unmount();
    });

    it('does not render load-more button for non-done columns', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: mockColumn,
          tickets: [],
          hasMoreDone: true,
          doneCountLoaded: 5,
          doneTotalCount: 15,
        },
      });
      expect(wrapper.find('.kanban-column__load-more-btn').exists()).toBe(false);
      wrapper.unmount();
    });

  describe('cross-column child ticket counters', () => {
    it('counts only the parent when child is in another column', () => {
      // Parent P1 is in column 1, child C1 is in column 2.
      // Parent column (1) should only count the parent itself,
      // not the child that is in a different column.
      const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
      const crossColChild = { ...mockTicket, id: 2, title: 'Cross Col Child', column_id: 2, parent_id: 1 };
      // Only the parent is in this column's tickets; child is in another column
      const tickets = [parentTicket];
      const crossColChildIds = new Set<number>([2]);
      // crossColumnParentMap maps child.id -> parent (set by KanbanBoard)
      const crossColumnParentMap = { 2: parentTicket };
      const wrapper = mount(KanbanColumn, {
        props: {
          column: mockColumn,
          tickets,
          crossColumnChildrenIds: crossColChildIds,
          crossColumnParentMap,
        },
      });
      // Parent only = 1 (child counts in its own column, not parent's)
      expect(wrapper.find('.kanban-column__count').text()).toBe('1');
      wrapper.unmount();
    });

    it('counts cross-column children in their own column', () => {
      // Parent P1 is in column 1, child C1 is in column 2.
      // Column 2 should count the child (even though its parent is in column 1).
      const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
      const crossColChild = { ...mockTicket, id: 2, title: 'Cross Col Child', column_id: 2, parent_id: 1 };
      // Only the child is in this column's tickets; parent is in another column
      const column2 = { ...mockColumn, id: 2, name: 'Todo 2' };
      const tickets = [crossColChild];
      const crossColChildIds = new Set<number>([2]);
      const crossColumnParentMap = { 2: parentTicket };
      const wrapper = mount(KanbanColumn, {
        props: {
          column: column2,
          tickets,
          crossColumnChildrenIds: crossColChildIds,
          crossColumnParentMap,
        },
      });
      // Child counts in its own column = 1
      expect(wrapper.find('.kanban-column__count').text()).toBe('1');
      wrapper.unmount();
    });

    it('counts only the parent when multiple children are in other columns', () => {
      const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
      const child1 = { ...mockTicket, id: 2, title: 'Child 1', column_id: 2, parent_id: 1 };
      const child2 = { ...mockTicket, id: 3, title: 'Child 2', column_id: 3, parent_id: 1 };
      const tickets = [parentTicket];
      const crossColChildIds = new Set<number>([2, 3]);
      const crossColumnParentMap = { 2: parentTicket, 3: parentTicket };
      const wrapper = mount(KanbanColumn, {
        props: {
          column: mockColumn,
          tickets,
          crossColumnChildrenIds: crossColChildIds,
          crossColumnParentMap,
        },
      });
      // Parent only = 1 (children count in their own columns)
      expect(wrapper.find('.kanban-column__count').text()).toBe('1');
      wrapper.unmount();
    });

    it('handles parent with both same-column and cross-column children', () => {
      const parentTicket = { ...mockTicket, id: 1, title: 'Parent Ticket', column_id: 1 };
      const sameColChild = { ...mockTicket, id: 2, title: 'Same Col Child', column_id: 1, parent_id: 1 };
      const crossColChild = { ...mockTicket, id: 3, title: 'Cross Col Child', column_id: 2, parent_id: 1 };
      // Parent + same-col child are in props.tickets; cross-col child is NOT
      const tickets = [parentTicket, sameColChild];
      const crossColChildIds = new Set<number>([3]);
      const crossColumnParentMap = { 3: parentTicket };
      const wrapper = mount(KanbanColumn, {
        props: {
          column: mockColumn,
          tickets,
          crossColumnChildrenIds: crossColChildIds,
          crossColumnParentMap,
        },
      });
      // Parent (1) + same-col child (1) = 2 (cross-col child counts in its own column)
      expect(wrapper.find('.kanban-column__count').text()).toBe('2');
      wrapper.unmount();
    });
  });

  it('emits loadMoreDone event when button is clicked', async () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: true,
          doneCountLoaded: 5,
          doneTotalCount: 15,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      await btn.trigger('click');
      expect(wrapper.emitted('loadMoreDone')).toBeTruthy();
      wrapper.unmount();
    });
    it('shows 0 more when doneCountLoaded > doneTotalCount', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: true,
          doneCountLoaded: 20,
          doneTotalCount: 15,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      expect(btn.text()).toBe('Show all tickets (0 more)');
      wrapper.unmount();
    });

    it('does not show button when doneTotalCount equals the limit of 8', () => {
      const wrapper = mount(KanbanColumn, {
        props: {
          column: doneColumn,
          tickets: [],
          hasMoreDone: true,
          showAllDone: false,
          doneCountLoaded: 8,
          doneTotalCount: 8,
        },
      });
      const btn = wrapper.find('.kanban-column__load-more-btn');
      expect(btn.exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
