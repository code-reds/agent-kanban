<template>
  <div class="conversations-view">
    <div class="conversations-layout">
      <!-- Left pane: conversation list -->
      <div class="conversation-list-pane">
        <div class="list-header">
          <h2>Conversations</h2>
          <div class="list-header-actions">
            <button class="new-conversation-btn" @click="showNewConversationModal = true" title="Start a new conversation" :disabled="store.loading">
              + New
            </button>
            <button class="refresh-btn" @click="refresh" :disabled="store.loading">
              {{ store.loading ? '...' : 'Refresh' }}
            </button>
          </div>
        </div>

        <div v-if="store.error" class="error-state">
          <p>{{ store.error }}</p>
          <button @click="refresh">Retry</button>
        </div>

        <div v-else-if="store.conversations.length === 0" class="empty-state">
          <p>No conversations yet</p>
          <button class="new-conversation-link" @click="showNewConversationModal = true">
            Start a new conversation
          </button>
        </div>

        <ul v-else class="conversation-list">
          <li
            v-for="conv in store.conversations"
            :key="conv.id"
            class="conversation-item"
            :class="{ active: store.activeConversation?.id === conv.id }"
            @click="selectConversation(conv.id)"
          >
            <div class="conv-info">
              <div class="conv-roles">
                <span class="role-from">{{ conv.from_role_name }}</span>
                <span class="arrow">&rarr;</span>
                <span class="role-to">{{ conv.to_role_name }}</span>
              </div>
              <div class="conv-id">Conversation #{{ conv.id }}</div>
            </div>
          </li>
        </ul>
      </div>

      <!-- New Conversation Modal -->
      <div v-if="showNewConversationModal" class="modal-overlay" @click.self="closeNewConversationModal">
        <div class="modal">
          <div class="modal-header">
            <h3>New Conversation</h3>
            <button class="modal-close" @click="closeNewConversationModal">&times;</button>
          </div>
          <div class="modal-body">
            <p class="modal-description">Select a role to start a new conversation:</p>
            <ul v-if="availableRoles.length > 0" class="role-list">
              <li
                v-for="role in availableRoles"
                :key="role.id"
                class="role-option"
                :class="{ disabled: store.conversationExistsWithRole(role.id) }"
                @click="handleCreateConversation(role.id)"
              >
                <div class="role-option-info">
                  <span class="role-option-name">{{ role.name }}</span>
                  <span v-if="store.conversationExistsWithRole(role.id)" class="role-option-status">
                    Conversation already exists
                  </span>
                </div>
                <span v-if="store.conversationExistsWithRole(role.id)" class="role-option-check">✓</span>
                <span v-else class="role-option-arrow">&rarr;</span>
              </li>
            </ul>
            <p v-else class="modal-empty">No agent roles available</p>
            <div v-if="newConvError" class="modal-error">
              {{ newConvError }}
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-cancel-btn" @click="closeNewConversationModal">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Right pane: messages -->
      <div class="message-pane">
        <template v-if="!store.activeConversation">
          <div class="message-placeholder">
            <p>Select a conversation to view messages</p>
          </div>
        </template>

        <template v-else>
          <div class="message-header">
            <div class="message-header-info">
              <strong>{{ store.activeConversation.from_role_name }}</strong>
              <span>&harr;</span>
              <strong>{{ store.activeConversation.to_role_name }}</strong>
            </div>
          </div>

          <div ref="messagesContainer" class="messages-container" :class="{ loading: store.loading }">
            <div v-if="store.error" class="error-state">
              <p>{{ store.error }}</p>
              <button @click="retryFetch">Retry</button>
            </div>

            <div v-else-if="store.activeConversation.messages.length === 0" class="empty-messages">
              <p>No messages yet</p>
            </div>

            <div v-else class="messages-list">
              <!-- Unread divider for Human User conversations -->
              <div
                v-if="isHumanConversation && store.unreadIndex >= 0"
                class="unread-divider"
              >
                <span class="unread-divider-label">New</span>
              </div>

              <div
                v-for="(msg, index) in store.activeConversation.messages"
                :key="msg.id"
                class="message-bubble"
                :class="{
                  'message-mine': isMine(msg.sender_role_id),
                  'message-unread': isHumanConversation && index >= (store.unreadIndex || -1)
                }"
              >
                <div class="message-sender">{{ msg.sender_role_name }}</div>
                <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
                <div class="message-time">{{ formatTime(msg.created_at) }}</div>
              </div>

              <!-- Floating "New" badge -->
              <div
                v-if="store.unreadIndex >= 0"
                class="unread-badge"
                @click="handleMarkAsRead"
              >
                New ({{ store.unreadCount }})
              </div>
            </div>
          </div>

          <div class="message-input-area">
            <textarea
              v-model="store.messageInput"
              placeholder="Type a message..."
              @keydown.enter.exact.prevent="send"
              rows="2"
            ></textarea>
            <button class="send-btn" @click="send" :disabled="!store.messageInput.trim() || store.loading">
              {{ store.loading ? '...' : 'Send' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useConversationStore } from '../stores/conversations';
import { useProjectStore } from '../stores/projects';
import { renderMarkdown } from '../utils/markdown';
import { useSSE } from '../composables/useSSE';
import type { Comment as ApiComment } from '../api';

const route = useRoute();
const projectStore = useProjectStore();
const store = useConversationStore();
const messagesContainer = ref<HTMLElement | null>(null);
const newMessageTrigger = ref(0);

const projectSlug = computed(() => route.params.slug as string);

const sse = useSSE(projectSlug.value, {
  handleTicketCreated: (_ticket: Record<string, unknown>) => {},
  handleTicketUpdated: (_ticket: Record<string, unknown>) => {},
  handleTicketMoved: (_ticketId: number, _toColumn: string) => {},
  handleTicketDeleted: (_ticketId: number) => {},
  handleCommentAdded: (_ticketId: number, _comment: ApiComment) => {},
  handleDepAdded: (_ticketId: number, _dependsOnId: number, _relationType: string, _projectSlug: string) => {},
  handleDepRemoved: (_ticketId: number, _dependsOnId: number, _relationType: string, _projectSlug: string) => {},
  handleConversationCreated: (conversation) => store.handleConversationCreated(conversation),
  handleConversationMessageSent: (conversationId, message) => {
    store.handleConversationMessageSent(conversationId, message);
    newMessageTrigger.value += 1;
  },
  handleConversationReadUpdated: (conversationId, lastReadMessageId) => store.handleConversationReadUpdated(conversationId, lastReadMessageId),
  handleConversationDeleted: (conversationId) => {
    store.handleConversationDeleted(conversationId);
    newMessageTrigger.value += 1;
  },
});

watch(newMessageTrigger, () => {
  scrollToBottom();
});

const unreadIndex = computed(() => store.unreadIndex);
const isHumanConversation = computed(() => store.isHumanConversation);

const currentRoleId = computed(() => {
  return projectStore.currentProject?.roles[0]?.id;
});

const showNewConversationModal = ref(false);
const newConvError = ref<string | null>(null);

const availableRoles = computed(() => {
  if (!projectStore.currentProject?.roles) return [];
  // Filter out the Human User (role_id 1) — they are the ones initiating
  return projectStore.currentProject.roles.filter((r) => r.id !== 1);
});

/** 2-second auto-mark-as-read timer for Human User conversations */
let readTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoReadTimer(): void {
  if (readTimer) {
    clearTimeout(readTimer);
    readTimer = null;
  }
}

function startAutoReadTimer(): void {
  clearAutoReadTimer();
  if (store.activeConversation && isHumanConversation.value) {
    const convId = store.activeConversation.id;
    const convActiveId = store.activeConversationId;
    readTimer = setTimeout(async () => {
      if (convActiveId === convId) {
        await store.markAsRead(projectSlug.value, convId);
      }
    }, 2000);
  }
}

function isMine(roleId: number): boolean {
  return roleId === currentRoleId.value;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

async function refresh(): Promise<void> {
  await store.fetchConversations(projectSlug.value);
}

async function selectConversation(convId: number): Promise<void> {
  await store.selectConversation(projectSlug.value, convId);
  // markAsRead is now handled by the 2-second auto-read timer for Human User conversations
  await nextTick();
  scrollToBottom();
}

async function retryFetch(): Promise<void> {
  if (store.activeConversation) {
    await store.selectConversation(projectSlug.value, store.activeConversation.id);
    await nextTick();
    scrollToBottom();
  }
}

function send(): void {
  if (!store.activeConversation) return;
  store.sendMessage(projectSlug.value, store.activeConversation.id, currentRoleId.value);
}

function scrollToBottom(): void {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

async function handleMarkAsRead(): Promise<void> {
  if (store.activeConversation) {
    await store.markAsRead(projectSlug.value, store.activeConversation.id);
  }
  scrollToBottom();
}

function closeNewConversationModal(): void {
  showNewConversationModal.value = false;
  newConvError.value = null;
}

async function handleCreateConversation(targetRoleId: number): Promise<void> {
  newConvError.value = null;

  // Check if conversation already exists
  if (store.conversationExistsWithRole(targetRoleId)) {
    const existing = store.findExistingConversation(targetRoleId);
    if (existing) {
      showNewConversationModal.value = false;
      newConvError.value = null;
      await selectConversation(existing.id);
      return;
    }
  }

  const convId = await store.createConversation(projectSlug.value, targetRoleId);
  if (convId) {
    showNewConversationModal.value = false;
    newConvError.value = null;
    await selectConversation(convId);
  } else {
    newConvError.value = store.error ?? 'Failed to create conversation';
  }
}

// Watch for conversation changes to start/clear auto-read timer
watch(
  () => store.activeConversationId,
  () => {
    startAutoReadTimer();
  }
);

// Also watch isHumanConversation to restart timer if it changes
watch(
  () => isHumanConversation.value,
  () => {
    startAutoReadTimer();
  }
);

onMounted(async () => {
  if (projectStore.currentProject) {
    await refresh();
  }
  sse.connect();
});

onUnmounted(() => {
  clearAutoReadTimer();
  sse.disconnect();
});

// Reconnect SSE when project slug changes
watch(
  () => projectSlug.value,
  (newSlug, _oldSlug) => {
    sse.disconnect();
    sse.connect(newSlug);
  }
);
</script>

<style scoped>
.conversations-view {
  height: 100%;
  background-color: var(--color-bg);
}

.conversations-layout {
  display: flex;
  height: 100%;
  gap: 0;
}

/* Left pane */
.conversation-list-pane {
  width: 300px;
  min-width: 300px;
  border-right: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.list-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.list-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.new-conversation-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.new-conversation-btn:hover {
  background-color: var(--color-primary-hover);
}

.new-conversation-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.refresh-btn:hover {
  background-color: var(--color-bg);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.conversation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.conversation-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background-color 0.15s;
}

.conversation-item:hover {
  background-color: var(--color-bg);
}

.conversation-item.active {
  background-color: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
  border-left: 3px solid var(--color-primary);
}

.conv-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conv-roles {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--color-text);
}

.role-from,
.role-to {
  font-weight: 500;
}

.arrow {
  color: var(--color-text-secondary);
}

.conv-id {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* Right pane */
.message-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg);
  overflow: hidden;
}

.message-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-placeholder p {
  color: var(--color-text-secondary);
  font-size: 15px;
}

.message-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
}

.message-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text);
}

