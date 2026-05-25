<template>
  <div class="card">
    <h2>Roles</h2>
    <p v-if="mode === 'global'" class="section-description">
      Global roles define access levels for agents and users. Changes to role names, descriptions, and default columns apply globally.
    </p>
    <p v-else class="section-description">
      Roles define access levels for agents and users. Only the Default Column can be customized per project.
    </p>

    <!-- Add Role form (global mode only) -->
    <AddRoleForm
      v-if="mode === 'global' && isAdminOrFull"
      @created="handleRoleCreated"
    />

    <div v-if="rolesLoading || rolesColumnsLoading" class="loading-state">
      <p>Loading roles...</p>
    </div>

    <template v-else>
      <div v-if="roles.length === 0" class="empty-state">No roles defined</div>

      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Default Column</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="role in roles"
            :key="role.id"
            :class="{ 'row-overridden': isRoleOverridden(role.id) }"
          >
            <!-- Name cell -->
            <td>
              <input
                v-if="mode === 'global' && editingRole?.id === role.id"
                id="role-name-edit"
                v-model="editingRole.name"
                ref="roleEditInput"
                class="cell-input"
                @keyup.enter="saveRole(role)"
                @keyup.escape="cancelEditRole"
              />
              <span v-else>{{ role.name }}</span>
            </td>

            <!-- Description cell -->
            <td>
              <input
                v-if="mode === 'global' && editingRole?.id === role.id"
                v-model="editingRole.description"
                class="cell-input cell-input--wide"
                placeholder="Description"
                @keyup.enter="saveRole(role)"
                @keyup.escape="cancelEditRole"
              />
              <span v-else>{{ role.description || '-' }}</span>
            </td>

            <!-- Default Column cell -->
            <td class="column-cell">
              <select
                :value="getColumnValue(role.id)"
                @change="handleColumnChange(role.id, $event)"
                :disabled="savingRole !== null"
                class="column-select"
              >
                <option value="" disabled>Select column</option>
                <option value="__none__">None</option>
                <option
                  v-for="col in columns"
                  :key="col.id"
                  :value="col.id"
                >
                  {{ col.name }}
                </option>
              </select>
            </td>

            <!-- Actions cell -->
            <td class="actions-cell">
              <template v-if="editingRole?.id === role.id">
                <button class="save-btn" @click="saveRole(role)">Save</button>
                <button class="cancel-btn" @click="cancelEditRole">Cancel</button>
              </template>
              <template v-else>
                <button class="edit-btn" v-if="mode === 'global'" @click="startEditRole(role)">Edit</button>
                <button
                  v-if="mode === 'global' && isAdminOrFull && role.id !== 1"
                  class="delete-btn"
                  @click="showDeleteConfirmation(role)"
                >
                  Delete
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div v-if="saveMessage" :class="['message', saveSuccess ? 'success-message' : 'error-message']">
        {{ saveMessage }}
      </div>
    </template>

    <!-- Delete confirmation modal (global mode only) -->
    <div v-if="mode === 'global' && showDeleteModal" class="modal-overlay" @click.self="closeDeleteModal">
      <div class="modal">
        <h2>Confirm Deletion</h2>
        <p>
          Are you sure you want to delete role "<strong>{{ deletingRole?.name }}</strong>"?
        </p>
        <p class="modal-warning">This action cannot be undone and will affect all projects.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="closeDeleteModal">Cancel</button>
          <button
            class="danger-btn"
            @click="confirmDeleteRole"
            :disabled="deletingRole === null"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import { getRoles, updateRole, getGlobalRoles, updateGlobalRole, deleteRole } from '../../api';
import { useGlobalSettingsStore } from '../../stores/global-settings';
import type { Role, Column, RolesColumn } from '../../api';
import AddRoleForm from './AddRoleForm.vue';

export interface UserRole {
  id: number;
  name: string;
}

const props = defineProps<{
  mode?: 'project' | 'global';
  projectSlug: string;
  columns?: Column[];
  userRole?: UserRole | null;
}>();

const emit = defineEmits<{
  'roles-updated': [];
}>();

const store = useGlobalSettingsStore();

