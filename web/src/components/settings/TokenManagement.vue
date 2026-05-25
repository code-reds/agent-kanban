<template>
  <div class="token-management">
    <!-- Header -->
    <div class="tokens-card">
      <div class="token-header">
        <div>
          <h2>API Tokens</h2>
          <p class="section-description">
            API tokens allow external tools and scripts to interact with your project via the Agent Kanban API.
            Tokens are tied to specific roles and grant the permissions of that role.
          </p>
        </div>
        <div class="header-actions">
          <button class="btn btn--primary" :disabled="loading" @click="showCreateModal = true">
            Create New Token
          </button>
        </div>
      </div>
    </div>

    <!-- Create token modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h2>Create API Token</h2>
        <div class="form-group">
          <label for="token-role">Role</label>
          <select id="token-role" v-model="newToken.role_id">
            <option :value="null" disabled>Select a role</option>
            <option v-for="role in roles" :key="role.id" :value="role.id">
              {{ role.name }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label for="token-description">Description (optional)</label>
          <input
            id="token-description"
            v-model="newToken.description"
            type="text"
            placeholder="e.g., CI/CD pipeline token"
          />
        </div>
        <div class="form-group">
          <label for="token-expires">Expiration</label>
          <select id="token-expires" v-model.number="newToken.expires_in">
            <option :value="null">Never</option>
            <option :value="3600000">1 hour</option>
            <option :value="86400000">1 day</option>
            <option :value="604800000">1 week</option>
            <option :value="2592000000">30 days</option>
            <option :value="31536000000">365 days</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showCreateModal = false">Cancel</button>
          <button
            class="btn btn--primary"
            @click="handleCreateToken"
            :disabled="!newToken.role_id || isCreating"
          >
            {{ isCreating ? 'Creating...' : 'Create Token' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Token created modal - show the token once -->
    <div v-if="showCreatedModal" class="modal-overlay" @click.self="closeCreatedModal">
      <div class="modal">
        <h2>Token Created Successfully</h2>
        <p class="token-warning">
          This token will only be shown once. Copy it now and store it securely.
        </p>
        <div class="token-display">
          <code class="token-value">{{ createdToken?.token }}</code>
          <button class="copy-btn" @click="copyToken" :class="{ copied }">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <div class="token-meta">
          <span>Role: <strong>{{ createdToken?.role_name }}</strong></span>
          <span v-if="createdToken?.expires_at">Expires: <strong>{{ formatDate(createdToken.expires_at) }}</strong></span>
        </div>
        <div class="token-actions">
          <button class="btn btn--primary" @click="handleDoneCreating">I've Saved It</button>
        </div>
      </div>
    </div>

    <!-- Existing tokens list -->
    <div class="tokens-card">
      <h3>Existing Tokens</h3>
      <div v-if="loading" class="loading-state">
        <p>Loading tokens...</p>
      </div>
      <div v-else-if="tokens.length === 0" class="empty-state">
        No API tokens created yet. Tokens for AI agent roles are auto-created when a new project is added.
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Role</th>
            <th>Description</th>
            <th>Token</th>
            <th>Created</th>
            <th>Expires</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.id">
            <td><span class="role-label">{{ token.role_name }}</span></td>
            <td>{{ token.description || '-' }}</td>
            <td>
              <div class="token-cell">
                <template v-if="token.showPlain">
                  <code class="token-plaintext-code">{{ token.plainToken }}</code>
                  <button
                    class="copy-token-btn"
                    @click="copyPlaintextToken(token)"
                    :class="{ copied: token.copied }"
                    :title="'Copy token'"
                  >
                    {{ token.copied ? '✓' : '⎘' }}
                  </button>
                  <button
                    class="eye-btn"
                    @click="toggleTokenVisibility(token)"
                    title="Hide token"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  </button>
                </template>
                <template v-else>
                  <code class="token-masked">••••••••</code>
                  <button
                    class="eye-btn"
                    @click="toggleTokenVisibility(token)"
                    title="Show token"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </template>
              </div>
            </td>
            <td class="mono">{{ formatDate(token.created_at) }}</td>
            <td class="mono">
              <template v-if="token.expires_at">{{ formatDate(token.expires_at) }}</template>
              <template v-else>Never</template>
            </td>
            <td>
              <span
                class="status-badge"
                :class="{ active: token.is_active, expired: !token.is_active || (token.expires_at && new Date(token.expires_at) < new Date()) }"
              >
                {{ getStatusText(token) }}
              </span>
            </td>
            <td class="actions-cell">
              <button
                v-if="token.is_active"
                class="delete-btn"
                @click="openRevokeModal(token)"
              >
                Revoke
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Revoke confirmation modal -->
    <div v-if="showRevokeModal" class="modal-overlay" @click.self="showRevokeModal = false">
      <div class="modal">
        <h2>Revoke Token</h2>
        <p>Are you sure you want to revoke the token for "<strong>{{ tokenToRevoke?.role_name }}</strong>"?</p>
        <p class="modal-warning">This action cannot be undone.</p>
        <div class="modal-actions">
          <button class="cancel-btn" @click="showRevokeModal = false">Cancel</button>
          <button class="danger-btn" @click="handleRevokeToken" :disabled="revoking">
            {{ revoking ? 'Revoking...' : 'Revoke' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import type { Role } from '../../api';
import { getTokens, createToken, revokeToken, getRoles, getRolePlaintextToken, generateOpencodeConfig } from '../../api';

interface TokenWithVisibility {
  id: number;
  project_id: number;
  role_id: number;
  role_name: string;
  description: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  token_prefix: string;
  showPlain: boolean;
  plainToken: string;
  copied: boolean;
}

const route = useRoute();
const projectSlug = ref(route.params.slug as string);

// Expose slug for parent component
defineExpose({
  setSlug(slug: string) {
    projectSlug.value = slug;
    loadTokens();
  },
  generateOpencodeConfig(config: { host: string; port: number }) {
    return handleGenerateOpencodeConfig(config);
  },
});

const tokens = ref<TokenWithVisibility[]>([]);
const roles = ref<Role[]>([]);
const loading = ref(true);
const showCreateModal = ref(false);
const showCreatedModal = ref(false);
const showRevokeModal = ref(false);
const createdToken = ref<{ token: string; role_name: string; expires_at: string | null } | null>(null);
const isCreating = ref(false);
const copied = ref(false);
const revoking = ref(false);
const tokenToRevoke = ref<TokenWithVisibility | null>(null);

const newToken = ref({
  role_id: null as number | null,
  description: '',
  expires_in: null as number | null,
});

async function loadRoles(): Promise<void> {
  try {
    const res = await getRoles(projectSlug.value);
    if (res.success && res.data) {
      roles.value = res.data;
    }
  } catch {
    // Error handled
  }
}

async function loadTokens(): Promise<void> {
  loading.value = true;
  try {
    const res = await getTokens(projectSlug.value);
    if (res.success && res.data) {
      tokens.value = (res.data as unknown as TokenWithVisibility[]).map(t => ({
        ...t,
        showPlain: false,
        plainToken: '',
        copied: false,
      }));
    }
  } catch {
    // Error handled
  } finally {
    loading.value = false;
  }
}

async function handleCreateToken(): Promise<void> {
  if (!newToken.value.role_id) return;
  isCreating.value = true;
  try {
    const res = await createToken(projectSlug.value, {
      role_id: newToken.value.role_id,
      description: newToken.value.description || undefined,
      expires_in: newToken.value.expires_in || undefined,
    });
    if (res.success && res.data) {
      const data = res.data as { token: string; role_name: string; expires_at: string | null };
      createdToken.value = data;
      showCreateModal.value = false;
      showCreatedModal.value = true;
      await loadTokens();
    }
  } catch {
    // Error handled
  } finally {
    isCreating.value = false;
  }
}

function closeCreatedModal(): void {
  if (!isCreating.value) {
    showCreatedModal.value = false;
  }
}

function handleDoneCreating(): void {
  showCreatedModal.value = false;
  createdToken.value = null;
  newToken.value = { role_id: null, description: '', expires_in: null };
  copied.value = false;
}

function copyToken(): void {
  if (createdToken.value?.token) {
    navigator.clipboard.writeText(createdToken.value.token).then(() => {
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    });
  }
}

function openRevokeModal(token: TokenWithVisibility): void {
  tokenToRevoke.value = token;
  showRevokeModal.value = true;
}

async function handleRevokeToken(): Promise<void> {
  if (!tokenToRevoke.value) return;
  revoking.value = true;
  try {
    const res = await revokeToken(projectSlug.value, tokenToRevoke.value.id);
    if (res.success) {
      await loadTokens();
    }
  } catch {
    // Error handled
  } finally {
    revoking.value = false;
    showRevokeModal.value = false;
    tokenToRevoke.value = null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getStatusText(token: TokenWithVisibility): string {
  if (!token.is_active) return 'Revoked';
  if (token.expires_at && new Date(token.expires_at) < new Date()) return 'Expired';
  return 'Active';
}

async function toggleTokenVisibility(token: TokenWithVisibility): Promise<void> {
  if (!token.showPlain) {
    try {
      const res = await getRolePlaintextToken(projectSlug.value, token.id);
      if (res.success && res.data) {
        token.plainToken = (res.data as { token: string }).token;
        token.showPlain = true;
      }
    } catch {
      // Error handled - token remains masked
    }
  } else {
    token.showPlain = false;
    token.plainToken = '';
  }
}

function copyPlaintextToken(token: TokenWithVisibility): void {
  if (token.plainToken) {
    navigator.clipboard.writeText(token.plainToken).then(() => {
      token.copied = true;
      setTimeout(() => {
        token.copied = false;
      }, 2000);
    });
  }
}

async function handleGenerateOpencodeConfig(config: { host: string; port: number }): Promise<unknown | null> {
  try {
    const res = await generateOpencodeConfig(projectSlug.value, {
      serverPort: config.port,
      serverHost: config.host,
    });
    if (res.success && res.data) {
      return res.data;
    }
    return null;
  } catch {
    return null;
  }
}

onMounted(() => {
  loadRoles();
  loadTokens();
});
</script>

<style scoped>
.token-management {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tokens-card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 20px;
}

.tokens-card h3 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.token-header h2 {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.section-description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.token-warning {
  color: var(--color-danger);
  font-size: 13px;
  font-weight: 500;
}

.token-display {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 16px 0;
  padding: 12px;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.token-value {
  flex: 1;
  font-family: monospace;
  font-size: 13px;
  word-break: break-all;
  color: var(--color-text);
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

.token-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.token-actions {
  display: flex;
  justify-content: flex-end;
}

.role-label {
  font-weight: 500;
  font-size: 13px;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.active {
  background-color: var(--success-bg, #f0fdf4);
  color: var(--success-text, #166534);
}

.status-badge.expired {
  background-color: var(--danger-bg, #fef2f2);
  color: var(--danger-text, #dc2626);
}

.mono {
  font-family: monospace;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.actions-cell {
  white-space: nowrap;
  width: 1%;
}

/* Token cell with eye button */
.token-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 200px;
}

.token-masked {
  font-family: monospace;
  font-size: 13px;
  color: var(--color-text-secondary);
  user-select: none;
  letter-spacing: 2px;
}

.token-plaintext-code {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text);
  word-break: break-all;
}

.eye-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-secondary);
  border-radius: 4px;
  flex-shrink: 0;
}

.eye-btn:hover {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.copy-token-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  transition: background-color 0.15s;
}

.copy-token-btn:hover {
  background-color: var(--color-bg);
  color: var(--color-primary);
}

.copy-token-btn.copied {
  color: var(--success-text, #166534);
  border-color: var(--success-text, #166534);
}

select,
input[type="text"],
input[type="number"] {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-surface);
  color: var(--color-text);
  box-sizing: border-box;
}

select:focus,
input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--primary-light, rgba(59, 130, 246, 0.15));
}

@media (max-width: 640px) {
  .token-header {
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions .btn {
    flex: 1;
  }

  .token-cell {
    min-width: 150px;
  }
}
</style>
