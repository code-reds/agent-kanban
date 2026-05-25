<template>
  <div class="card">
    <h2>Ticket Access Rules</h2>
    <p class="section-description">
      Define which roles can create, edit, and delete tickets in each column. Changes are applied in bulk when you click Save.
    </p>

    <div v-if="accessRulesLoading" class="loading-state">
      <p>Loading access rules...</p>
    </div>
    <template v-else>
      <div v-if="projectColumns.length === 0" class="empty-state">No columns defined</div>
      <template v-else>
        <div v-if="accessRules.length === 0" class="empty-state">No access rules defined</div>
        <template v-else>
          <div class="access-rules-group" v-for="col in projectColumns" :key="col.id">
            <h3 class="access-rules-group-title">
              {{ col.name }}
              <span class="column-slug">({{ col.slug }})</span>
            </h3>
            <table class="access-rules-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Create</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="role in roles" :key="role.id">
                  <td>{{ role.name }}</td>
                  <td v-for="action in ['create', 'edit', 'delete']" :key="action">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        :checked="hasAccessRule(col.id, role.id, action)"
                        @change="toggleAccessRule(col, role, action)"
                      />
                    </label>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="access-rules-actions">
            <button class="btn btn--primary" @click="handleSaveAccessRules" :disabled="accessRulesLoading">
              {{ accessRulesLoading ? 'Saving...' : 'Save Access Rules' }}
            </button>
            <button class="cancel-btn" @click="loadAccessRules">Discard Changes</button>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getAccessRules, updateAccessRules, getGlobalAccessRules, updateGlobalAccessRules } from '../../api';
import type { ProjectWithRelations, Role, EnrichedAccessRule, Column } from '../../api';
import type { GlobalAccessRule, GlobalColumn } from '../../api';

const props = defineProps<{
  mode?: 'project' | 'global';
  project?: ProjectWithRelations;
  projectSlug: string;
  roles: Role[];
  globalAccessRules?: GlobalAccessRule[];
  globalColumns?: GlobalColumn[];
}>();

const emit = defineEmits<{
  'rules-updated': [];
}>();

// Access rules
const accessRules = ref<EnrichedAccessRule[]>([]);
const accessRulesLoading = ref(false);

// Columns to display based on mode
const projectColumns = computed<Column[]>(() => {
  if (props.mode === 'global') {
    return props.globalColumns as unknown as Column[];
  }
  return props.project?.columns ?? [];
});

function hasAccessRule(columnId: number, roleId: number, action: string): boolean {
  return accessRules.value.some(
    (r) => r.column_id === columnId && r.role_id === roleId && r.action_type === action
  );
}

function toggleAccessRule(col: Column, role: Role, action: string): void {
  const idx = accessRules.value.findIndex(
    (r) => r.column_id === col.id && r.role_id === role.id && r.action_type === action
  );
  if (idx > -1) {
    accessRules.value.splice(idx, 1);
  } else {
    accessRules.value.push({
      id: 0,
      column_id: col.id,
      column_slug: col.slug,
      column_name: col.name,
      role_id: role.id,
      role_name: role.name,
      action_type: action,
    });
  }
}

async function loadAccessRules(): Promise<void> {
  accessRulesLoading.value = true;
  try {
    if (props.mode === 'global') {
      const res = await getGlobalAccessRules();
      if (res.success && res.data) {
        accessRules.value = res.data as unknown as EnrichedAccessRule[];
      }
    } else {
      const res = await getAccessRules(props.projectSlug);
      if (res.success && res.data) {
        accessRules.value = [...res.data];
      }
    }
  } catch {
    // Error handled
  } finally {
    accessRulesLoading.value = false;
  }
}

async function handleSaveAccessRules(): Promise<void> {
  accessRulesLoading.value = true;
  try {
    const payload = {
      rules: accessRules.value.map((r) => ({
        column_id: r.column_id,
        role_id: r.role_id,
        action_type: r.action_type,
      })),
    };

    if (props.mode === 'global') {
      const res = await updateGlobalAccessRules(payload);
      if (res.success && res.data) {
        accessRules.value = res.data as unknown as EnrichedAccessRule[];
        emit('rules-updated');
      }
    } else {
      const res = await updateAccessRules(props.projectSlug, payload);
      if (res.success && res.data) {
        accessRules.value = [...res.data];
        emit('rules-updated');
      }
    }
  } catch {
    // Error handled
  } finally {
    accessRulesLoading.value = false;
  }
}

onMounted(() => {
  loadAccessRules();
});
</script>

<style scoped>
/* Access rules */
.access-rules-group {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--color-border);
}

.access-rules-group:last-of-type {
  border-bottom: none;
}

.access-rules-group-title {
  margin: 0 0 12px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.column-slug {
  font-weight: 400;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.access-rules-table {
  margin-bottom: 16px;
}

.access-rules-table th {
  text-align: center;
  width: 33%;
}

.access-rules-table th:first-child,
.access-rules-table td:first-child {
  text-align: left;
}

.access-rules-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
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