.message-header-info strong {
  font-weight: 600;
}

.message-header-info span {
  color: var(--color-text-secondary);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.messages-container.loading {
  opacity: 0.6;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 12px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
}

.message-mine {
  margin-left: auto;
  background-color: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-surface));
}

.message-sender {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.message-content {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.5;
  word-break: break-word;
}

.message-content :deep(h1),
.message-content :deep(h2),
.message-content :deep(h3),
.message-content :deep(h4),
.message-content :deep(h5),
.message-content :deep(h6) {
  margin: 8px 0 4px 0;
  font-weight: 600;
  line-height: 1.3;
}

.message-content :deep(h1) { font-size: 18px; }
.message-content :deep(h2) { font-size: 16px; }
.message-content :deep(h3) { font-size: 15px; }

.message-content :deep(p) {
  margin: 4px 0;
}

.message-content :deep(strong) {
  font-weight: 600;
}

.message-content :deep(em) {
  font-style: italic;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}

.message-content :deep(li) {
  margin: 2px 0;
}

.message-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.9em;
  background-color: rgba(0, 0, 0, 0.05);
  padding: 2px 4px;
  border-radius: 4px;
}

.message-content :deep(pre) {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  margin: 6px 0;
}

.message-content :deep(pre code) {
  background-color: transparent;
  padding: 0;
}

