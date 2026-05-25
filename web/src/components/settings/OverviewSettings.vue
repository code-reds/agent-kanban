<template>
  <div>
    <div class="card">
      <h2>Project Information</h2>

      <div class="form-group">
        <label>Name</label>
        <div class="input-with-btn">
          <input
            v-if="editingName"
            ref="nameInputRef"
            v-model="editName"
            @keyup.enter="saveName"
            @keyup.escape="cancelEditName"
          />
          <span v-else class="display-value" @click="startEditName">{{ project.name }}</span>
          <button v-if="!editingName" class="edit-btn" @click="startEditName">Edit</button>
          <template v-else>
            <button class="save-btn" @click="saveName">Save</button>
            <button class="cancel-btn" @click="cancelEditName">Cancel</button>
          </template>
        </div>
      </div>

      <div class="form-group">
        <label>Description</label>
        <div class="input-with-btn">
          <textarea
            v-if="editingDesc"
            ref="descInputRef"
            v-model="editDesc"
            rows="3"
            @keyup.enter.ctrl="saveDesc"
            @keyup.escape="cancelEditDesc"
          ></textarea>
          <span v-else class="display-value desc-display" @click="startEditDesc">
            {{ project.description || 'No description' }}
          </span>
          <button v-if="!editingDesc" class="edit-btn" @click="startEditDesc">Edit</button>
          <template v-else>
            <button class="save-btn" @click="saveDesc">Save</button>
            <button class="cancel-btn" @click="cancelEditDesc">Cancel</button>
          </template>
        </div>
      </div>

      <div class="form-group">
        <label>Slug</label>
        <div class="slug-display">{{ project.slug }}</div>
      </div>

      <div v-if="updateMessage" class="success-message">{{ updateMessage }}</div>
    </div>

    <div class="card opencode-config">
      <h2>OpenCode Config</h2>
      <p class="section-description">
        Generate an OpenCode-compatible MCP configuration with one connection per role.
        Each connection uses a unique API token for that role's permissions.
      </p>
      <button class="btn" @click="emit('generate-opencode-config')">
        <svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <span>Create OpenCode config</span>
      </button>
    </div>

    <div class="card danger-zone">
      <h2>Danger Zone</h2>
      <p>Deleting the project will remove all associated data including tickets, conversations, and columns.</p>
      <button class="danger-btn" @click="emit('delete-project')">Delete Project</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { updateProject, deleteProject } from '../../api';
import type { ProjectWithRelations } from '../../api';

const props = defineProps<{
  project: ProjectWithRelations;
}>();

const emit = defineEmits<{
  'delete-project': [];
  'project-updated': [project: ProjectWithRelations];
  'generate-opencode-config': [];
}>();

// Project editing
const editingName = ref(false);
const editName = ref('');
const nameInputRef = ref<HTMLInputElement | null>(null);

const editingDesc = ref(false);
const editDesc = ref('');
const descInputRef = ref<HTMLTextAreaElement | null>(null);

const updateMessage = ref('');

function startEditName(): void {
  editingName.value = true;
  editName.value = props.project.name;
  nextTick(() => {
    nameInputRef.value?.focus();
  });
}

function cancelEditName(): void {
  editingName.value = false;
  editName.value = props.project.name;
}

async function saveName(): Promise<void> {
  if (!editName.value.trim()) return;
  const res = await updateProject(props.project.slug, { name: editName.value.trim() });
  if (res.success) {
    emit('project-updated', { ...props.project, name: editName.value.trim() });
    editingName.value = false;
    updateMessage.value = 'Name updated successfully';
  }
}

function startEditDesc(): void {
  editingDesc.value = true;
  editDesc.value = props.project.description || '';
  nextTick(() => {
    descInputRef.value?.focus();
  });
}

function cancelEditDesc(): void {
  editingDesc.value = false;
  editDesc.value = props.project.description || '';
}

async function saveDesc(): Promise<void> {
  const res = await updateProject(props.project.slug, { description: editDesc.value.trim() });
  if (res.success) {
    emit('project-updated', { ...props.project, description: editDesc.value.trim() });
    editingDesc.value = false;
    updateMessage.value = 'Description updated successfully';
  }
}
</script>

<style scoped>
.desc-display {
  white-space: pre-wrap;
  min-height: 24px;
}

.opencode-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.icon {
  display: flex;
  align-items: center;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.btn:hover {
  background-color: var(--color-bg);
}

.btn--primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.btn--primary:hover {
  filter: brightness(1.1);
}
</style>
