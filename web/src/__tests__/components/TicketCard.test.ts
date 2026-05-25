import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TicketCard from '@/components/kanban/TicketCard.vue';

vi.mock('@/stores/tickets', () => ({
  useTicketStore: vi.fn(() => ({
    blockingStatus: {},
  })),
}));

beforeEach(() => {
  setActivePinia(createPinia());
});

const mockColumn = {
  id: 1,
  name: 'ToDo',
  slug: 'todo',
  position: 1,
  order: 1,
  is_default: 0,
  project_id: 1,
};

const mockTicket = {
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
};

describe('TicketCard', () => {
  it('renders ticket title', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    expect(wrapper.text()).toContain('Fix login bug');
    expect(wrapper.find('.ticket-card__title').text()).toBe('Fix login bug');
  });

  it('renders priority badge with correct color', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    const priorityLabel = wrapper.find('.ticket-card__priority-label');
    expect(priorityLabel.text()).toBe('Urgent');
  });

  it('renders labels from JSON array', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    const labels = wrapper.findAll('.ticket-card__label');
    expect(labels).toHaveLength(2);
    expect(labels[0].text()).toBe('bug');
    expect(labels[1].text()).toBe('auth');
  });

  it('does not render labels element when no labels', () => {
    const ticketNoLabels = { ...mockTicket, labels: '' };
    const wrapper = mount(TicketCard, {
      props: { ticket: ticketNoLabels, column: mockColumn },
    });
    const labels = wrapper.findAll('.ticket-card__label');
    expect(labels).toHaveLength(0);
  });

  it('does not render labels element when labels is empty array', () => {
    const ticketEmptyLabels = { ...mockTicket, labels: '[]' };
    const wrapper = mount(TicketCard, {
      props: { ticket: ticketEmptyLabels, column: mockColumn },
    });
    const labelsDiv = wrapper.find('.ticket-card__labels');
    expect(labelsDiv.exists()).toBe(false);
  });

  it('emits select event with ticket id when clicked', async () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });

    await wrapper.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([mockTicket]);
  });

  it('renders created date', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    const dateEl = wrapper.find('.ticket-card__date');
    expect(dateEl.exists()).toBe(true);
  });

  it('handles different priority levels', () => {
    const priorities = [
      { priority: 1, label: 'Urgent' },
      { priority: 2, label: 'High' },
      { priority: 3, label: 'Medium' },
      { priority: 4, label: 'Low' },
      { priority: 5, label: 'Trivial' },
    ];

    for (const p of priorities) {
      const ticket = { ...mockTicket, priority: p.priority };
      const wrapper = mount(TicketCard, {
        props: { ticket, column: mockColumn },
      });
      expect(wrapper.find('.ticket-card__priority-label').text()).toBe(p.label);
    }
  });

  it('handles invalid date gracefully', () => {
    const ticket = { ...mockTicket, created_at: 'invalid-date' };
    const wrapper = mount(TicketCard, {
      props: { ticket, column: mockColumn },
    });
    const dateEl = wrapper.find('.ticket-card__date');
    expect(dateEl.exists()).toBe(true);
  });

  it('handles invalid JSON labels gracefully', () => {
    const ticket = { ...mockTicket, labels: 'not-json' };
    const wrapper = mount(TicketCard, {
      props: { ticket, column: mockColumn },
    });
    const labels = wrapper.findAll('.ticket-card__label');
    expect(labels).toHaveLength(0);
  });

  it('has ticket-card class', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    expect(wrapper.find('.ticket-card').exists()).toBe(true);
  });

  it('applies correct priority color for High priority', () => {
    const ticket = { ...mockTicket, priority: 2 };
    const wrapper = mount(TicketCard, {
      props: { ticket, column: mockColumn },
    });
    const priorityLabel = wrapper.find('.ticket-card__priority-label');
    expect(priorityLabel.text()).toBe('High');
  });

  // ID display tests are in TicketCardIdDisplay.test.ts (comprehensive)
  it('renders ticket ID with # prefix', () => {
    const wrapper = mount(TicketCard, {
      props: { ticket: mockTicket, column: mockColumn },
    });
    const idEl = wrapper.find('.ticket-card__id');
    expect(idEl.exists()).toBe(true);
    expect(idEl.text()).toBe('#42');
  });

  it('parent card with collapse icon shows priority color on bar', () => {
    const ticket = { ...mockTicket, priority: 3, id: 99 };
    const wrapper = mount(TicketCard, {
      props: { ticket, column: mockColumn, isParentCard: true, isExpanded: true },
    });
    // The priority bar should use the medium priority color, not the gray border color
    const priorityBar = wrapper.find('.ticket-card__priority');
    const bgColor = priorityBar.element.style.backgroundColor;
    expect(bgColor).toContain('var(--priority-medium');
    // And it should have the toggle icon
    expect(wrapper.find('.ticket-card__toggle').exists()).toBe(true);
  });

  it('parent card with High priority shows warning color', () => {
    const ticket = { ...mockTicket, priority: 2, id: 100 };
    const wrapper = mount(TicketCard, {
      props: { ticket, column: mockColumn, isParentCard: true, isExpanded: true },
    });
    const priorityBar = wrapper.find('.ticket-card__priority');
    const bgColor = priorityBar.element.style.backgroundColor;
    // High priority uses var(--color-warning)
    expect(bgColor).toContain('var(--color-warning)');
  });
});
