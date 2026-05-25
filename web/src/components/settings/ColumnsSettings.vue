<template>
  <div class="card">
    <h2>Columns</h2>

    <div class="add-column-form">
      <h3>Add Column</h3>
      <div class="form-group">
        <label for="column-name">Name</label>
        <input id="column-name" v-model="newColumnName" type="text" placeholder="Column name" />
      </div>
      <div class="form-group">
        <label for="column-slug">Slug</label>
        <input id="column-slug" v-model="newColumnSlug" type="text" placeholder="column-slug" />
      </div>
      <div class="form-group">
        <label for="column-position">Position</label>
        <input id="column-position" v-model.number="newColumnPosition" type="number" min="0" />
      </div>
      <button id="add-column-btn" class="btn btn--primary" @click="handleAddColumn" :disabled="loading">
        {{ loading ? 'Adding...' : 'Add Column' }}
      </button>
    </div>

    <div v-if="projectColumns.length === 0" class="empty-state">No columns defined</div>
    <table v-else>
      <thead>
        <tr>
          <th>Name</th>
          <th>Slug</th>
          <th>Position</th>
          <th>Default</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="col in projectColumns" :key="col.id">
          <td>
            <input
              v-if="editingColumn?.id === col.id"
              v-model="editingColumn.name"
              ref="columnEditInput"
              class="cell-input"
              @keyup.enter="saveColumn(col)"
              @keyup.escape="cancelEditColumn"
            />
            <span v-else>{{ col.name }}</span>
          </td>
          <td class="mono">
            <input
              v-if="editingColumn?.id === col.id"
              v-model="editingColumn.slug"
              class="cell-input"
            />
            <span v-else>{{ col.slug }}</span>
          </td>
          <td>
            <input
              v-if="editingColumn?.id === col.id"
              v-model.number="editingColumn.order"
              type="number"
              min="0"
              class="cell-input cell-input--number"
            />
            <span v-else>{{ col.order }}</span>
          </td>
          <td>
                <span v-if="col.is_default">Yes</span>
                <span v-else>No</span>
                <span v-if="isProtectedColumn(col.slug)" class="protected-indicator" :title="`Protected column '${col.slug}' cannot be deleted`">🔒</span>
              </td>
          <td class="actions-cell">
            <template v-if="editingColumn?.id === col.id">
              <button class="save-btn" @click="saveColumn(col)">Save</button>
              <button class="cancel-btn" @click="cancelEditColumn">Cancel</button>
            </template>
            <template v-else>
              <button class="edit-btn" @click="startEditColumn(col)">Edit</button>
              <button
                v-if="!isProtectedColumn(col.slug)"
                class="delete-btn"
                @click="handleDeleteColumn(col)"
              >
                Delete
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useProjectStore } from '../../stores/projects';
import { useGlobalSettingsStore } from '../../stores/global-settings';
import { updateColumn, deleteColumn } from '../../api';
import type { ProjectWithRelations, Column } from '../../api';
import type { GlobalColumn } from '../../api';

const props = defineProps<{
  mode?: 'project' | 'global';
  project?: ProjectWithRelations;
  projectSlug: string;
  globalColumns?: GlobalColumn[];
}>();

const emit = defineEmits<{
  'column-updated': [];
  'delete-column': [column: Column];
}>();

const projectStore = useProjectStore();
const globalSettingsStore = useGlobalSettingsStore();

// Column form
const newColumnName = ref('');
const newColumnSlug = ref('');
const newColumnPosition = ref(0);

// Column editing
const editingColumn = ref<Column | null>(null);
const columnEditInput = ref<HTMLInputElement | null>(null);

// Loading state (for global mode)
const loading = ref(false);

// Columns to display based on mode
const projectColumns = computed<Column[]>(() => {
  if (props.mode === 'global') {
    return globalSettingsStore.columns as unknown as Column[];
  }
  return props.project?.columns ?? [];
});

function generateColumnSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if a column slug is protected and cannot be deleted.
 * Reserved columns: 'todo' and 'done' must always exist on a board.
 */
function isProtectedColumn(slug: string): boolean {
  return ['todo', 'done'].includes(slug);
}

async function handleAddColumn(): Promise<void> {
  if (!newColumnName.value.trim()) return;
  const slug = newColumnSlug.value.trim() || generateColumnSlug(newColumnName.value);

  if (props.mode === 'global') {
    loading.value = true;
    try {
      const res = await globalSettingsStore.createGlobalColumn({
        name: newColumnName.value.trim(),
        slug,
        order: newColumnPosition.value,
      });
      if (res) {
        newColumnName.value = '';
        newColumnSlug.value = '';
        newColumnPosition.value = 0;
        emit('column-updated');
      }
    } finally {
      loading.value = false;
    }
  } else {
    const success = await projectStore.addColumn(props.projectSlug, {
      name: newColumnName.value.trim(),
      slug,
      order: newColumnPosition.value,
    });
    if (success) {
      newColumnName.value = '';
      newColumnSlug.value = '';
      newColumnPosition.value = 0;
      emit('column-updated');
    }
  }
}

function startEditColumn(col: Column): void {
  editingColumn.value = { ...col };
  nextTick(() => {
    const el = columnEditInput.value;
    if (el && 'focus' in el) {
      (el as HTMLInputElement).focus();
    }
  });
}

function cancelEditColumn(): void {
  editingColumn.value = null;
}

async function saveColumn(col: Column): Promise<void> {
  if (!editingColumn.value?.name?.trim()) return;

  if (props.mode === 'global') {
    loading.value = true;
    try {
      const res = await globalSettingsStore.updateGlobalColumn(col.id, {
        name: editingColumn.value.name.trim(),
        slug: editingColumn.value.slug,
        order: editingColumn.value.order,
      });
      if (res) {
        emit('column-updated');
        editingColumn.value = null;
      }
    } finally {
      loading.value = false;
    }
  } else {
    const res = await updateColumn(props.projectSlug, col.id, {
      name: editingColumn.value.name.trim(),
      slug: editingColumn.value.slug,
      order: editingColumn.value.order,
    });
    if (res.success) {
      emit('column-updated');
      editingColumn.value = null;
    }
  }
}

async function handleDeleteColumn(col: Column): Promise<void> {
  if (props.mode === 'global') {
    // Emit delete-event to let parent handle confirmation dialog
    emit('delete-column', col);
  } else {
    emit('delete-column', col);
  }
}
</script>

<style scoped>
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

.protected-indicator {
  margin-left: 4px;
  font-size: 12px;
  opacity: 0.6;
}
</style>
