<script setup lang="ts">
import { computed, onMounted, watch, ref, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useTicketStore } from '../stores/tickets';
import { useProjectStore } from '../stores/projects';
import { useSSE } from '../composables/useSSE';
import KanbanBoard from '../components/kanban/KanbanBoard.vue';
import TicketDetail from '../components/tickets/TicketDetail.vue';
import TicketSelectDropdown from '../components/tickets/TicketSelectDropdown.vue';
import type { Ticket, Column, CreateTicketPayload, Comment as ApiComment } from '../api';

const route = useRoute();
const ticketStore = useTicketStore();
const projectStore = useProjectStore();

const { slug } = route.params as { slug: string };

// --- Resizable modal state (width + height) ---
const MODAL_STORAGE_KEY = 'new-ticket-modal-width';
const MODAL_HEIGHT_KEY = 'new-ticket-modal-height';
const DEFAULT_MODAL_WIDTH = 640;
const DEFAULT_MODAL_HEIGHT = 800;
const MIN_MODAL_WIDTH = 400;
const MIN_MODAL_HEIGHT = 300;

function loadSavedModalWidth(): number {
  try {
    const saved = localStorage.getItem(MODAL_STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_MODAL_WIDTH && parsed <= Math.floor(window.innerWidth * 0.9)) {
        return parsed;
      }
    }
  } catch {
    // localStorage might not be available (e.g., in tests)
  }
  return DEFAULT_MODAL_WIDTH;
}

function loadSavedModalHeight(): number {
  try {
    const saved = localStorage.getItem(MODAL_HEIGHT_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_MODAL_HEIGHT && parsed <= Math.floor(window.innerHeight * 0.9)) {
        return parsed;
      }
    }
  } catch {
    // localStorage might not be available (e.g., in tests)
  }
  return DEFAULT_MODAL_HEIGHT;
}

const modalWidth = ref(loadSavedModalWidth());
const modalHeight = ref(loadSavedModalHeight());
let isResizing = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartWidth = 0;
let dragStartHeight = 0;

function onMouseMove(e: MouseEvent): void {
  if (!isResizing) return;
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  const newWidth = Math.min(
    Math.floor(window.innerWidth * 0.9),
    Math.max(MIN_MODAL_WIDTH, dragStartWidth + deltaX)
  );
  const newHeight = Math.min(
    Math.floor(window.innerHeight * 0.9),
    Math.max(MIN_MODAL_HEIGHT, dragStartHeight + deltaY)
  );
  modalWidth.value = newWidth;
  modalHeight.value = newHeight;
}