.message-content :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--color-primary);
  color: var(--color-text-secondary);
}

.message-content :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
}

.message-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 8px 0;
}

.message-time {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  text-align: right;
}

.empty-messages {
  text-align: center;
  padding: 40px 0;
  color: var(--color-text-secondary);
}

.message-input-area {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.message-input-area textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  color: var(--color-text);
  background-color: var(--color-bg);
}

.message-input-area textarea:focus {
  border-color: var(--color-primary);
}

.send-btn {
  padding: 8px 20px;
  background-color: var(--color-primary);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.send-btn:hover {
  background-color: var(--color-primary-hover);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Error state */
.error-state {
  padding: 20px;
  text-align: center;
  color: var(--color-danger);
}

.error-state button {
  margin-top: 8px;
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
  color: var(--color-danger);
}

.empty-state {
  padding: 40px 16px;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-state .new-conversation-link {
  margin-top: 12px;
  padding: 8px 20px;
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
}

.empty-state .new-conversation-link:hover {
  background-color: var(--color-primary);
  color: #ffffff;
}

/* Unread visualization */
.unread-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 16px 0;
  position: relative;
}

.unread-divider::before,
.unread-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background-color: var(--color-primary);
  opacity: 0.4;
}

.unread-divider-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  background-color: var(--color-surface);
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.unread-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 14px;
  background-color: var(--color-primary);
  color: #ffffff;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  margin-left: 16px;
  transition: background-color 0.15s;
  user-select: none;
}

