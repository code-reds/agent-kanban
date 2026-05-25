import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import WorkflowSettings from '@/components/settings/WorkflowSettings.vue';
import * as apiModule from '@/api';

vi.mock('@/api', () => ({
  createTransition: vi.fn(),
  deleteTransition: vi.fn(),
  updateTransition: vi.fn(),
}));

import * as api from '@/api';

const mockProject = {
  id: 1,
  name: 'Test Project',
  slug: 'test',
  description: 'A test project',
  created_at: '2024-01-01',
  columns: [
    { id: 1, name: 'To Do', slug: 'todo', order: 1, is_default: 1, project_id: 1 },
    { id: 2, name: 'In Progress', slug: 'in-progress', order: 2, is_default: 0, project_id: 1 },
    { id: 3, name: 'Done', slug: 'done', order: 3, is_default: 0, project_id: 1 },
  ],
  roles: [
    { id: 1, name: 'Admin', access_level: 'admin', description: 'Administrator' },
    { id: 2, name: 'Developer', access_level: 'developer', description: 'Developer' },
    { id: 3, name: 'Viewer', access_level: 'viewer', description: 'Viewer' },
  ],
  workflows: [
    {
      id: 1,
      column_from: 1,
      column_to: 2,
      project_id: 1,
      requires_comment: 1,
      entire_ticket_group: true,
      allowed_role_ids: '1,2',
    },
    {
      id: 2,
      column_from: 2,
      column_to: 3,
      project_id: 1,
      requires_comment: 0,
      entire_ticket_group: false,
      allowed_role_ids: undefined,
    },
  ],
  access_rules: [],
};

const mockRoles = [
  { id: 1, name: 'Admin', access_level: 'admin', description: 'Administrator' },
  { id: 2, name: 'Developer', access_level: 'developer', description: 'Developer' },
  { id: 3, name: 'Viewer', access_level: 'viewer', description: 'Viewer' },
];

function createWrapper() {
  setActivePinia(createPinia());
  const wrapper = mount(WorkflowSettings, {
    props: {
      project: mockProject,
      projectSlug: 'test-project',
      roles: mockRoles,
    },
  });
  return wrapper;
}

