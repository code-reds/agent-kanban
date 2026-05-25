<template>
  <div class="card">
    <h2>Workflow Transitions</h2>

    <div class="add-transition-form">
      <h3>Add Transition</h3>
      <div class="modal-form">
        <div class="form-row">
          <div class="form-group">
            <label for="transition-from">From</label>
            <select id="transition-from" v-model="newTransition.from">
              <option :value="null" disabled>Starting column</option>
              <option v-for="col in availableColumns" :key="col.id" :value="col.id">
                {{ col.name }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label for="transition-to">To</label>
            <select id="transition-to" v-model="newTransition.to">
              <option :value="null" disabled>Target column</option>
              <option v-for="col in availableColumns" :key="col.id" :value="col.id">
                {{ col.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="newTransition.requiresComment" />
              Requires comment
            </label>
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="newTransition.entireTicketGroup" />
              Requires entire ticket group
            </label>
          </div>
          <div class="form-group">
            <label>Allowed Roles</label>
            <div class="role-multiselect">
              <button type="button" class="btn btn--sm" @click="showRolePicker = !showRolePicker">
                {{ selectedRoleIds.length ? `${selectedRoleIds.length} selected` : 'Select roles' }}
              </button>
              <div v-if="showRolePicker" class="role-dropdown" @click.outside="showRolePicker = false">
                <div
                  v-for="role in roles"
                  :key="role.id"
                  class="role-option"
                  :class="{ selected: selectedRoleIds.includes(role.id) }"
                  @click="toggleRole(role.id)"
                >
                  <input type="checkbox" :checked="selectedRoleIds.includes(role.id)" />
                  <span>{{ role.name }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button
        class="btn btn--primary"
        @click="handleAddTransition"
        :disabled="!newTransition.from || !newTransition.to"
      >
        Add Transition
      </button>
    </div>

    <div v-if="displayWorkflows.length === 0" class="empty-state">No workflows defined</div>
    <table v-else>
      <thead>
        <tr>
          <th>From</th>
          <th>To</th>
          <th>Comment Required</th>
          <th>Entire Ticket Group</th>
          <th>Allowed Roles</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="wf in displayWorkflows" :key="wf.id">
          <td>{{ getColumnName(wf.column_from) }}</td>
          <td>{{ getColumnName(wf.column_to) }}</td>
          <td>{{ wf.requires_comment ? 'Yes' : 'No' }}</td>
          <td>{{ wf.entire_ticket_group ? 'Yes' : 'No' }}</td>
          <td>{{ getRoleNames((wf as GlobalWorkflowTransition).allowed_role_ids) }}</td>
          <td class="actions-cell">
            <button
              class="edit-btn"
              @click="openEditTransitionModal(wf)"
            >
              Edit
            </button>
            <button
              class="delete-btn"
              @click="handleDeleteWorkflow(wf)"
            >
              Delete
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Edit Transition Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click="closeEditModal">
      <div class="modal" @click.stop>
        <h3>Edit Transition: {{ editingTransition ? getColumnName(editingTransition.column_from) + ' → ' + getColumnName(editingTransition.column_to) : '' }}</h3>

        <div class="modal-scrollable">
          <div class="modal-form">
            <div class="form-group checkbox-group">
              <label>
                <input type="checkbox" v-model="editForm.requiresComment" />
                Requires comment
              </label>
            </div>

            <div class="form-group checkbox-group">
              <label>
                <input type="checkbox" v-model="editForm.entireTicketGroup" />
                Requires entire ticket group
              </label>
            </div>

            <div class="form-group">
              <label>Allowed Roles</label>
              <div class="role-multiselect">
                <button type="button" class="btn btn--sm" @click="showEditRolePicker = !showEditRolePicker">
                  {{ editSelectedRoleIds.length ? `${editSelectedRoleIds.length} selected` : 'Select roles' }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="editError" class="error-message">{{ editError }}</div>

          <div class="modal-actions">
            <button class="btn" @click="closeEditModal">Cancel</button>
            <button class="btn btn--primary" @click="handleSaveEdit" :disabled="!editTransitionId || savingEdit">
              {{ savingEdit ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Role dropdown positioned outside scrollable so it is not clipped by overflow -->
        <div v-if="showEditRolePicker" class="edit-role-dropdown-wrapper" @click.outside="showEditRolePicker = false">
          <div class="role-dropdown">
            <div
              v-for="role in roles"
              :key="role.id"
              class="role-option"
              :class="{ selected: editSelectedRoleIds.includes(role.id) }"
              @click="toggleEditRole(role.id)"
            >
              <input type="checkbox" :checked="editSelectedRoleIds.includes(role.id)" />
              <span>{{ role.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  createTransition,
  deleteTransition,
  updateTransition,
  createGlobalWorkflow,
  deleteGlobalWorkflow,
  updateGlobalWorkflow,
} from '../../api';
import type { ProjectWithRelations, Workflow, Role, UpdateTransitionPayload } from '../../api';
import type { GlobalWorkflowTransition, GlobalColumn } from '../../api';

const props = defineProps<{
  mode?: 'project' | 'global';
  project?: ProjectWithRelations;
  projectSlug: string;
  roles: Role[];
  globalWorkflows?: GlobalWorkflowTransition[];
  globalColumns?: GlobalColumn[];
}>();

const emit = defineEmits<{
  'transition-added': [];
  'transition-updated': [];
  'delete-transition': [workflow: Workflow | GlobalWorkflowTransition];
}>();

// Workflow transition form
const newTransition = ref({ from: null as number | null, to: null as number | null, requiresComment: false, entireTicketGroup: false });
const selectedRoleIds = ref<number[]>([]);
const showRolePicker = ref(false);

// Edit modal state
const showEditModal = ref(false);
const editTransitionId = ref<number | null>(null);
const editingTransition = ref<Workflow | GlobalWorkflowTransition | null>(null);
const editForm = ref({ requiresComment: false, entireTicketGroup: false });
const editSelectedRoleIds = ref<number[]>([]);
const showEditRolePicker = ref(false);
const editError = ref<string>('');
const savingEdit = ref(false);

// Available columns based on mode
const availableColumns = computed(
  () => {
    if (props.mode === 'global') {
      return (props.globalColumns ?? []) as never[];
    }
    // Project mode: use project columns
    return props.project?.columns ?? [];
  }
);

// Display workflows based on mode
const displayWorkflows = computed(() => {
  if (props.mode === 'global') {
    return props.globalWorkflows ?? [];
  }
  return props.project?.workflows ?? [];
});

function getColumnName(columnId: number | null): string {
  if (columnId === null) return '(initial)';

  // Try global columns first
  if (props.mode === 'global' && props.globalColumns) {
    const col = props.globalColumns.find((c) => c.id === columnId);
    if (col) return col.name;
  }

  // Fall back to project columns
  if (props.project) {
    const col = props.project.columns.find((c) => c.id === columnId);
    if (col) return col.name;
  }

  return `Column #${columnId}`;
}

function getRoleNames(allowedRoleIds: string | undefined): string {
  if (!allowedRoleIds) return 'No roles assigned';
  const ids = allowedRoleIds.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
  if (ids.length === 0) return 'No roles assigned';
  return ids.map((id: number) => {
    const role = props.roles.find((r) => r.id === id);
    return role?.name ?? `Role #${id}`;
  }).join(', ') || 'No roles assigned';
}

function toggleRole(roleId: number): void {
  const idx = selectedRoleIds.value.indexOf(roleId);
  if (idx > -1) {
    selectedRoleIds.value.splice(idx, 1);
  } else {
    selectedRoleIds.value.push(roleId);
  }
}

async function handleAddTransition(): Promise<void> {
  if (!newTransition.value.from || !newTransition.value.to) return;

  if (props.mode === 'global') {
    const res = await createGlobalWorkflow({
      column_from: newTransition.value.from,
      column_to: newTransition.value.to,
      requires_comment: newTransition.value.requiresComment,
      entire_ticket_group: newTransition.value.entireTicketGroup,
      allowed_roles: selectedRoleIds.value.length > 0 ? selectedRoleIds.value : undefined,
    });
    if (res.success && res.data) {
      newTransition.value = { from: null, to: null, requiresComment: false, entireTicketGroup: false };
      selectedRoleIds.value = [];
      emit('transition-added');
    }
  } else {
    const res = await createTransition(props.projectSlug, {
      column_from: newTransition.value.from,
      column_to: newTransition.value.to,
      requires_comment: newTransition.value.requiresComment,
      entire_ticket_group: newTransition.value.entireTicketGroup,
      allowed_roles: selectedRoleIds.value,
    });
    if (res.success) {
      newTransition.value = { from: null, to: null, requiresComment: false, entireTicketGroup: false };
      selectedRoleIds.value = [];
      emit('transition-added');
    }
  }
}

async function handleDeleteWorkflow(wf: Workflow | GlobalWorkflowTransition): Promise<void> {
  if (props.mode === 'global') {
    try {
      const res = await deleteGlobalWorkflow(wf.id);
      if (res.success) {
        emit('transition-added');
      }
    } catch {
      // Error handled
    }
  } else {
    emit('delete-transition', wf);
  }
}

// Edit transition modal handlers
function openEditTransitionModal(wf: Workflow | GlobalWorkflowTransition): void {
  editingTransition.value = wf;
  editTransitionId.value = wf.id;
  editForm.value = {
    requiresComment: wf.requires_comment === 1 || wf.requires_comment === true,
    entireTicketGroup: wf.entire_ticket_group === 1 || wf.entire_ticket_group === true,
  };
  // Parse allowed_role_ids (comma-separated string from API)
  const allowedRoleIdsStr = (wf as GlobalWorkflowTransition).allowed_role_ids;
  editSelectedRoleIds.value = allowedRoleIdsStr
    ? allowedRoleIdsStr.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
    : [];
  editError.value = '';
  showEditModal.value = true;
}

function closeEditModal(): void {
  showEditModal.value = false;
  editTransitionId.value = null;
  editingTransition.value = null;
  editSelectedRoleIds.value = [];
  editError.value = '';
  savingEdit.value = false;
}

function toggleEditRole(roleId: number): void {
  const idx = editSelectedRoleIds.value.indexOf(roleId);
  if (idx > -1) {
    editSelectedRoleIds.value.splice(idx, 1);
  } else {
    editSelectedRoleIds.value.push(roleId);
  }
}

async function handleSaveEdit(): Promise<void> {
  if (!editTransitionId.value) return;

  savingEdit.value = true;
  editError.value = '';

  // Build payload with only changed fields
  const changes: Partial<UpdateTransitionPayload> = {};
  const oldRequiresComment = editingTransition.value?.requires_comment === 1 || editingTransition.value?.requires_comment === true;
  const oldEntireTicketGroup = editingTransition.value?.entire_ticket_group === 1 || editingTransition.value?.entire_ticket_group === true;

  if (editForm.value.requiresComment !== oldRequiresComment) {
    changes.requires_comment = editForm.value.requiresComment;
  }
  if (editForm.value.entireTicketGroup !== oldEntireTicketGroup) {
    changes.entire_ticket_group = editForm.value.entireTicketGroup;
  }
  // Always include allowed_roles since it's a full replacement
  changes.allowed_roles = editSelectedRoleIds.value;

  if (props.mode === 'global') {
    const res = await updateGlobalWorkflow(editTransitionId.value, {
      requires_comment: editForm.value.requiresComment,
      entire_ticket_group: editForm.value.entireTicketGroup,
      allowed_roles: editSelectedRoleIds.value.length > 0 ? editSelectedRoleIds.value : undefined,
    });
    savingEdit.value = false;

    if (res.success) {
      closeEditModal();
      emit('transition-updated');
    } else {
      editError.value = res.error || 'Failed to update transition';
    }
  } else {
    const res = await updateTransition(props.projectSlug, editTransitionId.value, changes);
    savingEdit.value = false;

    if (res.success) {
      closeEditModal();
      emit('transition-updated');
    } else {
      editError.value = res.error || 'Failed to update transition';
    }
  }
}
</script>

<style scoped>
/* Role multiselect */
.role-multiselect {
  position: relative;
}

.role-multiselect .btn--sm {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.role-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  z-index: 100;
  margin-top: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.role-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text);
}

.role-option:hover {
  background-color: var(--color-bg);
}

.role-option.selected {
  background-color: var(--primary-light, #eff6ff);
}

.role-option input[type="checkbox"] {
  margin: 0;
  flex: none;
  width: auto;
  height: auto;
}

.btn--sm {
  padding: 6px 12px;
  font-size: 13px;
}

/* Modal overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-surface, #fff);
  border-radius: 12px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
  max-height: 80vh;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  position: relative;
}

/* Scrollable content wrapper inside modal — overflow is here, not on the modal,
   so dropdowns/panels can render beyond the modal boundary without being clipped. */
.modal-scrollable {
  overflow-y: auto;
  max-height: calc(80vh - 48px);
}

/* Dropdown wrapper positioned outside modal-scrollable to avoid overflow clipping.
   Positioned absolutely within .modal to align with the role picker area in the form. */
.edit-role-dropdown-wrapper {
  position: absolute;
  top: calc(24px + 48px + 80px);
  left: 24px;
  right: 24px;
  z-index: 100;
}

.modal h3 {
    margin: 0 0 20px;
    font-size: 18px;
    color: var(--color-text);
  }

  /* ========================================
     Form layout: wraps Add Transition form
     and Edit Transition modal content to
     ensure proper left-aligned layout and
     prevent global common.css rules from
     overriding component styles.
     ======================================== */
  .modal-form {
    width: 100%;
  }

  .modal-form .form-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
  }

  .modal-form .form-row .form-group {
    flex: 1;
  }

  .modal-form .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 0;
  }

  .modal-form .form-group label {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    text-transform: none;
    letter-spacing: normal;
    display: block;
  }

  .modal-form .form-group select {
    padding: 8px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 14px;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    cursor: pointer;
  }

  .modal-form .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: normal;
    cursor: pointer;
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 4px;
  }

  .modal-form .form-group.checkbox-group {
    align-items: flex-start;
  }

  .modal-form .checkbox-group input[type="checkbox"] {
    margin: 0;
    width: auto;
    height: auto;
    cursor: pointer;
    flex: none;
  }

  .modal-form .form-group select:focus,
  .modal-form .form-group input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 24px;
  }

/* Error message */
.error-message {
  color: #dc2626;
  font-size: 13px;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
}

/* Actions cell layout */
.actions-cell {
  white-space: nowrap;
}

.actions-cell .edit-btn,
.actions-cell .delete-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  margin-right: 4px;
}

.actions-cell .edit-btn {
  color: #2563eb;
  border-color: #93c5fd;
}

.actions-cell .edit-btn:hover {
  background: #eff6ff;
}

/* Form row */
.form-row {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group.checkbox-group {
  align-items: flex-start;
}

.form-group.checkbox-group input[type="checkbox"] {
  flex: none;
  width: auto;
  height: auto;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.form-group select {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: normal;
  cursor: pointer;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--btn-border, var(--color-border));
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover {
  background-color: var(--btn-hover, var(--color-bg));
}

.btn--primary {
  background-color: var(--color-primary);
  color: #ffffff;
  border-color: var(--color-primary);
}

.btn--primary:hover {
  background-color: var(--btn-primary-hover, #2563eb);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
