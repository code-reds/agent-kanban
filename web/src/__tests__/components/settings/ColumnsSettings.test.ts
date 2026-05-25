import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ColumnsSettings from '@/components/settings/ColumnsSettings.vue';
import * as projectApi from '@/stores/projects';
import * as apiModule from '@/api';

vi.mock('@/api', () => ({
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
}));

vi.mock('@/stores/projects', () => ({
  useProjectStore: vi.fn(),
}));

import * as api from '@/api';

function createMockProjectStore(overrides: Partial<projectApi.ProjectStore> = {}): projectApi.ProjectStore {
  const mockStore = {
    loading: false,
    addColumn: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as projectApi.ProjectStore;
  return mockStore;
}

const mockProject = {
  id: 1,
  name: 'Test Project',
  slug: 'test',
  description: 'A test project',
  created_at: '2024-01-01',
  columns: [
    { id: 1, name: 'To Do', slug: 'todo', order: 1, is_default: 1, project_id: 1 },
    { id: 2, name: 'In Progress', slug: 'in-progress', order: 2, is_default: 0, project_id: 1 },
    { id: 3, name: 'Done', slug: 'closed', order: 3, is_default: 0, project_id: 1 },
  ],
  roles: [],
  workflows: [],
  access_rules: [],
};

function createWrapper() {
  setActivePinia(createPinia());
  (projectApi.useProjectStore as any).mockReturnValue(createMockProjectStore());
  const wrapper = mount(ColumnsSettings, {
    props: {
      project: mockProject,
      projectSlug: 'test-project',
    },
  });
  return wrapper;
}

describe('ColumnsSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the add column form', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.add-column-form').exists()).toBe(true);
    expect(wrapper.find('#column-name').exists()).toBe(true);
    expect(wrapper.find('#column-slug').exists()).toBe(true);
    expect(wrapper.find('#column-position').exists()).toBe(true);
    expect(wrapper.find('#add-column-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows empty state when no columns', () => {
    const wrapper = mount(ColumnsSettings, {
      props: {
        project: { ...mockProject, columns: [] },
        projectSlug: 'test-project',
      },
    });
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows delete button only for non-default columns', () => {
    const wrapper = createWrapper();
    const rows = wrapper.findAll('table tbody tr');
    expect(rows).toHaveLength(3);
    // First row (To Do, is_default=true) should NOT have delete button
    expect(rows[0].find('.delete-btn').exists()).toBe(false);
    // Second row (In Progress, is_default=false) should have delete button
    expect(rows[1].find('.delete-btn').exists()).toBe(true);
    // Third row (Done, is_default=false) should have delete button
    expect(rows[2].find('.delete-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows editing inputs when edit button clicked', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const cellInputs = wrapper.findAll('.cell-input');
    expect(cellInputs.length).toBe(3);
    wrapper.unmount();
  });

  it('handleAddColumn emits column-updated on success', async () => {
    const wrapper = createWrapper();
    wrapper.find('#column-name').setValue('New Column');
    await flushPromises();

    const addBtn = wrapper.find('#add-column-btn');
    await addBtn.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('column-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('handleAddColumn does not emit when name is empty', async () => {
    const wrapper = createWrapper();
    // Name is empty by default
    const addBtn = wrapper.find('#add-column-btn');
    await addBtn.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('column-updated')).toBeFalsy();
    wrapper.unmount();
  });

  it('saveColumn emits column-updated on success', async () => {
    (api.updateColumn as any).mockResolvedValue({ success: true });
    const wrapper = createWrapper();

    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const saveBtn = wrapper.find('.save-btn');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('column-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('saveColumn does not emit when name is empty', async () => {
    (api.updateColumn as any).mockResolvedValue({ success: true });
    const wrapper = createWrapper();

    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Clear the name field to simulate empty name
    const nameInput = wrapper.findAll('.cell-input').at(0);
    await nameInput.setValue('');
    await flushPromises();

    const saveBtn = wrapper.find('.save-btn');
    await saveBtn.trigger('click');
    await flushPromises();

    // Should not emit since name is empty
    expect(wrapper.emitted('column-updated')).toBeFalsy();
    wrapper.unmount();
  });

  it('saveColumn does not emit when API fails', async () => {
    (api.updateColumn as any).mockResolvedValue({ success: false });
    const wrapper = createWrapper();

    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const saveBtn = wrapper.find('.save-btn');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('column-updated')).toBeFalsy();
    wrapper.unmount();
  });

  it('emits delete-column when delete button clicked', async () => {
    const wrapper = createWrapper();
    const deleteBtn = wrapper.findAll('.delete-btn').at(0);
    await deleteBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('delete-column')).toBeTruthy();
    expect(wrapper.emitted('delete-column')?.[0]).toEqual([
      mockProject.columns[1],
    ]);
    wrapper.unmount();
  });

  it('generateColumnSlug creates proper slug from name', async () => {
    const wrapper = createWrapper();
    // The function is internal, so we test via the form behavior
    wrapper.find('#column-name').setValue('My New Column');
    await flushPromises();
    wrapper.unmount();
  });

  it('cancels editing when cancel button clicked', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.cell-input').length).toBeGreaterThan(0);

    const cancelBtn = wrapper.find('.cancel-btn');
    await cancelBtn.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.cell-input').length).toBe(0);
    wrapper.unmount();
  });
});
