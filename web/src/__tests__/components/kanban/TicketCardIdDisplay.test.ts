import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TicketCard from '@/components/kanban/TicketCard.vue';
import type { Ticket, Column } from '@/api';

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
  name: 'ToDo',
  slug: 'todo',
  order: 1,
  is_default: 0,
  project_id: 1,
};

function createMockTicket(id: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    project_id: 1,
    column_id: 1,
    title: `Ticket ${id}`,
    description: `Description for ticket ${id}`,
    labels: '[]',
    priority: 3,
    estimate: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    created_by_role_id: 1,
    comments: [],
    parent_id: null,
    column: null,
    column_slug: undefined,
    column_name: undefined,
    ...overrides,
  };
}

function mountTicketCard(ticket: Ticket, column: Column, extraProps: Record<string, unknown> = {}): VueWrapper {
  return mount(TicketCard, {
    props: { ticket, column, ...extraProps },
  });
}

describe('TicketCard — ID Display Integration', () => {
  describe('Scenario 1: ID element renders with correct format', () => {
    it('renders .ticket-card__id element with # prefix and ticket id', () => {
      const ticket = createMockTicket(42);
      const wrapper = mountTicketCard(ticket, mockColumn);
      const idEl = wrapper.find('.ticket-card__id');

      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#42');
    });

    it('reflects the exact value of the ticket.id prop', () => {
      const ticket = createMockTicket(999);
      const wrapper = mountTicketCard(ticket, mockColumn);
      const idEl = wrapper.find('.ticket-card__id');

      expect(idEl.text()).toBe('#999');
      // Ensure it's the string "#<id>" format, not just the number
      expect(idEl.text().startsWith('#')).toBe(true);
      expect(idEl.text().slice(1)).toBe(String(ticket.id));
    });
  });

  describe('Scenario 2: Different ticket IDs render correctly across magnitudes', () => {
    const testCases = [
      { id: 1, expected: '#1' },
      { id: 9, expected: '#9' },
      { id: 10, expected: '#10' },
      { id: 42, expected: '#42' },
      { id: 100, expected: '#100' },
      { id: 999, expected: '#999' },
      { id: 1000, expected: '#1000' },
      { id: 9999, expected: '#9999' },
    ];

    it.each(testCases)('renders ticket ID #${id} as "${expected}"', ({ id, expected }) => {
      const ticket = createMockTicket(id);
      const wrapper = mountTicketCard(ticket, mockColumn);
      const idEl = wrapper.find('.ticket-card__id');

      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe(expected);
    });
  });

  describe('Scenario 3: Ticket ID appears above the title in DOM order', () => {
    it('.ticket-card__id element comes before .ticket-card__title in the DOM', () => {
      const ticket = createMockTicket(7);
      const wrapper = mountTicketCard(ticket, mockColumn);

      // Use a single querySelectorAll with combined selector to get elements in DOM order
      const elements: HTMLElement[] = Array.from(
        wrapper.element.querySelectorAll('.ticket-card__id, .ticket-card__title'),
      );

      expect(elements.length).toBeGreaterThanOrEqual(2);
      // First matching element should be the ID, second should be the title
      expect(elements[0].classList.contains('ticket-card__id')).toBe(true);
      expect(elements[1].classList.contains('ticket-card__title')).toBe(true);
    });

    it('preserves DOM order for every ticket ID magnitude', () => {
      const ticket = createMockTicket(123);
      const wrapper = mountTicketCard(ticket, mockColumn);

      const elements: HTMLElement[] = Array.from(
        wrapper.element.querySelectorAll('.ticket-card__id, .ticket-card__title'),
      );
      const idFound = elements.some((el: HTMLElement) => el.classList.contains('ticket-card__id'));
      const titleFound = elements.some((el: HTMLElement) => el.classList.contains('ticket-card__title'));

      expect(idFound).toBe(true);
      expect(titleFound).toBe(true);

      // The first matching element should be the ID, then the title
      expect(elements[0].classList.contains('ticket-card__id')).toBe(true);
      expect(elements[1].classList.contains('ticket-card__title')).toBe(true);
    });
  });

  describe('Scenario 4: Ticket ID renders consistently across multiple cards', () => {
    it('each mounted TicketCard shows its own correct ID', () => {
      const tickets = [
        createMockTicket(1, { title: 'First ticket' }),
        createMockTicket(2, { title: 'Second ticket' }),
        createMockTicket(3, { title: 'Third ticket' }),
      ];

      const wrappers = tickets.map((ticket) => mountTicketCard(ticket, mockColumn));

      wrappers.forEach((wrapper, index) => {
        const idEl = wrapper.find('.ticket-card__id');
        expect(idEl.exists()).toBe(true);
        expect(idEl.text()).toBe(`#${tickets[index].id}`);
      });
    });

    it('simulates a Kanban column with 5 tickets showing distinct IDs', () => {
      const columnTickets = [
        createMockTicket(10, { title: 'Setup project' }),
        createMockTicket(11, { title: 'Install dependencies' }),
        createMockTicket(12, { title: 'Configure database' }),
        createMockTicket(13, { title: 'Write migrations' }),
        createMockTicket(14, { title: 'Seed test data' }),
      ];

      const wrappers = columnTickets.map((ticket) => mountTicketCard(ticket, mockColumn));

      const allIds = wrappers.map((w) => w.find('.ticket-card__id').text());

      // Each card should have a unique, correct ID
      expect(allIds).toEqual(['#10', '#11', '#12', '#13', '#14']);

      // No ID should be duplicated
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it('ID updates reactively when ticket prop changes', async () => {
      const ticket = createMockTicket(5);
      const wrapper = mountTicketCard(ticket, mockColumn);

      expect(wrapper.find('.ticket-card__id').text()).toBe('#5');

      // Simulate prop change
      await wrapper.setProps({ ticket: createMockTicket(20) });

      expect(wrapper.find('.ticket-card__id').text()).toBe('#20');
    });
  });

  describe('Scenario 5: Ticket ID is not duplicated', () => {
    it('exactly one .ticket-card__id element per TicketCard instance', () => {
      const ticket = createMockTicket(50);
      const wrapper = mountTicketCard(ticket, mockColumn);

      const idElements = wrapper.findAll('.ticket-card__id');
      expect(idElements).toHaveLength(1);
    });

    it('no duplicate ID even with complex ticket data', () => {
      const ticket = createMockTicket(777, {
        title: 'Complex <ticket> with & labels: ["bug", "feature"]',
        description: 'A description with <html> and & special chars',
        labels: '["bug", "feature", "urgent"]',
        priority: 1,
      });
      const wrapper = mountTicketCard(ticket, mockColumn);

      const idElements = wrapper.findAll('.ticket-card__id');
      expect(idElements).toHaveLength(1);
      expect(idElements[0].text()).toBe('#777');
    });

    it('multiple rendered cards each have exactly one ID', () => {
      const tickets = [
        createMockTicket(1),
        createMockTicket(2),
        createMockTicket(3),
      ];

      const wrappers = tickets.map((ticket) => mountTicketCard(ticket, mockColumn));

      wrappers.forEach((wrapper) => {
        expect(wrapper.findAll('.ticket-card__id')).toHaveLength(1);
      });
    });
  });

  describe('Scenario 6: Ticket ID is auto-escaped (XSS-safe)', () => {
    it('ticket ID renders correctly even when title has special HTML characters', () => {
      const ticket = createMockTicket(100, {
        title: '<script>alert("xss")</script>',
        description: '<img onerror="alert(1)" src=x>',
        labels: '["<script>alert(1)</script>"]',
      });
      const wrapper = mountTicketCard(ticket, mockColumn);

      // The ID should still render correctly since it's a number interpolated in the template
      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#100');

      // The ID element should not contain any HTML from the title
      expect(idEl.html()).not.toContain('script');
      expect(idEl.html()).not.toContain('alert');
    });

    it('ticket ID renders correctly with HTML entities in title', () => {
      const ticket = createMockTicket(42, {
        title: '&lt;div&gt; &amp; &quot;quotes&quot;',
      });
      const wrapper = mountTicketCard(ticket, mockColumn);

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#42');
    });

    it('ticket ID renders correctly with JavaScript-like strings in title', () => {
      const ticket = createMockTicket(99, {
        title: 'if (dangerous) { alert(1); }',
      });
      const wrapper = mountTicketCard(ticket, mockColumn);

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#99');
      // ID should not be affected by JS-like content in title
      expect(idEl.html()).not.toContain('alert');
      expect(idEl.html()).not.toContain('dangerous');
    });

    it('ID element text is a plain string, not raw HTML', () => {
      const ticket = createMockTicket(55, {
        title: '<b>Bold</b> <i>Italic</i>',
      });
      const wrapper = mountTicketCard(ticket, mockColumn);

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.text()).toBe('#55');
      // text() should return escaped/plain text, never raw HTML
      expect(idEl.html()).toContain('#55');
    });
  });

  describe('Scenario 7: Ticket ID renders in compact mode', () => {
    it('.ticket-card__id element exists in compact variant', () => {
      const ticket = createMockTicket(21);
      const wrapper = mountTicketCard(ticket, mockColumn, { compact: true });

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#21');
    });

    it('compact card shows correct ID for various ticket IDs', () => {
      const tickets = [
        createMockTicket(1),
        createMockTicket(500),
        createMockTicket(8888),
      ];

      tickets.forEach((ticket) => {
        const wrapper = mountTicketCard(ticket, mockColumn, { compact: true });
        const idEl = wrapper.find('.ticket-card__id');
        expect(idEl.exists()).toBe(true);
        expect(idEl.text()).toBe(`#${ticket.id}`);
      });
    });

    it('compact card still has ID before title in DOM order', () => {
      const ticket = createMockTicket(15);
      const wrapper = mountTicketCard(ticket, mockColumn, { compact: true });

      const elements = wrapper.element.querySelectorAll('.ticket-card__id, .ticket-card__title');
      expect(elements[0].classList.contains('ticket-card__id')).toBe(true);
      expect(elements[1].classList.contains('ticket-card__title')).toBe(true);
    });
  });

  describe('Scenario 8: Ticket ID renders in child mode', () => {
    it('.ticket-card__id element exists when isChild is true', () => {
      const ticket = createMockTicket(30);
      const wrapper = mountTicketCard(ticket, mockColumn, { isChild: true });

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#30');
    });

    it('child card with compact mode still shows ID', () => {
      const ticket = createMockTicket(45);
      const wrapper = mountTicketCard(ticket, mockColumn, { isChild: true, compact: true });

      const idEl = wrapper.find('.ticket-card__id');
      expect(idEl.exists()).toBe(true);
      expect(idEl.text()).toBe('#45');
    });

    it('child card has correct CSS class applied alongside ID', () => {
      const ticket = createMockTicket(60);
      const wrapper = mountTicketCard(ticket, mockColumn, { isChild: true });

      expect(wrapper.find('.ticket-card--child').exists()).toBe(true);
      expect(wrapper.find('.ticket-card__id').exists()).toBe(true);
      expect(wrapper.find('.ticket-card__id').text()).toBe('#60');
    });
  });
});