// Determine if current user has admin or full access
const isAdminOrFull = computed(() => {
  const currentRole = props.userRole;
  if (!currentRole) return true; // Default to true if no role info available
  return currentRole.name === 'Human User' || currentRole.name === 'AI teamleader';
});

// Role editing
const roles = ref<Role[]>([]);
const rolesLoading = ref(false);
const editingRole = ref<Role | null>(null);
const roleEditInput = ref<HTMLInputElement | null>(null);

// Unified roles_columns state (works for both global and project modes)
const rolesColumns = ref<RolesColumn[]>([]);
const rolesColumnsLoading = ref(false);
const error = ref<string | null>(null);
const saveMessage = ref('');
const saveSuccess = ref(true);
const savingRole = ref<number | null>(null);

// Delete role confirmation
const showDeleteModal = ref(false);
const deletingRole = ref<Role | null>(null);

// --- Role operations ---
async function loadRoles(): Promise<void> {
  rolesLoading.value = true;
  try {
    const res = props.mode === 'global'
      ? await getGlobalRoles()
      : await getRoles(props.projectSlug);
    if (res.success && res.data) {
      roles.value = res.data;
    }
  } catch {
    // Error handled
  } finally {
    rolesLoading.value = false;
  }
}

function startEditRole(role: Role): void {
  editingRole.value = { ...role };
  nextTick(() => {
    if (typeof roleEditInput.value?.focus === 'function') {
      roleEditInput.value.focus();
    }
  });
}

function cancelEditRole(): void {
  editingRole.value = null;
}

async function saveRole(role: Role): Promise<void> {
  if (!editingRole.value?.name?.trim()) return;
  const res = props.mode === 'global'
    ? await updateGlobalRole(role.id, {
        name: editingRole.value.name.trim(),
        description: editingRole.value.description,
      })
    : await updateRole(props.projectSlug, role.id, {
        name: editingRole.value.name.trim(),
        description: editingRole.value.description,
      });
  if (res.success) {
    await loadRoles();
    editingRole.value = null;
    emit('roles-updated');
  }
}

// --- Role creation handler ---
async function handleRoleCreated(_role: Role): Promise<void> {
  await loadRoles();
  emit('roles-updated');
  saveMessage.value = 'Role created successfully';
  saveSuccess.value = true;
  setTimeout(() => {
    saveMessage.value = '';
  }, 3000);
}

// --- Role deletion (global mode only) ---
function showDeleteConfirmation(role: Role): void {
  deletingRole.value = role;
  showDeleteModal.value = true;
}

function closeDeleteModal(): void {
  showDeleteModal.value = false;
  deletingRole.value = null;
}

