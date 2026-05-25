import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AddRoleForm from '@/components/settings/AddRoleForm.vue';
import * as api from '@/api';

describe('AddRoleForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders add role button when form is not shown', async () => {
    const wrapper = mount(AddRoleForm);
    await flushPromises();

    expect(wrapper.find('.add-role-btn').exists()).toBe(true);
    expect(wrapper.find('.add-role-btn').text()).toContain('+ Add Role');
    expect(wrapper.find('.form-container').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders the form fields when form is shown', async () => {
    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.form-container').exists()).toBe(true);
    expect(wrapper.find('#role-name').exists()).toBe(true);
    expect(wrapper.find('#role-description').exists()).toBe(true);
    expect(wrapper.find('#role-access-level').exists()).toBe(true);
    expect(wrapper.find('.save-btn').exists()).toBe(true);
    expect(wrapper.find('.cancel-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('validates required name field', async () => {
    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    // Fill access level but leave name empty
    wrapper.find('#role-access-level').setValue('write');
    await flushPromises();

    // Submit the form
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.field-error').exists()).toBe(true);
    expect(wrapper.find('.field-error').text()).toContain('Role name is required');
    expect(wrapper.emitted('created')).toBeUndefined();
    wrapper.unmount();
  });

  it('uses default access level when not specified', async () => {
    const mockRole = {
      id: 10,
      name: 'New Role',
      description: '',
    };
    vi.spyOn(api, 'createRole').mockResolvedValue({
      success: true,
      data: mockRole,
    } as any);

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    // Fill name but leave access level at default ('admin')
    wrapper.find('#role-name').setValue('New Role');
    await flushPromises();

    // Submit the form — should succeed with default accessLevel
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.field-error').exists()).toBe(false);
    expect(wrapper.emitted('created')).toBeDefined();
    wrapper.unmount();
  });

  it('calls createRole API on valid submit', async () => {
    const mockRole = {
      id: 10,
      name: 'New Role',
      description: 'A new role',
    };
    vi.spyOn(api, 'createRole').mockResolvedValue({
      success: true,
      data: mockRole,
    } as any);

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-description').setValue('A new role');
    wrapper.find('#role-access-level').setValue('edit');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(api.createRole).toHaveBeenCalledWith({
      name: 'New Role',
      description: 'A new role',
      accessLevel: 'edit',
    });
    wrapper.unmount();
  });

  it('emits created event on success', async () => {
    const mockRole = {
      id: 10,
      name: 'New Role',
      description: 'A new role',
    };
    vi.spyOn(api, 'createRole').mockResolvedValue({
      success: true,
      data: mockRole,
    } as any);

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-description').setValue('A new role');
    wrapper.find('#role-access-level').setValue('edit');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.emitted('created')).toBeTruthy();
    expect(wrapper.emitted('created')?.[0]).toEqual([mockRole]);
    wrapper.unmount();
  });

  it('hides form after successful creation', async () => {
    const mockRole = {
      id: 10,
      name: 'New Role',
      description: 'A new role',
    };
    vi.spyOn(api, 'createRole').mockResolvedValue({
      success: true,
      data: mockRole,
    } as any);

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-description').setValue('A new role');
    wrapper.find('#role-access-level').setValue('edit');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.form-container').exists()).toBe(false);
    expect(wrapper.find('.add-role-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows error message on API failure', async () => {
    vi.spyOn(api, 'createRole').mockResolvedValue({
      success: false,
      error: 'Role already exists',
    } as any);

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('Duplicate Name');
    wrapper.find('#role-access-level').setValue('write');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.field-error').exists()).toBe(true);
    expect(wrapper.find('.field-error').text()).toContain('Role already exists');
    wrapper.unmount();
  });

  it('shows network error as field error', async () => {
    vi.spyOn(api, 'createRole').mockRejectedValue(new Error('Network Error'));

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-access-level').setValue('write');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.field-error').exists()).toBe(true);
    expect(wrapper.find('.field-error').text()).toContain('Network Error');
    wrapper.unmount();
  });

  it('disables inputs while submitting', async () => {
    const mockRole = {
      id: 10,
      name: 'New Role',
      description: 'A new role',
    };
    vi.spyOn(api, 'createRole').mockReturnValue(
      new Promise(() => {}) // Never resolves
    );

    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-access-level').setValue('edit');
    await flushPromises();

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('#role-name').attributes('disabled')).toBeDefined();
    expect(wrapper.find('#role-access-level').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.save-btn').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('resets form on cancel', async () => {
    const wrapper = mount(AddRoleForm);
    await flushPromises();

    wrapper.find('.add-role-btn').trigger('click');
    await flushPromises();

    wrapper.find('#role-name').setValue('New Role');
    wrapper.find('#role-description').setValue('A new role');
    wrapper.find('#role-access-level').setValue('edit');
    await flushPromises();

    wrapper.find('.cancel-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.form-container').exists()).toBe(false);
    expect(wrapper.find('.add-role-btn').exists()).toBe(true);
    wrapper.unmount();
  });
});