function onMouseUp(): void {
  if (!isResizing) return;
  isResizing = false;
  try {
    localStorage.setItem(MODAL_STORAGE_KEY, String(modalWidth.value));
    localStorage.setItem(MODAL_HEIGHT_KEY, String(modalHeight.value));
  } catch {
    // ignore
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.documentElement.style.cursor = '';
}

function onResizeHandleMouseDown(e: MouseEvent): void {
  e.preventDefault();
  isResizing = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartWidth = modalWidth.value;
  dragStartHeight = modalHeight.value;
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.documentElement.style.cursor = 'nwse-resize';
}

const showNewTicketModal = ref(false);
const newTicketForm = ref({
  title: '',
  column: '',
  priority: 2,
  parentId: '',
  description: '',
  labels: '',
  estimate: '',
});

const currentProject = computed(() => projectStore.currentProject);

const availableColumns = computed<Column[]>(() => {
  if (ticketStore.columns.length > 0) {
    return ticketStore.columns;
  }
  if (currentProject.value?.columns) {
    return currentProject.value.columns;
  }
  return [];
});

const defaultColumn = computed(() => {
  if (newTicketForm.value.column) {
    return newTicketForm.value.column;
  }
  const firstColumn = availableColumns.value[0];
  return firstColumn ? firstColumn.slug : '';
});

const availableParentTickets = computed(() => {
  return ticketStore.tickets
    .filter((t) => t.parent_id == null)
    .sort((a, b) => a.id - b.id);
});

const selectedParentTicket = ref<Ticket | null>(null);

function handleParentTicketSelect(id: number | null): void {
  selectedParentTicket.value = id ? availableParentTickets.value.find(t => t.id === id) || null : null;
  newTicketForm.value.parentId = id ? String(id) : '';
}

function openNewTicketModal(columnSlug?: string): void {
  newTicketForm.value = {
    title: '',
    column: columnSlug || defaultColumn.value,
    priority: 3,
    parentId: '',
    description: '',
    labels: '',
    estimate: '',
  };
  showNewTicketModal.value = true;
}

function closeNewTicketModal(): void {
  showNewTicketModal.value = false;
  selectedParentTicket.value = null;
}

async function handleNewTicket(): Promise<void> {
  if (!newTicketForm.value.title.trim()) {
    return;
  }

  const payload: CreateTicketPayload = {
    column: newTicketForm.value.column || defaultColumn.value,
    title: newTicketForm.value.title.trim(),
    description: newTicketForm.value.description.trim(),
    labels: newTicketForm.value.labels.trim()
      ? JSON.stringify(newTicketForm.value.labels.split(',').map((l) => l.trim()).filter(Boolean))
      : '[]',
    priority: newTicketForm.value.priority,
    estimate: newTicketForm.value.estimate.trim()
      ? parseFloat(newTicketForm.value.estimate) || null
      : null,
    parent_id: newTicketForm.value.parentId ? parseInt(newTicketForm.value.parentId, 10) : null,
  };

  const success = await ticketStore.createTicket(slug, payload);
  if (success) {
    closeNewTicketModal();
  }
}

async function refreshProject(projectSlug: string): Promise<void> {
  await Promise.all([
    ticketStore.fetchTickets(projectSlug, undefined, { all_tickets: true, done_limit: 8 }),
    ticketStore.fetchColumns(projectSlug),
  ]);
}

// --- SSE Integration ---
const sse = useSSE(slug, {
  handleTicketCreated: (ticket) => {
    ticketStore.insertTicket(ticket as unknown as import('../api').Ticket);
  },
  handleTicketUpdated: (ticket) => {
    ticketStore.updateTicketInline(ticket as unknown as import('../api').Ticket);
  },
  handleTicketMoved: (ticketId, toColumn) => {
    ticketStore.repositionTicket(ticketId, toColumn);
  },
  handleTicketDeleted: (ticketId) => {
    ticketStore.removeTicket(ticketId);
  },
  handleCommentAdded: (ticketId, comment) => {
    ticketStore.addCommentInline(ticketId, comment);
  },
  handleDepAdded: (ticketId, dependsOnId, relationType, projectSlug) => {
    // SSE dep_added: refresh blocking info so kanban cards update in real-time.
    // SSE events get precedence over local updates w.r.t. the blocking state.
    ticketStore.refreshDependencies(ticketId, dependsOnId, projectSlug);
  },
  handleDepRemoved: (ticketId, dependsOnId, relationType, projectSlug) => {
    // SSE dep_removed: refresh blocking info so kanban cards update in real-time.
    // SSE events get precedence over local updates w.r.t. the blocking state.
    ticketStore.refreshDependencies(ticketId, dependsOnId, projectSlug);
  },
});

onMounted(async () => {
  projectStore.setCurrentProject(slug);
  await refreshProject(slug);
  sse.connect();

  // Listen for reposition events from the store to refetch the full project state
  const handleTicketMoved = () => {
    refreshProject(slug);
  };
  window.addEventListener('ticket-moved', handleTicketMoved);

  // Store reference for cleanup
  (window as any).__ticketMovedListener = handleTicketMoved;
});

watch(
  () => route.params.slug,
  async (newSlug) => {
    if (newSlug) {
      projectStore.setCurrentProject(String(newSlug));
      await refreshProject(String(newSlug));
    }
  }
);

// Cleanup global drag listeners on unmount
onBeforeUnmount(() => {
  if (isResizing) {
    onMouseUp();
  }
  document.documentElement.style.cursor = '';
  // Disconnect SSE stream
  sse.disconnect();
  // Cleanup ticket-moved event listener
  window.removeEventListener('ticket-moved', (window as any).__ticketMovedListener);
  delete (window as any).__ticketMovedListener;
});
</script>

<template>
  <div class="project-board">
    <div class="project-board__header">
      <div class="project-board__header-left">
        <h1 class="project-board__title">
          {{ currentProject?.name || slug }}
        </h1>
        <p v-if="ticketStore.error" class="project-board__error">
          {{ ticketStore.error }}
        </p>
      </div>
      <button class="project-board__new-btn" @click="openNewTicketModal()">
        + New Ticket
      </button>
    </div>

    <div :class="['project-board__board', { 'project-board__board--panel-open': !!ticketStore.selectedTicket }]">
      <KanbanBoard
        :project-slug="slug"
        @new-ticket="openNewTicketModal"
        @select-ticket="(ticket: Ticket) => ticketStore.selectTicket(ticket)"
      />
    </div>

    <TicketDetail
      v-if="ticketStore.selectedTicket"
      :ticket="ticketStore.selectedTicket"
      :project-slug="slug"
      :columns="availableColumns"
      @close="ticketStore.deselectTicket()"
      @update="ticketStore.refreshProject(slug)"
      @delete="ticketStore.refreshProject(slug)"
    />

    <div v-if="showNewTicketModal" class="modal-overlay" @click="closeNewTicketModal">
      <div class="modal" :style="{ width: modalWidth + 'px', height: modalHeight + 'px', display: 'flex', 'flex-direction': 'column' }" @click.stop>
        <div class="modal__header">
          <h2 class="modal__title">New Ticket</h2>
          <button class="modal__close" @click="closeNewTicketModal">&times;</button>
        </div>
        <form class="modal__form" @submit.prevent="handleNewTicket">
          <div class="form-group">
            <label class="form-group__label" for="nt-title">Title *</label>
            <input
              id="nt-title"
              v-model="newTicketForm.title"
              type="text"
              class="form-group__input"
              placeholder="Enter ticket title"
              required
              autofocus
            />
          </div>

          <div class="form-group">
            <label class="form-group__label" for="nt-column">Column</label>
            <select
              id="nt-column"
              v-model="newTicketForm.column"
              class="form-group__select"
            >
              <option
                v-for="col in availableColumns"
                :key="col.id"
                :value="col.slug"
              >
                {{ col.name }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-group__label" for="nt-parent">Parent ticket (optional)</label>
            <TicketSelectDropdown
              :tickets="availableParentTickets"
              :selected-id="selectedParentTicket?.id ?? null"
              placeholder="Select parent ticket..."
              :allow-none="true"
              @select="handleParentTicketSelect"
            />
          </div>

          <div class="form-group">
            <label class="form-group__label" for="nt-priority">Priority</label>
            <select
              id="nt-priority"
              v-model.number="newTicketForm.priority"
              class="form-group__select"
            >
              <option :value="1">1 - Urgent</option>
              <option :value="2">2 - High</option>
              <option :value="3">3 - Medium</option>
              <option :value="4">4 - Low</option>
              <option :value="5">5 - Trivial</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-group__label" for="nt-estimate">Estimate</label>
            <input
              id="nt-estimate"
              v-model="newTicketForm.estimate"
              type="number"
              min="0"
              step="0.5"
              class="form-group__input"
              placeholder="Hours"
            />
          </div>

          <div class="form-group form-group--stretch">
            <label class="form-group__label" for="nt-description">Description</label>
            <textarea
              id="nt-description"
              v-model="newTicketForm.description"
              class="form-group__textarea"
              rows="4"
              placeholder="Enter description"
            />
          </div>

          <div class="form-group">
            <label class="form-group__label" for="nt-labels">Labels</label>
            <input
              id="nt-labels"
              v-model="newTicketForm.labels"
              type="text"
              class="form-group__input"
              placeholder="Comma-separated labels"
            />
          </div>

          <div class="modal__actions">
            <button type="button" class="btn btn--secondary" @click="closeNewTicketModal">
              Cancel
            </button>
            <button type="submit" class="btn btn--primary" :disabled="!newTicketForm.title.trim()">
              Create Ticket
            </button>
          </div>
        </form>
        <!-- Resize handle at bottom-right -->
        <div
          class="modal__resize-handle"
          @mousedown="onResizeHandleMouseDown"
          title="Drag to resize"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.project-board__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.project-board__header-left {
  flex: 1;
  min-width: 0;
}

.project-board__title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.project-board__error {
  margin: 4px 0 0;
  color: var(--color-danger);
  font-size: 13px;
}

.project-board__new-btn {
  padding: 8px 16px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s ease;
}

.project-board__new-btn:hover {
  opacity: 0.9;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 0;
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

/* Resize Handle */
.modal__resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  /* Subtle triangular grip */
  background: linear-gradient(
    135deg,
    transparent 50%,
    currentColor 50%,
    currentColor 55%,
    transparent 55%,
    transparent 65%,
    currentColor 65%,
    currentColor 70%,
    transparent 70%
  );
  opacity: 0.25;
  transition: opacity 0.15s ease;
  z-index: 1;
}

.modal__resize-handle:hover {
  opacity: 0.5;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.modal__close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--color-text);
  opacity: 0.5;
  cursor: pointer;
  padding: 0 4px;
}

.modal__close:hover {
  opacity: 1;
}

.modal__form {
  padding: 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.form-group {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
}

.form-group__label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 6px;
}

.form-group__input,
.form-group__select,
.form-group__textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}

.form-group__input:focus,
.form-group__select:focus,
.form-group__textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.form-group__textarea {
  resize: none;
  font-family: inherit;
  min-height: 80px;
  flex: 1;
  align-self: stretch;
}

.form-group--stretch {
  flex: 1;
  min-height: fit-content;
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s ease;
}

.btn:hover {
  opacity: 0.9;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--color-primary);
  color: #fff;
}

.btn--secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text);
}

/* Board wrapper */
.project-board__board {
  flex: 1;
  overflow: hidden;
  position: relative;
  transition: margin-right 0.2s ease;
}

.project-board__board--panel-open {
  margin-right: 0;
}
</style>
