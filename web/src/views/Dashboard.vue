<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h1>Dashboard</h1>
      <button class="btn-primary" @click="showCreateForm = !showCreateForm">
        {{ showCreateForm ? 'Cancel' : 'Create Project' }}
      </button>
    </div>

    <div v-if="showCreateForm" class="create-form">
      <form @submit.prevent="handleCreate">
        <div class="form-group">
          <label for="project-name">Name</label>
          <input
            id="project-name"
            v-model="form.name"
            type="text"
            placeholder="Project name"
            required
          />
        </div>
        <div class="form-group">
          <label for="project-slug">Slug</label>
          <input
            id="project-slug"
            v-model="form.slug"
            type="text"
            placeholder="project-name"
            required
          />
          <span class="form-hint">Auto-generated from name. Lowercase letters, numbers, and hyphens only.</span>
        </div>
        <div v-if="formError" class="form-error">{{ formError }}</div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" :disabled="store.loading">
            {{ store.loading ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="store.loading && store.projects.length === 0" class="loading-state">
      Loading projects...
    </div>

    <div v-else-if="store.error && store.projects.length === 0" class="error-state">
      <p>{{ store.error }}</p>
      <button class="btn-secondary" @click="store.fetchProjects()">Retry</button>
    </div>

    <div v-else class="projects-grid">
      <router-link
        v-for="project in store.projects"
        :key="project.id"
        :to="`/projects/${project.slug}/board`"
        class="project-card"
      >
        <h2 class="project-name">{{ project.name }}</h2>
        <p class="project-description">
          {{ project.description || 'No description' }}
        </p>
        <span class="project-slug">{{ project.slug }}</span>
      </router-link>

      <div v-if="store.projects.length === 0" class="empty-state">
        <p>No projects yet. Create your first project to get started.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useProjectStore } from '../stores/projects';

const store = useProjectStore();

const showCreateForm = ref(false);
const formError = ref('');

const form = ref({
  name: '',
  slug: '',
});

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

watch(
  () => form.value.name,
  (name) => {
    if (name) {
      form.value.slug = generateSlug(name);
    }
  }
);

async function handleCreate(): Promise<void> {
  formError.value = '';

  if (!validateSlug(form.value.slug)) {
    formError.value = 'Slug must contain only lowercase letters, numbers, and hyphens.';
    return;
  }

  const success = await store.createProject(form.value.name, form.value.slug);

  if (success) {
    form.value = { name: '', slug: '' };
    showCreateForm.value = false;
    formError.value = '';
  }
}

onMounted(() => {
  store.fetchProjects();
});
</script>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.dashboard-header h1 {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.btn-primary {
  padding: 10px 20px;
  background-color: var(--color-primary);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background-color: var(--color-border);
  color: var(--color-text);
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 12px;
}

.btn-secondary:hover {
  background-color: color-mix(in srgb, var(--color-border) 80%, var(--color-text));
}

.create-form {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.form-hint {
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.form-error {
  color: #ef4444;
  font-size: 13px;
  margin-bottom: 12px;
}

.form-actions {
  margin-top: 16px;
}

.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--color-text-secondary);
  font-size: 16px;
}

.error-state {
  color: #ef4444;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.project-card {
  display: block;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.2s, border-color 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.project-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 8px 0;
}

.project-description {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.project-slug {
  display: inline-block;
  font-size: 12px;
  color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
}
</style>