.unread-badge:hover {
  background-color: var(--color-primary-hover);
}

.message-unread {
  background-color: color-mix(in srgb, var(--color-warning) 12%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-surface));
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background-color: var(--color-surface);
  border-radius: 12px;
  width: 420px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.modal-close {
  background: none;
  border: none;
  font-size: 22px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.modal-close:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.modal-description {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.role-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.role-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
  border: 1px solid transparent;
}

.role-option:hover:not(.disabled) {
  background-color: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-surface));
}

.role-option.disabled {
  opacity: 0.5;
  cursor: default;
}

.role-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.role-option-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text);
}

.role-option-status {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.role-option-check {
  color: #22c55e;
  font-size: 16px;
}

.role-option-arrow {
  color: var(--color-text-secondary);
  font-size: 14px;
}

.modal-empty {
  color: var(--color-text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 20px 0;
}

.modal-error {
  margin-top: 12px;
  padding: 8px 12px;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 13px;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
}

.modal-cancel-btn {
  padding: 8px 20px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
}

.modal-cancel-btn:hover {
  background-color: var(--color-bg);
}

/* Responsive */
@media (max-width: 768px) {
  .conversations-layout {
    flex-direction: column;
  }

  .conversation-list-pane {
    width: 100%;
    min-width: 100%;
    max-height: 40%;
  }

  .message-bubble {
    max-width: 85%;
  }
}
</style>
