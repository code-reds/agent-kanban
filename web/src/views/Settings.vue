<template>
  <div class="settings-view">
    <div class="settings-header">
      <h1>Project Settings</h1>
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
        <OverviewSettings
          :project="project"
          @delete-project="showDeleteModal = true"
          @project-updated="onProjectUpdated"
          @generate-opencode-config="openOpencodeConfigModal"
        />
      </div>

      <!-- Columns tab -->
      <div v-if="activeTab === 'columns'" class="tab-content">
        <ColumnsSettings
          :project="project"
          :project-slug="projectSlug"
          @column-updated="onColumnUpdated"
          @delete-column="columnToDelete = $event as Column; showDeleteColumnModal = true"
        />
      </div>

      <!-- Roles tab -->
      <div v-if="activeTab === 'roles'" class="tab-content">
        <RolesSettings
          mode="project"
          :project-slug="projectSlug"
          :user-role="null"
          :columns="project.columns"
          @roles-updated="onRolesUpdated"
        />
      </div>

      <!-- Workflow tab -->
      <div v-if="activeTab === 'workflow'" class="tab-content">
        <WorkflowSettings
          :project="project"
          :project-slug="projectSlug"
          :roles="roles"
          @transition-added="onTransitionAdded"
          @transition-updated="onTransitionUpdated"
           @delete-transition="deleteTransitionToDelete = $event as Workflow; showDeleteTransitionModal = true"
        />
      </div>

      <!-- Access Rules tab -->
      <div v-if="activeTab === 'access-rules'" class="tab-content">
        <AccessRulesSettings
          :project="project"
          :project-slug="projectSlug"
          :roles="roles"
          @rules-updated="onRulesUpdated"
        />
      </div>

      <!-- API Tokens tab -->
      <div v-if="activeTab === 'tokens'" class="tab-content">
        <TokenManagement ref="tokenManagementRef" />
      </div>
    </div>

    <!-- Delete confirmation modal for project -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal">
        <h2>Confirm Deletion</h2>
        <p>Are you sure you want to delete project "<strong>{{ project.name }}</strong>"?</p>
        <p class="modal-warning">This action cannot be undone.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showDeleteModal = false">Cancel</button>
          <button class="danger-btn" @click="handleDelete" :disabled="deleting">
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal for column -->
    <div v-if="showDeleteColumnModal" class="modal-overlay" @click.self="showDeleteColumnModal = false">
      <div class="modal">
        <h2>Delete Column</h2>
        <p>Are you sure you want to delete column "<strong>{{ columnToDelete?.name }}</strong>"?</p>
        <p v-if="columnToDelete?.is_default" class="modal-warning">This is the default column and cannot be deleted.</p>
        <p v-else class="modal-warning">This action cannot be undone. Columns with existing tickets cannot be deleted.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showDeleteColumnModal = false">Cancel</button>
          <button class="danger-btn" @click="handleDeleteColumn" :disabled="deletingColumn">
            {{ deletingColumn ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal for transition -->
    <div v-if="showDeleteTransitionModal" class="modal-overlay" @click.self="showDeleteTransitionModal = false">
      <div class="modal">
        <h2>Delete Transition</h2>
        <p>Are you sure you want to delete the transition from "<strong>{{ getColumnName(deleteTransitionToDelete?.column_from ?? null) }}</strong>" to "<strong>{{ getColumnName(deleteTransitionToDelete?.column_to ?? 0) }}</strong>"?</p>
        <p class="modal-warning">This action cannot be undone.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showDeleteTransitionModal = false">Cancel</button>
          <button class="danger-btn" @click="handleDeleteTransition" :disabled="deletingTransition">
            {{ deletingTransition ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

    <!-- OpenCode config modal -->
    <div v-if="showOpencodeConfigModal" class="modal-overlay" @click.self="showOpencodeConfigModal = false">
      <div class="modal modal--large">
        <h2>Create OpenCode config</h2>
        <p class="section-description">
          Generate an Opencode-compatible MCP configuration with one connection per role.
          Each connection uses a unique API token for that role's permissions.
        </p>
        <div class="form-row">
          <div class="form-group">
            <label for="opencode-host">Server Host</label>
            <input
              id="opencode-host"
              v-model="opencodeConfig.host"
              type="text"
              placeholder="localhost"
            />
          </div>
          <div class="form-group">
            <label for="opencode-port">MCP Server Port</label>
            <input
              id="opencode-port"
              v-model.number="opencodeConfig.port"
              type="number"
              placeholder="3001"
            />
          </div>
        </div>
        <div v-if="opencodeConfigResult" class="config-output">
          <div class="config-header">
            <span>opencode.json</span>
            <div class="config-actions">
              <button class="copy-btn" @click="copyOpencodeConfig">
                {{ opencodeCopied ? 'Copied!' : 'Copy' }}
              </button>
              <button class="download-btn" @click="downloadZip" :disabled="downloadingZip">
                <svg v-if="!downloadingZip" class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {{ downloadingZip ? 'Generating...' : 'Download ZIP' }}
              </button>
            </div>
          </div>
          <pre><code>{{ opencodeConfigCode }}</code></pre>
        </div>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showOpencodeConfigModal = false">Close</button>
          <button class="btn btn--primary" @click="handleGenerateOpencodeConfig" :disabled="generatingConfig">
            {{ generatingConfig ? 'Generating...' : 'Generate Config' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="projectStore.loading" class="loading-state">
      <p>Loading project settings...</p>
    </div>

    <!-- Error state -->
    <div v-if="projectStore.error" class="error-state">
      <p>{{ projectStore.error }}</p>
      <button @click="loadProject">Retry</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectStore } from '../stores/projects';
import { deleteProject, deleteColumn, deleteTransition, getRoles, generateOpencodeConfig } from '../api';
import type { ProjectWithRelations, Role, Column, Workflow } from '../api';
import TokenManagement from '../components/settings/TokenManagement.vue';
import OverviewSettings from '../components/settings/OverviewSettings.vue';
import ColumnsSettings from '../components/settings/ColumnsSettings.vue';
import RolesSettings from '../components/settings/RolesSettings.vue';
import WorkflowSettings from '../components/settings/WorkflowSettings.vue';
import AccessRulesSettings from '../components/settings/AccessRulesSettings.vue';

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'columns', label: 'Columns' },
  { key: 'roles', label: 'Roles' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'access-rules', label: 'Access Rules' },
  { key: 'tokens', label: 'API Tokens' },
] as const;

const activeTab = ref<'overview' | 'columns' | 'roles' | 'workflow' | 'access-rules' | 'tokens'>('overview');
const showDeleteModal = ref(false);
const deleting = ref(false);
const updateMessage = ref('');

// Column editing
const showDeleteColumnModal = ref(false);
const columnToDelete = ref<Column | null>(null);
const deletingColumn = ref(false);

// Role editing
const roles = ref<Role[]>([]);
const rolesLoading = ref(false);

// Workflow transition form
const showDeleteTransitionModal = ref(false);
const deleteTransitionToDelete = ref<Workflow | null>(null);
const deletingTransition = ref(false);

// Token management
const tokenManagementRef = ref<InstanceType<typeof TokenManagement> | null>(null);

// OpenCode config modal
const showOpencodeConfigModal = ref(false);
const generatingConfig = ref(false);
const downloadingZip = ref(false);
const opencodeCopied = ref(false);
const opencodeConfigCode = ref('');
const opencodeConfigResult = ref<unknown | null>(null);

const opencodeConfig = ref({
  host: 'localhost',
  port: 3001,
});

const project = ref<ProjectWithRelations>({
  id: 0,
  name: '',
  slug: '',
  description: '',
  created_at: '',
  columns: [],
  roles: [],
  workflows: [],
  access_rules: [],
});

const projectSlug = computed(() => route.params.slug as string);

// --- Column operations ---
async function handleDeleteColumn(): Promise<void> {
  if (!columnToDelete.value) return;
  deletingColumn.value = true;
  try {
    const res = await deleteColumn(projectSlug.value, columnToDelete.value.id);
    if (res.success) {
      await projectStore.setCurrentProject(projectSlug.value);
      if (projectStore.currentProject) {
        project.value = projectStore.currentProject;
      }
      showDeleteColumnModal.value = false;
      columnToDelete.value = null;
    } else {
      projectStore.error = res.error ?? 'Failed to delete column';
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    projectStore.error = message;
  } finally {
    deletingColumn.value = false;
  }
}

// --- Role operations ---
async function loadRoles(): Promise<void> {
  rolesLoading.value = true;
  try {
    const res = await getRoles(projectSlug.value);
    if (res.success && res.data) {
      roles.value = res.data;
    }
  } catch {
    // Error handled
  } finally {
    rolesLoading.value = false;
  }
}

// --- Workflow transition operations ---
function getColumnName(columnId: number | null): string {
  if (columnId === null) return '(initial)';
  const col = project.value.columns.find((c) => c.id === columnId);
  return col?.name ?? `Column #${columnId}`;
}

async function handleDeleteTransition(): Promise<void> {
  if (!deleteTransitionToDelete.value) return;
  deletingTransition.value = true;
  try {
    const res = await deleteTransition(projectSlug.value, deleteTransitionToDelete.value.id);
    if (res.success) {
      await projectStore.setCurrentProject(projectSlug.value);
      if (projectStore.currentProject) {
        project.value = projectStore.currentProject;
      }
    }
  } catch {
    // Error handled
  } finally {
    deletingTransition.value = false;
    showDeleteTransitionModal.value = false;
    deleteTransitionToDelete.value = null;
  }
}

// --- Project operations ---
async function loadProject(): Promise<void> {
  projectStore.error = null;
  await projectStore.setCurrentProject(projectSlug.value);
  if (projectStore.currentProject) {
    project.value = projectStore.currentProject;
  }
}

async function handleDelete(): Promise<void> {
  deleting.value = true;
  try {
    const res = await deleteProject(projectSlug.value);
    if (res.success) {
      router.push('/');
    }
  } catch {
    // Error handled by store
  } finally {
    deleting.value = false;
  }
}

// --- Event handlers from child components ---
function onProjectUpdated(updatedProject: ProjectWithRelations): void {
  project.value = updatedProject;
  updateMessage.value = 'Project updated successfully';
}

function onColumnUpdated(): void {
  projectStore.setCurrentProject(projectSlug.value).then(() => {
    if (projectStore.currentProject) {
      project.value = projectStore.currentProject;
    }
  });
  updateMessage.value = 'Column updated successfully';
}

function onRolesUpdated(): void {
  loadRoles();
  updateMessage.value = 'Role updated successfully';
}

function onTransitionAdded(): void {
  projectStore.setCurrentProject(projectSlug.value).then(() => {
    if (projectStore.currentProject) {
      project.value = projectStore.currentProject;
    }
  });
  updateMessage.value = 'Transition added successfully';
}

function onTransitionUpdated(): void {
  projectStore.setCurrentProject(projectSlug.value).then(() => {
    if (projectStore.currentProject) {
      project.value = projectStore.currentProject;
    }
  });
  updateMessage.value = 'Transition updated successfully';
}

function onRulesUpdated(): void {
  updateMessage.value = 'Access rules saved successfully';
}

function openOpencodeConfigModal(): void {
  showOpencodeConfigModal.value = true;
  opencodeConfigResult.value = null;
  opencodeConfigCode.value = '';
}

async function handleGenerateOpencodeConfig(): Promise<void> {
  generatingConfig.value = true;
  try {
    const res = await generateOpencodeConfig(projectSlug.value, {
      serverPort: opencodeConfig.value.port,
      serverHost: opencodeConfig.value.host,
    });
    if (res.success && res.data) {
      opencodeConfigResult.value = res.data;
      opencodeConfigCode.value = JSON.stringify(res.data, null, 2);
    }
  } catch {
    // Error handled
  } finally {
    generatingConfig.value = false;
  }
}

function copyOpencodeConfig(): void {
  if (opencodeConfigCode.value) {
    navigator.clipboard.writeText(opencodeConfigCode.value).then(() => {
      opencodeCopied.value = true;
      setTimeout(() => {
        opencodeCopied.value = false;
      }, 2000);
    });
  }
}

function downloadZip(): void {
  const slug = projectSlug.value;
  downloadingZip.value = true;
  // Use a brief delay so the loading state is rendered before the synchronous form submission
  setTimeout(() => {
    downloadingZip.value = false;
  }, 100);

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/v1/projects/${slug}/opencode-config-zip?role=Human+User`;
  form.style.display = 'none';

  const hostInput = document.createElement('input');
  hostInput.type = 'hidden';
  hostInput.name = 'serverHost';
  hostInput.value = opencodeConfig.value.host;

  const portInput = document.createElement('input');
  portInput.type = 'hidden';
  portInput.name = 'serverPort';
  portInput.value = String(opencodeConfig.value.port);

  form.appendChild(hostInput);
  form.appendChild(portInput);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

onMounted(() => {
  loadProject();
  loadRoles();
  if (tokenManagementRef.value) {
    tokenManagementRef.value.setSlug(projectSlug.value);
  }
});
</script>

<style scoped>
.settings-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.settings-header h1 {
  margin: 0 0 20px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
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

/* Modal styles */
.modal--large {
  max-width: 720px;
}

.section-description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.config-output {
  margin: 16px 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.config-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.copy-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  font-size: 12px;
  cursor: pointer;
  color: var(--color-primary);
  white-space: nowrap;
}

.copy-btn:hover {
  background-color: var(--color-bg);
}

.copy-btn.copied {
  color: var(--success-text, #166534);
  border-color: var(--success-text, #166534);
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  font-size: 12px;
  cursor: pointer;
  color: var(--color-primary);
  white-space: nowrap;
  transition: background-color 0.15s;
}

.download-btn:hover:not(:disabled) {
  background-color: var(--color-bg);
}

.download-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.download-btn .icon {
  display: flex;
  align-items: center;
}

.config-output pre {
  margin: 0;
  padding: 12px;
  background: var(--color-bg);
  overflow: auto;
  max-height: 400px;
  font-size: 12px;
  line-height: 1.5;
}

.config-output code {
  font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
  font-size: 12px;
  color: var(--color-text);
  white-space: pre;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-row .form-group {
  flex: 1;
}

@media (max-width: 640px) {
  .form-row {
    flex-direction: column;
  }

  .config-actions {
    flex-wrap: wrap;
  }
}
</style>
