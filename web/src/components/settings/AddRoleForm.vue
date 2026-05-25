<template>
  <div class="add-role-form">
    <button
      v-if="!isFormVisible"
      class="add-role-btn"
      @click="showForm"
    >
      + Add Role
    </button>

    <div v-else class="form-container">
      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="role-name">Name *</label>
          <input
            id="role-name"
            v-model="form.name"
            type="text"
            placeholder="Role name"
            required
            :disabled="submitting"
            ref="nameInput"
          />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
        </div>

        <div class="form-group">
          <label for="role-description">Description</label>
          <input
            id="role-description"
            v-model="form.description"
            type="text"
            placeholder="Optional description"
            :disabled="submitting"
          />
        </div>

        <div class="form-group">
          <label for="role-access-level">Access Level</label>
          <select
            id="role-access-level"
            v-model="form.accessLevel"
            :disabled="submitting"
          >
            <option value="admin">admin (create, edit, delete)</option>
            <option value="edit">edit (create, edit)</option>
            <option value="report">report (create only)</option>
            <option value="read only">read only (no actions)</option>
          </select>
          <span v-if="errors.accessLevel" class="field-error">{{ errors.accessLevel }}</span>
        </div>

        <div class="form-actions">
          <button
            type="submit"
            class="save-btn"
            :disabled="submitting"
          >
            {{ submitting ? 'Saving...' : 'Save' }}
          </button>
          <button
            type="button"
            class="cancel-btn"
            :disabled="submitting"
            @click="cancel"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
import { createRole } from '../../api';
import type { CreateRolePayload, ApiResponse, Role } from '../../api';

const emit = defineEmits<{
  created: [role: Role];
}>();

const isFormVisible = ref(false);
const submitting = ref(false);
const errors = ref<Record<string, string>>({});

const form = ref<CreateRolePayload>({
  name: '',
  description: '',
  accessLevel: 'admin',
});

const nameInput = ref<HTMLInputElement | null>(null);

function showForm(): void {
  isFormVisible.value = true;
  errors.value = {};
  form.value = {
      name: '',
      description: '',
      accessLevel: 'admin',
    };
    nextTick(() => {
    if (typeof nameInput.value?.focus === 'function') {
      nameInput.value.focus();
    }
  });
}

function cancel(): void {
  isFormVisible.value = false;
  errors.value = {};
  form.value = {
      name: '',
      description: '',
      accessLevel: 'admin',
    };
  }

async function handleSubmit(): Promise<void> {
  errors.value = {};

  // Validate
  if (!form.value.name?.trim()) {
    errors.value.name = 'Role name is required';
    return;
  }

  submitting.value = true;

  try {
    const res: ApiResponse<Role> = await createRole({
      name: form.value.name.trim(),
      description: form.value.description?.trim() || undefined,
      accessLevel: form.value.accessLevel || undefined,
    });

    if (res.success && res.data) {
      emit('created', res.data);
      cancel();
    } else {
      // Handle specific error messages
      if (res.error) {
        if (res.error.toLowerCase().includes('already exists')) {
          errors.value.name = res.error;
        } else if (res.error.toLowerCase().includes('accesslevel')) {
          errors.value.accessLevel = res.error;
        } else {
          errors.value.name = res.error;
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create role';
    errors.value.name = message;
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  // Ensure form is hidden on mount
  isFormVisible.value = false;
});
</script>

<style scoped>
.add-role-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-primary);
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 16px;
}

.add-role-btn:hover {
  background: rgba(59, 130, 246, 0.15);
}

.form-container {
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.form-group input:disabled,
.form-group select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-error {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #dc2626;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.save-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  background: #16a34a;
  border: 1px solid #16a34a;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cancel-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.cancel-btn:hover:not(:disabled) {
  background: var(--color-bg);
}

.cancel-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