async function confirmDeleteRole(): Promise<void> {
  if (!deletingRole.value) return;
  const roleId = deletingRole.value.id;
  const roleName = deletingRole.value.name;

  try {
    const res = await deleteRole(roleId);
    if (res.success) {
      await loadRoles();
      emit('roles-updated');
      saveMessage.value = `Role '${roleName}' deleted successfully`;
      saveSuccess.value = true;
    } else if (res.error) {
      // Show specific error messages
      if (res.error.toLowerCase().includes('has') && res.error.toLowerCase().includes('ticket')) {
        error.value = `Cannot delete role '${roleName}': it has ${res.error.match(/(\d+)/)?.[0] || '?'} ticket(s) created by it. Please reassign those tickets first.`;
      } else {
        error.value = res.error;
      }
      saveMessage.value = res.error;
      saveSuccess.value = false;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete role';
    error.value = message;
    saveMessage.value = message;
    saveSuccess.value = false;
  } finally {
    closeDeleteModal();
  }
}

// --- Roles_Columns operations (both global and project modes) ---

/**
 * Load roles_columns mappings on mount.
 * Uses global store for both global and project modes.
 */
async function loadRolesColumns(): Promise<void> {
  rolesColumnsLoading.value = true;
  error.value = null;
  try {
    if (props.mode === 'global') {
      await store.loadRolesColumns();
      rolesColumns.value = store.rolesColumns;
    } else {
      await store.loadProjectRolesColumns(props.projectSlug);
      rolesColumns.value = store.projectRolesColumns;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    error.value = message;
  } finally {
    rolesColumnsLoading.value = false;
  }
}

/**
 * Get the current column value for a role.
 * Returns the column_id if set (project-specific or global), otherwise empty.
 */
function getColumnValue(roleId: number): string {
  const mapping = rolesColumns.value.find(
    (m) => m.role_id === roleId
  );
  return mapping?.column_id != null ? String(mapping.column_id) : '__none__';
}

/**
 * Check if a role has a project-specific override (only relevant in project mode).
 */
function isRoleOverridden(roleId: number): boolean {
  return rolesColumns.value.some((m) => m.role_id === roleId);
}

/**
 * Handle column change for a role — auto-save immediately.
 */
async function handleColumnChange(roleId: number, event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  // "__none__" is a sentinel value meaning the user explicitly chose "None"
  const columnId = target.value === '__none__' ? null : (target.value ? Number(target.value) : null);

  savingRole.value = roleId;
  saveMessage.value = '';
  error.value = null;

  try {
    let result: RolesColumn | null;
    if (props.mode === 'global') {
      result = await store.upsertGlobalRolesColumn({
        role_id: roleId,
        column_id: columnId,
      });
      if (result) {
        rolesColumns.value = store.rolesColumns;
      }
    } else {
      result = await store.upsertProjectRolesColumn(props.projectSlug, {
        role_id: roleId,
        column_id: columnId,
      });
      if (result) {
        rolesColumns.value = store.projectRolesColumns;
      }
    }

    if (result) {
      saveMessage.value = `Default column updated for role ${roleId}`;
      saveSuccess.value = true;
      emit('roles-updated');
    } else {
      const msg = store.error || 'Failed to update default column';
      error.value = msg;
      saveMessage.value = msg;
      saveSuccess.value = false;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    error.value = message;
    saveMessage.value = message;
    saveSuccess.value = false;
  } finally {
    savingRole.value = null;
  }

  // Clear save message after a delay
  setTimeout(() => {
    saveMessage.value = '';
  }, 3000);
}

onMounted(() => {
  loadRoles();
  loadRolesColumns();
});
</script>

<style scoped>
.section-description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0 0 20px 0;
}

.loading-state p {
  text-align: center;
  color: var(--color-text-secondary);
  padding: 24px 0;
}

.empty-state {
  text-align: center;
  color: var(--color-text-secondary);
  padding: 24px 0;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 10px 16px;
  border-bottom: 2px solid var(--color-border);
}

tbody td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

tbody tr:hover {
  background-color: var(--color-bg);
}

/* Visual indicator for project-specific overrides */
.row-overridden {
  background-color: rgba(59, 130, 246, 0.04);
}

.row-overridden:hover {
  background-color: rgba(59, 130, 246, 0.08);
}

.column-cell {
  max-width: 280px;
  min-width: 180px;
}

.column-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color 0.15s;
}

.column-select:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.column-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.column-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Cell inputs (for role editing - global mode only) */
.cell-input {
  padding: 4px 8px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-surface);
  width: 100%;
}

.cell-input--wide {
  width: 200px;
}

.actions-cell {
  white-space: nowrap;
}

/* Buttons */
.edit-btn,
.save-btn,
.cancel-btn {
  padding: 4px 12px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.edit-btn {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.edit-btn:hover {
  opacity: 0.9;
}

.save-btn {
  background: #16a34a;
  color: #fff;
  border-color: #16a34a;
}

.save-btn:hover {
  opacity: 0.9;
}

.cancel-btn {
  background: transparent;
  color: var(--color-text-secondary);
  border-color: var(--color-border);
  margin-left: 4px;
}

.cancel-btn:hover {
  background: var(--color-bg);
}

.delete-btn {
  background: transparent;
  color: #dc2626;
  border-color: #dc2626;
  margin-left: 4px;
}

.delete-btn:hover {
  background: rgba(220, 38, 38, 0.08);
}

/* Modal styles */
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
  background: var(--color-surface);
  border-radius: 8px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.modal h2 {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.modal p {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.modal-warning {
  color: #dc2626;
  font-weight: 500;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 20px;
}

.danger-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  background: #dc2626;
  border: 1px solid #dc2626;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.danger-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.message {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
}

.success-message {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
}

@media (max-width: 640px) {
  .column-cell {
    max-width: 100%;
  }
}
</style>
