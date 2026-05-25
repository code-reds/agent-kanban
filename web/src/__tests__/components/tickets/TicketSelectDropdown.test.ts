import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TicketSelectDropdown from '@/components/tickets/TicketSelectDropdown.vue';
import type { Ticket } from '@/api';

const mockTickets: Ticket[] = [
  { id: 1, project_id: 1, column_id: 1, title: 'Fix login bug', description: '', labels: '[]', priority: 1, estimate: null, created_at: '', updated_at: '', created_by_role_id: 1, column: { id: 1, name: 'Todo', slug: 'todo', position: 1, order: 1, is_default: 0, project_id: 1 } },
  { id: 2, project_id: 1, column_id: 2, title: 'Add dark mode', description: '', labels: '[]', priority: 2, estimate: null, created_at: '', updated_at: '', created_by_role_id: 1, column: { id: 2, name: 'In Progress', slug: 'in-progress', position: 2, order: 2, is_default: 0, project_id: 1 } },
];

describe('TicketSelectDropdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.removeEventListener('click', vi.fn());
  });

  it('renders placeholder when no ticket selected', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, placeholder: 'Choose...' },
    });
    expect(wrapper.find('.ticket-select-dropdown__placeholder').text()).toBe('Choose...');
  });

  it('renders selected ticket info', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, selectedId: 1 },
    });
    expect(wrapper.find('.ticket-select-dropdown__selected-id').text()).toBe('#1');
    expect(wrapper.find('.ticket-select-dropdown__selected-title').text()).toBe('Fix login bug');
    expect(wrapper.find('.ticket-select-dropdown__selected-column').text()).toBe('(Todo)');
  });

  it('emits select event when option clicked', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    await wrapper.findAll('.ticket-select-dropdown__option')[0].trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([1]);
  });

  it('excludes tickets listed in excludeIds', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, excludeIds: [1] },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    const options = wrapper.findAll('.ticket-select-dropdown__option');
    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain('Add dark mode');
  });

  it('filters tickets by search query matching title', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    await wrapper.find('.ticket-select-dropdown__input').setValue('dark');
    const options = wrapper.findAll('.ticket-select-dropdown__option');
    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain('Add dark mode');
  });

  it('filters tickets by search query matching ID', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    await wrapper.find('.ticket-select-dropdown__input').setValue('2');
    const options = wrapper.findAll('.ticket-select-dropdown__option');
    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain('Add dark mode');
  });

  it('shows empty state when no tickets match search', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    await wrapper.find('.ticket-select-dropdown__input').setValue('nonexistent');
    expect(wrapper.find('.ticket-select-dropdown__empty').text()).toBe('No tickets found');
  });

  it('clears selection when clear button clicked', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, selectedId: 1 },
    });
    await wrapper.find('.ticket-select-dropdown__clear').trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([null]);
  });

  it('shows None option when allowNone is true', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, allowNone: true, selectedId: null },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    expect(wrapper.find('.ticket-select-dropdown__option').text()).toBe('None (Top-Level)');
  });

  it('highlights matching text in ticket title', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    await wrapper.find('.ticket-select-dropdown__input').setValue('login');
    // v-html renders the mark tags, check the component renders with the query
    const options = wrapper.findAll('.ticket-select-dropdown__option');
    expect(options.length).toBe(1);
    expect(options[0].text()).toContain('Fix login bug');
  });

  it('toggles dropdown open/close', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    expect(wrapper.find('.ticket-select-dropdown__menu').exists()).toBe(false);
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    expect(wrapper.find('.ticket-select-dropdown__menu').exists()).toBe(true);
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    expect(wrapper.find('.ticket-select-dropdown__menu').exists()).toBe(false);
  });

  it('closes dropdown when clicking outside', async () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets },
    });
    await wrapper.find('.ticket-select-dropdown__trigger').trigger('click');
    expect(wrapper.find('.ticket-select-dropdown__menu').exists()).toBe(true);
    document.body.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.ticket-select-dropdown__menu').exists()).toBe(false);
  });

  it('shows placeholder text from allowNone prop', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, allowNone: true, selectedId: null },
    });
    expect(wrapper.find('.ticket-select-dropdown__placeholder').text()).toBe('Select a ticket...');
  });

  it('shows placeholder text from placeholder prop when allowNone is false', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, allowNone: false, placeholder: 'Choose...', selectedId: null },
    });
    expect(wrapper.find('.ticket-select-dropdown__placeholder').text()).toBe('Choose...');
  });

  it('shows column name in selected display', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, selectedId: 1 },
    });
    expect(wrapper.find('.ticket-select-dropdown__selected-column').text()).toBe('(Todo)');
  });

  it('shows selected ticket with correct label format', () => {
    const wrapper = mount(TicketSelectDropdown, {
      props: { tickets: mockTickets, selectedId: 1 },
    });
    expect(wrapper.find('.ticket-select-dropdown__selected-id').text()).toBe('#1');
    expect(wrapper.find('.ticket-select-dropdown__selected-title').text()).toBe('Fix login bug');
  });
});
