<template>
  <div class="card global-roles-columns-settings">
    <h2>Roles — Default Columns</h2>
    <p class="section-description">
      Set the default Kanban column for each role. New projects will inherit these mappings.
    </p>

    <div v-if="rolesColumnsLoading" class="loading-state">
      <p>Loading role column mappings...</p>
    </div>

    <template v-else>
      <div v-if="rolesColumns.length === 0" class="empty-state">
        No role column mappings defined
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Role</th>
            <th>Default Column</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mapping in rolesColumns" :key="mapping.role_id">
            <td>{{ mapping.role_name }}</td>
            <td class="column-cell">
              <select
                :value="String(mapping.column_id ?? '')"
                @change="handleColumnChange(mapping.role_id, $event)"
                :disabled="savingRole !== null"
                class="column-select"
              >
                <option value="" disabled>Select column</option>
                <option
                  v-for="col in columns"
                  :key="col.id"
                  :value="col.id"
                >
                  {{ col.name }}
                </option>
              </select>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useGlobalSettingsStore } from '../../stores/global-settings';
import type { GlobalColumn, RolesColumn } from '../../api';

const props = defineProps<{
  columns: GlobalColumn[];
}>();

const emit = defineEmits<{
  'columns-updated': [];
}>();

const store = useGlobalSettingsStore();

const rolesColumns = ref<RolesColumn[]>([]);
const rolesColumnsLoading = ref(false);
const error = ref<string | null>(null);
const saveMessage = ref('');
const saveSuccess = ref(true);
const savingRole = ref<number | null>(null);

/**
 * Load roles_columns on mount from the store.
 */
async function loadRolesColumns(): Promise<void> {
  rolesColumnsLoading.value = true;
  error.value = null;
  try {
    await store.loadRolesColumns();
    rolesColumns.value = store.rolesColumns;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    error.value = message;
  } finally {
    rolesColumnsLoading.value = false;
  }
}

/**
 * Handle column change for a role — auto-save immediately.
 */
async function handleColumnChange(roleId: number, event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const columnId = target.value ? Number(target.value) : null;

  savingRole.value = roleId;
  saveMessage.value = '';
  error.value = null;

  try {
    const result = await store.upsertGlobalRolesColumn({
      role_id: roleId,
      column_id: columnId,
    });

    if (result) {
      rolesColumns.value = store.rolesColumns;
      saveMessage.value = `Default column updated for ${result.role_name}`;
      saveSuccess.value = true;
      emit('columns-updated');
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

.column-cell {
  max-width: 280px;
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
