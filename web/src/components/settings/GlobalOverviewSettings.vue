<template>
  <div>
    <div class="card">
      <h2>Overview</h2>
      <p class="section-description">
        Global settings define the default columns, workflows, and access rules
        that will be applied when creating new projects. These settings help ensure
        consistency across your projects.
      </p>

      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Global Columns</span>
          <span class="info-value">{{ globalColumns }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Global Workflows</span>
          <span class="info-value">{{ globalWorkflows }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Access Rules</span>
          <span class="info-value">{{ globalAccessRules }}</span>
        </div>
      </div>

      <div v-if="seedMessage" :class="['message', seedSuccess ? 'success-message' : 'error-message']">
        {{ seedMessage }}
      </div>

      <div class="card-actions">
        <button
          class="btn btn--primary"
          @click="handleResetToDefaults"
          :disabled="globalSettingsStore.loading"
        >
          {{ globalSettingsStore.loading ? 'Resetting...' : 'Reset to Defaults' }}
        </button>
        <button class="btn" @click="handleRefresh" :disabled="globalSettingsStore.loading">
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGlobalSettingsStore } from '../../stores/global-settings';

const globalSettingsStore = useGlobalSettingsStore();

const globalColumns = computed(() => globalSettingsStore.columns.length);
const globalWorkflows = computed(() => globalSettingsStore.workflows.length);
const globalAccessRules = computed(() => globalSettingsStore.accessRules.length);

const seedMessage = ref('');
const seedSuccess = ref(true);

async function handleResetToDefaults(): Promise<void> {
  const success = await globalSettingsStore.resetGlobalDefaults();
  if (success) {
    seedMessage.value = 'Global settings have been reset to defaults.';
    seedSuccess.value = true;
  } else {
    seedMessage.value = globalSettingsStore.error || 'Failed to reset global settings';
    seedSuccess.value = false;
  }
  setTimeout(() => {
    seedMessage.value = '';
  }, 5000);
}

async function handleRefresh(): Promise<void> {
  seedMessage.value = '';
  await globalSettingsStore.fetchGlobalSettings();
  seedMessage.value = 'Settings refreshed';
  seedSuccess.value = true;
  setTimeout(() => {
    seedMessage.value = '';
  }, 3000);
}
</script>

<style scoped>
.section-description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0 0 20px 0;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.info-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-primary);
}

.card-actions {
  display: flex;
  gap: 8px;
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
  transition: background-color 0.15s;
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

.btn:disabled {
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
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>
