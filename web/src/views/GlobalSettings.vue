<template>
  <div class="global-settings-view">
    <div class="settings-header">
      <h1>Global Settings</h1>
      <p class="settings-description">
        Configure default settings that will be used for new projects.
      </p>
    </div>

    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="settings-content">
      <!-- Overview tab -->
      <div v-if="activeTab === 'overview'" class="tab-content">
        <GlobalOverviewSettings />
      </div>

      <!-- Columns tab -->
      <div v-if="activeTab === 'columns'" class="tab-content">
        <ColumnsSettings
          mode="global"
          :project-slug="projectSlug"
          :global-columns="globalSettingsStore.columns"
          @delete-column="columnToDelete = $event; showDeleteColumnModal = true"
        />
      </div>

      <!-- Roles tab -->
      <div v-if="activeTab === 'roles'" class="tab-content">
        <RolesSettings
          mode="global"
          :project-slug="projectSlug"
          :user-role="null"
          :columns="globalSettingsStore.columns as Column[]"
        />
      </div>

      <!-- Workflow tab -->
      <div v-if="activeTab === 'workflow'" class="tab-content">
        <WorkflowSettings
          mode="global"
          :project-slug="projectSlug"
          :roles="roles"
          :global-workflows="globalSettingsStore.workflows"
          :global-columns="globalSettingsStore.columns"
          @transition-added="onTransitionAdded"
          @transition-updated="onTransitionUpdated"
          @delete-transition="handleDeleteGlobalWorkflow"
        />
      </div>

      <!-- Access Rules tab -->
      <div v-if="activeTab === 'access-rules'" class="tab-content">
        <AccessRulesSettings mode="global" :project-slug="projectSlug" :roles="roles" :global-access-rules="globalSettingsStore.accessRules" :global-columns="globalSettingsStore.columns" />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="globalSettingsStore.loading" class="loading-state">
      <p>Loading global settings...</p>
    </div>

    <!-- Error state -->
    <div v-if="globalSettingsStore.error" class="error-state">
      <p>{{ globalSettingsStore.error }}</p>
      <button @click="loadGlobalSettings">Retry</button>
    </div>

    <!-- Delete confirmation modal for column -->
    <div v-if="showDeleteColumnModal" class="modal-overlay" @click.self="showDeleteColumnModal = false">
      <div class="modal">
        <h2>Delete Column</h2>
        <p>Are you sure you want to delete column "<strong>{{ columnToDelete?.name }}</strong>"?</p>
        <p v-if="columnToDelete?.is_default" class="modal-warning">This is a default column and cannot be deleted.</p>
        <p v-else class="modal-warning">This action cannot be undone. Columns with existing tickets cannot be deleted.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showDeleteColumnModal = false">Cancel</button>
          <button class="danger-btn" @click="handleDeleteColumn" :disabled="deletingColumn">
            {{ deletingColumn ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useGlobalSettingsStore } from '../stores/global-settings';
import { getGlobalRoles, updateGlobalRole, deleteGlobalColumn } from '../api';
import type { Role, ApiResponse, Column } from '../api';
import ColumnsSettings from '../components/settings/ColumnsSettings.vue';
import RolesSettings from '../components/settings/RolesSettings.vue';
import WorkflowSettings from '../components/settings/WorkflowSettings.vue';
import AccessRulesSettings from '../components/settings/AccessRulesSettings.vue';
import GlobalOverviewSettings from '../components/settings/GlobalOverviewSettings.vue';

const globalSettingsStore = useGlobalSettingsStore();

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'columns', label: 'Columns' },
  { key: 'roles', label: 'Roles' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'access-rules', label: 'Access Rules' },
] as const;

const activeTab = ref<'overview' | 'columns' | 'roles' | 'workflow' | 'access-rules'>('overview');

const roles = ref<Role[]>([]);
const projectSlug = 'global';

// --- Column deletion confirmation ---
const showDeleteColumnModal = ref(false);
const columnToDelete = ref<Column | null>(null);
const deletingColumn = ref(false);

async function handleDeleteColumn(): Promise<void> {
  if (!columnToDelete.value) return;
  deletingColumn.value = true;
  try {
    const res: ApiResponse<{ success: boolean; id: number }> = await deleteGlobalColumn(columnToDelete.value.id);
    if (res.success && res.data) {
      await globalSettingsStore.fetchGlobalSettings();
      showDeleteColumnModal.value = false;
      columnToDelete.value = null;
    } else {
      // Show error message — don't close the modal
      globalSettingsStore.error = res.error ?? 'Failed to delete column';
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    globalSettingsStore.error = message;
  } finally {
    deletingColumn.value = false;
  }
}

// --- Global settings operations ---
async function loadGlobalSettings(): Promise<void> {
  await globalSettingsStore.fetchGlobalSettings();
}

// --- Role operations ---
async function loadRoles(): Promise<void> {
  try {
    const res = await getGlobalRoles();
    if (res.success && res.data) {
      roles.value = res.data;
    }
  } catch {
    // Error handled
  }
}

// --- Workflow event handlers ---
async function onTransitionAdded(): Promise<void> {
  await globalSettingsStore.fetchGlobalSettings();
}

async function onTransitionUpdated(): Promise<void> {
  await globalSettingsStore.fetchGlobalSettings();
}

function handleDeleteGlobalWorkflow(): void {
  globalSettingsStore.fetchGlobalSettings();
}

onMounted(() => {
  loadGlobalSettings();
  loadRoles();
});
</script>

<style scoped>
.global-settings-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.settings-header h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.settings-description {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.settings-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 24px;
}

.tab-btn {
  padding: 10px 20px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.tab-btn:hover {
  color: var(--color-text);
}

.tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.settings-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.loading-state {
  text-align: center;
  padding: 48px 0;
  color: var(--color-text-secondary);
}

.error-state {
  padding: 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  margin-top: 16px;
}

.error-state button {
  margin-top: 8px;
  padding: 6px 16px;
  border: 1px solid #dc2626;
  border-radius: 6px;
  background: transparent;
  color: #dc2626;
  cursor: pointer;
  font-size: 13px;
}
</style>