describe('WorkflowSettings - Edit Modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders Edit button on each transition row', () => {
    const wrapper = createWrapper();
    const editButtons = wrapper.findAll('.edit-btn');
    expect(editButtons).toHaveLength(2);
    expect(editButtons[0].text()).toBe('Edit');
    expect(editButtons[1].text()).toBe('Edit');
    wrapper.unmount();
  });

  it('renders Delete button next to Edit button on each row', () => {
    const wrapper = createWrapper();
    const rows = wrapper.findAll('table tbody tr');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row.find('.edit-btn').exists()).toBe(true);
      expect(row.find('.delete-btn').exists()).toBe(true);
    });
    wrapper.unmount();
  });

  it('openEditTransitionModal pre-fills form correctly with boolean values', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(1);
    await editBtn?.trigger('click');
    await flushPromises();

    // Second transition has requires_comment: 0, entire_ticket_group: false
    const checkboxes = wrapper.findAll('.modal-overlay input[type="checkbox"]');
    expect(checkboxes[0].element.checked).toBe(false);
    expect(checkboxes[1].element.checked).toBe(false);
    wrapper.unmount();
  });

  it('openEditTransitionModal pre-fills form correctly with numeric values', async () => {
    const wrapper = createWrapper();
    // First transition has requires_comment: 1, entire_ticket_group: true
    const editBtns = wrapper.findAll('.edit-btn');
    await editBtns[0]?.trigger('click');
    await flushPromises();

    const checkboxes = wrapper.findAll('.modal-overlay input[type="checkbox"]');
    expect(checkboxes[0].element.checked).toBe(true); // requires_comment
    expect(checkboxes[1].element.checked).toBe(true); // entire_ticket_group
    wrapper.unmount();
  });

  it('openEditTransitionModal pre-fills selected role IDs from allowed_role_ids', async () => {
    const wrapper = createWrapper();
    // First transition has allowed_role_ids: '1,2'
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Check that the role picker button shows 2 selected
    const editRolePickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    expect(editRolePickerBtn.text()).toContain('2 selected');
    wrapper.unmount();
  });

  it('openEditTransitionModal shows the modal overlay', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.find('.modal h3').text()).toContain('To Do');
    expect(wrapper.find('.modal h3').text()).toContain('In Progress');
    wrapper.unmount();
  });

  it('toggleEditRole adds a role when not selected', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Open the role picker
    const pickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    await pickerBtn.trigger('click');
    await flushPromises();

    // Click on the Viewer role (id=3, not in '1,2')
    const viewerOption = wrapper.findAll('.modal-overlay .role-option').at(2);
    await viewerOption?.trigger('click');
    await flushPromises();

    expect(pickerBtn.text()).toContain('3 selected');
    wrapper.unmount();
  });

  it('toggleEditRole removes a role when already selected', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Open the role picker
    const pickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    await pickerBtn.trigger('click');
    await flushPromises();

    // Click on Admin role (id=1, already selected)
    const adminOption = wrapper.findAll('.modal-overlay .role-option').at(0);
    await adminOption?.trigger('click');
    await flushPromises();

    expect(pickerBtn.text()).toContain('1 selected');
    wrapper.unmount();
  });

  it('handleSaveEdit sends correct PATCH payload', async () => {
    (api.updateTransition as any).mockResolvedValue({ success: true });

    const wrapper = createWrapper();
    // First transition has requires_comment: 1, entire_ticket_group: true, allowed_role_ids: '1,2'
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Uncheck requires_comment (change from true to false)
    const requiresCommentCheckbox = wrapper.findAll('.modal-overlay input[type="checkbox"]').at(0);
    await requiresCommentCheckbox.element.checked; // read current
    await requiresCommentCheckbox.setValue(false);
    await requiresCommentCheckbox.trigger('click');
    await flushPromises();

    // Save
    const saveBtn = wrapper.find('.modal-overlay .btn--primary');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(api.updateTransition).toHaveBeenCalledWith('test-project', 1, {
      requires_comment: false,
      allowed_roles: [1, 2],
    });
    wrapper.unmount();
  });

  it('handleSaveEdit emits transition-updated on success', async () => {
    (api.updateTransition as any).mockResolvedValue({ success: true });

    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const saveBtn = wrapper.find('.modal-overlay .btn--primary');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('transition-updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('handleSaveEdit shows error message when API fails', async () => {
    (api.updateTransition as any).mockResolvedValue({ success: false, error: 'Validation failed' });

    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const saveBtn = wrapper.find('.modal-overlay .btn--primary');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(wrapper.find('.error-message').exists()).toBe(true);
    expect(wrapper.find('.error-message').text()).toContain('Validation failed');
    // Modal should still be open
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    wrapper.unmount();
  });

  it('handleSaveEdit shows saving state on Save button', async () => {
    (api.updateTransition as any).mockResolvedValue(
      new Promise((resolve) => setTimeout(() => resolve({ success: true }), 50))
    );

    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    const saveBtn = wrapper.find('.modal-overlay .btn--primary');
    await saveBtn.trigger('click');
    await flushPromises();

    expect(saveBtn.text()).toContain('Saving...');
    expect(saveBtn.attributes('disabled')).toBeDefined();

    // Wait for the mock to resolve
    await new Promise((r) => setTimeout(r, 100));
    await flushPromises();
    wrapper.unmount();
  });

  it('Cancel button closes the modal', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    // Find the Cancel button by text content to avoid matching the Save button
    const cancelBtn = wrapper.find('.modal-overlay').findAll('button').find((b) => b.text() === 'Cancel');
    await cancelBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('Closing modal discards changes', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    // Change requires_comment from true to false
    const requiresCommentCheckbox = wrapper.findAll('.modal-overlay input[type="checkbox"]').at(0);
    await requiresCommentCheckbox.setValue(false);
    await requiresCommentCheckbox.trigger('click');
    await flushPromises();

    // Cancel
    const cancelBtn = wrapper.find('.modal-overlay').find('.btn');
    await cancelBtn.trigger('click');
    await flushPromises();

    // Open the same transition again - should have original values
    const editBtn2 = wrapper.findAll('.edit-btn').at(0);
    await editBtn2?.trigger('click');
    await flushPromises();

    const checkboxes = wrapper.findAll('.modal-overlay input[type="checkbox"]');
    expect(checkboxes[0].element.checked).toBe(true); // should be back to original true
    expect(checkboxes[1].element.checked).toBe(true); // entire_ticket_group was true
    wrapper.unmount();
  });

  it('clicking overlay closes the modal', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    await wrapper.find('.modal-overlay').trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('edit modal is not visible when no transitions are opened', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows "Select roles" when allowed_role_ids is undefined', async () => {
    const wrapper = createWrapper();
    // Second transition has allowed_role_ids: undefined
    const editBtn = wrapper.findAll('.edit-btn').at(1);
    await editBtn?.trigger('click');
    await flushPromises();

    const pickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    expect(pickerBtn.text()).toContain('Select roles');
    wrapper.unmount();
  });

  it('toggleEditRole in edit modal works independently from add form role picker', async () => {
    const wrapper = createWrapper();

    // Open edit modal for second transition (no roles selected initially)
    const editBtn = wrapper.findAll('.edit-btn').at(1);
    await editBtn?.trigger('click');
    await flushPromises();

    // Open the edit role picker
    const editPickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    await editPickerBtn.trigger('click');
    await flushPromises();

    // Select Admin role in the edit modal
    const adminOption = wrapper.findAll('.modal-overlay .role-option').at(0);
    await adminOption?.trigger('click');
    await flushPromises();

    expect(editPickerBtn.text()).toContain('1 selected');
    wrapper.unmount();
  });

  it('opens edit role picker from edit modal', async () => {
    const wrapper = createWrapper();
    const editBtn = wrapper.findAll('.edit-btn').at(0);
    await editBtn?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay .role-dropdown').exists()).toBe(false);

    const pickerBtn = wrapper.find('.modal-overlay .role-multiselect .btn');
    await pickerBtn.trigger('click');
    await flushPromises();

    expect(wrapper.find('.modal-overlay .role-dropdown').exists()).toBe(true);

    // Click outside to close
    await wrapper.find('.modal-overlay .role-dropdown').trigger('click.outside');
    await flushPromises();

    expect(wrapper.find('.modal-overlay .role-dropdown').exists()).toBe(false);
    wrapper.unmount();
  });

  it('save button is disabled when modal is not open', async () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    wrapper.unmount();
  });
});
