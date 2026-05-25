<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useTicketStore } from '../../stores/tickets';
import type { Ticket, Column, Transition, Comment as ApiComment } from '../../api';
import TicketSelectDropdown from './TicketSelectDropdown.vue';
import MarkdownRenderer from '../common/MarkdownRenderer.vue';

interface Props {
  ticket: Ticket | null;
  projectSlug: string;
  columns: Column[];
  /** Role ID of the current user (used for comment edit/delete permissions). Human User = 1. */
  userRoleId?: number;
}

const props = withDefaults(defineProps<Props>(), {
  ticket: null,
  userRoleId: () => 1, // Default to Human User role for tests
});

const emit = defineEmits<{
  close: [];
  update: [];
  delete: [];
  resize: [width: number];
}>();

const ticketStore = useTicketStore();

// --- Resizable sidebar state ---
const MIN_WIDTH = 280;
const MAX_WIDTH = 1536;
const DEFAULT_WIDTH = 640;
const HANDLE_WIDTH = 6;
const STORAGE_KEY = 'agent-kanban-sidebar-width';

const isResizing = ref(false);
const panelRef = ref<HTMLElement | null>(null);

// Module-level tracking for resize drag
let _dragStartX = 0;
let _dragStartWidth = 0;

function loadSavedWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage might not be available (e.g., in tests)
  }
  return DEFAULT_WIDTH;
}

const sidebarWidth = ref(loadSavedWidth());

const panelWidth = computed(() => sidebarWidth.value + HANDLE_WIDTH);

function saveWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
}

function handleResizeMove(event: MouseEvent): void {
  if (!isResizing.value) return;
  // The panel is on the right, so dragging left increases width
  const deltaX = event.clientX - _dragStartX;
  const newWidth = clampWidth(_dragStartWidth - deltaX);
  sidebarWidth.value = newWidth;
  saveWidth(newWidth);
  emit('resize', newWidth);
}

function handleResizeEnd(): void {
  if (!isResizing.value) return;
  isResizing.value = false;
  document.documentElement.style.cursor = '';
  document.documentElement.style.userSelect = '';
}

// Attach global listeners when starting resize, remove on unmount
function startListening(): void {
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', handleResizeEnd);
}

function stopListening(): void {
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
}

// Handle mousedown on the resize handle
function onHandleMouseDown(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();

  _dragStartX = event.clientX;
  _dragStartWidth = sidebarWidth.value;

  isResizing.value = true;
  document.documentElement.style.cursor = 'col-resize';
  document.documentElement.style.userSelect = 'none';

  // Remove any existing listeners first to avoid duplicates
  stopListening();

  // Add global listeners for drag
  startListening();
}

// --- Ticket detail section state (unchanged) ---
// Move state
const showMoveDropdown = ref(false);
const selectedTargetColumn = ref('');
const moveComment = ref('');
const isMoving = ref(false);

// Comment state
const newCommentContent = ref('');

// Edit state
const editingDetails = ref(false);
const editTitle = ref('');
const editPriority = ref(0);
const editEstimate = ref(0);
const editLabels = ref('');
const editDescription = ref('');

// Parent ticket selection state
const selectedParentTicket = ref<number | null>(null);

// Dependency state
const showDependencySection = ref(false);
const selectedDependencyTicket = ref<Ticket | null>(null);
const dependencyRelationType = ref('depends_on');

// Delete state
const showDeleteConfirm = ref(false);
const isDeleting = ref(false);

// Comments
const commentsContainer = ref<HTMLDivElement | null>(null);

// Comment edit state
const editingCommentId = ref<number | null>(null);
const editingCommentContent = ref('');

// Comment delete state
const deletingCommentId = ref<number | null>(null);
const isDeletingComment = ref(false);

/** Permission check: can the current user edit this comment? */
function canEditComment(comment: ApiComment): boolean {
  const currentRoleId = props.userRoleId;
  // Human User (role 1) can edit all comments
  if (currentRoleId === 1) return true;
  // Authors can edit their own comments
  return comment.author_role_id === currentRoleId;
}

const priorityOptions = [
  { value: 1, label: 'Urgent', short: 'Urgent' },
  { value: 2, label: 'High', short: 'High' },
  { value: 3, label: 'Medium', short: 'Medium' },
  { value: 4, label: 'Low', short: 'Low' },
  { value: 5, label: 'Trivial', short: 'Trivial' },
];

const relationTypeOptions = [
  { value: 'depends_on', label: 'Depends On' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'relates_to', label: 'Relates To' },
];

const childTickets = computed<Ticket[]>(() => {
  if (!props.ticket) return [];
  return ticketStore.getChildTickets(props.ticket.id);
});

// Blocking info computed properties
const blockingStatus = computed(() => {
  if (!props.ticket) return null;
  return ticketStore.blockingStatus[props.ticket.id] ?? null;
});

const isBlocked = computed(() => {
  // Prefer the store's blocking status, fall back to the ticket's is_blocked
  const storeStatus = (ticketStore.blockingStatus as Record<number, unknown>)[props.ticket?.id ?? 0] as { is_blocked?: boolean } | undefined;
  if (storeStatus !== undefined && storeStatus.is_blocked) {
    return true;
  }
  return props.ticket?.is_blocked === true;
});

const blockingTickets = computed(() => {
  const storeStatus = (ticketStore.blockingStatus as Record<number, { blocking_tickets?: { id: number; relation_type: string }[] } | undefined>)[props.ticket?.id ?? 0];
  if (storeStatus?.blocking_tickets !== undefined) {
    return storeStatus.blocking_tickets;
  }
  // Fall back to ticket's blocking_ticket_ids
  const ids = props.ticket?.blocking_ticket_ids ?? [];
  return ids.map(id => ({ id, relation_type: '' }));
});

async function loadBlockingInfo(): Promise<void> {
  if (!props.ticket) return;
  await ticketStore.fetchTicketBlockers(props.projectSlug, props.ticket.id);
}

const subTicketCount = computed(() => childTickets.value.length);

const availableParentTickets = computed(() => {
  if (!props.ticket) return [];
  return ticketStore.tickets
    .filter((t) => t.id !== props.ticket!.id)
    .sort((a, b) => a.id - b.id);
});

const availableDependencyTickets = computed(() => {
  if (!props.ticket) return [];
  return ticketStore.tickets
    .filter((t) => t.id !== props.ticket!.id)
    .sort((a, b) => a.id - b.id);
});

const currentColumn = computed(() => {
  if (props.ticket?.column) return props.ticket.column;
  if (props.ticket?.column_id != null) {
    return props.columns.find((c) => c.id === props.ticket!.column_id) || null;
  }
  return null;
});

const dependencyTicketMap = computed(() => {
  const map = new Map<number, Ticket>();
  for (const dep of ticketStore.dependencies) {
    const ticket = ticketStore.tickets.find((t) => t.id === dep.depends_on_id);
    if (ticket) {
      map.set(dep.depends_on_id, ticket);
    }
  }
  return map;
});

const sortedComments = computed<ApiComment[]>(() => {
  if (!props.ticket?.comments) return [];
  return [...props.ticket.comments].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
});

const allowedTransitions = computed<Transition[]>(() => {
  if (!props.ticket || !currentColumn.value) return [];
  const col = currentColumn.value;
  const filtered = ticketStore.transitions.filter((t) => {
    return t.toColumnSlug !== col.slug;
  });
  // Deduplicate by toColumnSlug, keeping the most restrictive (requiresComment=true wins)
  const seen = new Map<string, Transition>();
  for (const t of filtered) {
    const existing: Transition | undefined = seen.get(t.toColumnSlug);
    if (!existing) {
      seen.set(t.toColumnSlug, t);
    } else if (!existing.requiresComment && t.requiresComment) {
      seen.set(t.toColumnSlug, t);
    }
  }
  return [...seen.values()];
});

const selectedTransition = computed<Transition | undefined>(() => {
  if (!selectedTargetColumn.value) return undefined;
  return allowedTransitions.value.find((t) => t.toColumnSlug === selectedTargetColumn.value);
});

const isCurrentColumn = computed(() => {
  return (slug: string) => currentColumn.value?.slug === slug;
});

const hasEdits = computed(() => {
  const currentLabels = parseLabels(props.ticket?.labels ?? '');
  const editedLabels = parseLabels(editLabels.value);
  const labelsEqual =
    currentLabels.length === editedLabels.length &&
    currentLabels.every((l, i) => l === editedLabels[i]);
  return (
    editTitle.value !== (props.ticket?.title ?? '') ||
    editPriority.value !== (props.ticket?.priority ?? 0) ||
    editEstimate.value !== (props.ticket?.estimate ?? 0) ||
    !labelsEqual ||
    editDescription.value !== (props.ticket?.description ?? '') ||
    selectedParentTicket.value !== (props.ticket?.parent_id ?? null)
  );
});

const moveCommentRequired = computed(() => {
  return selectedTransition.value?.requiresComment ?? false;
});

const moveErrorMessage = computed(() => {
  if (!moveCommentRequired.value) return '';
  if (!moveComment.value.trim()) return 'A comment is required for this transition.';
  return '';
});

const lastFetchedTicketId = ref<number>(0);

watch(
  () => props.ticket,
  async (newTicket) => {
    if (newTicket && newTicket.id !== lastFetchedTicketId.value) {
      lastFetchedTicketId.value = newTicket.id;
      selectedTargetColumn.value = '';
      moveComment.value = '';
      newCommentContent.value = '';
      editingDetails.value = false;
      showMoveDropdown.value = false;
      showDependencySection.value = false;
      selectedDependencyTicket.value = null;
      dependencyRelationType.value = 'depends_on';
      editTitle.value = newTicket.title ?? '';
      editPriority.value = newTicket.priority;
      editEstimate.value = newTicket.estimate ?? 0;
      editLabels.value = newTicket.labels ? parseLabels(newTicket.labels).join(', ') : '';
      editDescription.value = newTicket.description ?? '';
      if (newTicket.comments && newTicket.comments.length > 0) {
        // Comments already loaded from ticket list, skip API call
      } else {
        await ticketStore.refreshSelectedTicketComments(props.projectSlug, newTicket.id);
      }
      ticketStore.fetchTransitions(props.projectSlug, newTicket.id);
      // Load blocking info
      await loadBlockingInfo();
    }
  },
  { immediate: true }
);

async function handleMoveColumn(): Promise<void> {
  if (!props.ticket || !selectedTargetColumn.value) return;
  if (moveCommentRequired.value && !moveComment.value.trim()) return;

  isMoving.value = true;
  try {
    const success = await ticketStore.moveTicket(props.projectSlug, props.ticket.id, {
      to_column: selectedTargetColumn.value,
      comment: moveComment.value || undefined,
    });
    if (success) {
      emit('update');
      selectedTargetColumn.value = '';
      moveComment.value = '';
      showMoveDropdown.value = false;
    }
  } finally {
    isMoving.value = false;
  }
}

async function handleAddComment(): Promise<void> {
  if (!props.ticket || !newCommentContent.value.trim()) return;
  const success = await ticketStore.addComment(props.projectSlug, props.ticket.id, {
    content: newCommentContent.value.trim(),
  });
  if (success) {
    newCommentContent.value = '';
    await nextTick();
    scrollToBottom();
  }
}

// --- Comment edit handlers ---

function startEditComment(comment: ApiComment): void {
  editingCommentId.value = comment.id;
  editingCommentContent.value = comment.content;
}

function cancelEditComment(): void {
  editingCommentId.value = null;
  editingCommentContent.value = '';
}

async function saveEditComment(commentId: number): Promise<void> {
  if (!props.ticket) return;
  const content = editingCommentContent.value;
  if (!content.trim()) return;

  const success = await ticketStore.updateComment(
    props.projectSlug,
    props.ticket.id,
    commentId,
    { content: content.trim() }
  );
  if (success) {
    editingCommentId.value = null;
    editingCommentContent.value = '';
  }
}

// --- Comment delete handlers ---

function startDeleteComment(commentId: number): void {
  deletingCommentId.value = commentId;
}

function cancelDeleteComment(): void {
  deletingCommentId.value = null;
}

async function confirmDeleteComment(): Promise<void> {
  if (!props.ticket || deletingCommentId.value == null) return;
  isDeletingComment.value = true;
  try {
    const success = await ticketStore.deleteComment(
      props.projectSlug,
      props.ticket.id,
      deletingCommentId.value
    );
    if (success) {
      deletingCommentId.value = null;
    }
  } finally {
    isDeletingComment.value = false;
  }
}

async function handleAddDependency(): Promise<void> {
  if (!props.ticket || !selectedDependencyTicket.value) return;
  const success = await ticketStore.addDependency(
    props.projectSlug,
    props.ticket.id,
    selectedDependencyTicket.value.id,
    dependencyRelationType.value
  );
  if (success) {
    selectedDependencyTicket.value = null;
  }
}

async function handleRemoveDependency(depTicketId: number, relationType: string): Promise<void> {
  if (!props.ticket) return;
  await ticketStore.removeDependency(
    props.projectSlug,
    props.ticket.id,
    depTicketId,
    relationType
  );
}

function handleSelectTicket(ticket: Ticket): void {
  ticketStore.selectTicket(ticket);
}

async function handleDelete(): Promise<void> {
  if (!props.ticket) return;
  showDeleteConfirm.value = false;
  isDeleting.value = true;
  try {
    const success = await ticketStore.deleteTicket(props.projectSlug, props.ticket.id);
    if (success) {
      emit('delete');
    }
  } finally {
    isDeleting.value = false;
  }
}

function startEdit(): void {
  editingDetails.value = true;
  editTitle.value = props.ticket?.title ?? '';
  editPriority.value = props.ticket?.priority ?? 0;
  editEstimate.value = props.ticket?.estimate ?? 0;
  editLabels.value = props.ticket?.labels ? parseLabels(props.ticket.labels).join(', ') : '';
  editDescription.value = props.ticket?.description ?? '';
  selectedParentTicket.value = props.ticket?.parent_id ?? null;
}

async function saveAllEdits(): Promise<void> {
  if (!props.ticket) return;
  const updates: Record<string, unknown> = {};
  if (editTitle.value !== props.ticket.title) updates.title = editTitle.value;
  if (editPriority.value !== props.ticket.priority) updates.priority = editPriority.value;
  if (editEstimate.value !== (props.ticket.estimate ?? 0)) updates.estimate = editEstimate.value || null;
  const currentLabels = parseLabels(props.ticket.labels ?? '');
  const editedLabels = parseLabels(editLabels.value);
  const labelsEqual =
    currentLabels.length === editedLabels.length &&
    currentLabels.every((l, i) => l === editedLabels[i]);
  if (!labelsEqual) updates.labels = serializeLabels(editLabels.value);
  if (editDescription.value !== (props.ticket.description ?? '')) updates.description = editDescription.value;
  if (selectedParentTicket.value !== (props.ticket?.parent_id ?? null)) {
    updates.parent_id = selectedParentTicket.value;
  }

  if (Object.keys(updates).length > 0) {
    const success = await ticketStore.updateTicket(props.projectSlug, props.ticket.id, updates as any);
    if (success) {
      editingDetails.value = false;
      emit('update');
    }
  }
}

function cancelEdit(): void {
  editTitle.value = props.ticket?.title ?? '';
  editPriority.value = props.ticket?.priority ?? 0;
  editEstimate.value = props.ticket?.estimate ?? 0;
  editLabels.value = props.ticket?.labels ?? '';
  editDescription.value = props.ticket?.description ?? '';
  selectedParentTicket.value = props.ticket?.parent_id ?? null;
  editingDetails.value = false;
}

function toggleMoveDropdown(): void {
  showMoveDropdown.value = !showMoveDropdown.value;
  if (showMoveDropdown.value) {
    selectedTargetColumn.value = '';
    moveComment.value = '';
  }
}

function handleBackdropClick(): void {
  emit('close');
}

function handlePanelClick(event: MouseEvent): void {
  event.stopPropagation();
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scrollToBottom(): void {
  if (commentsContainer.value) {
    commentsContainer.value.scrollTop = commentsContainer.value.scrollHeight;
  }
}

function getPriorityInfo(priority: number) {
  return priorityOptions.find(p => p.value === priority) || { value: priority, label: String(priority), short: String(priority) };
}

function getPriorityColorClass(priority: number): string {
  const colors: Record<number, string> = {
    1: '--color-danger',
    2: '--warning-orange',
    3: '--color-primary',
    4: '--color-warning',
    5: '--color-text-secondary',
  };
  return colors[priority] || '--color-text-secondary';
}

function parseLabels(labels: string): string[] {
  if (!labels || !labels.trim()) return [];
  try {
    const parsed = JSON.parse(labels);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    // Fall through to comma-separated parsing
  }
  return labels.split(',').map((l) => l.trim()).filter(Boolean);
}

function serializeLabels(labels: string): string {
  if (!labels || !labels.trim()) return '[]';
  const trimmed = labels.split(',').map((l) => l.trim()).filter(Boolean);
  return JSON.stringify(trimmed);
}

watch(
  () => sortedComments.value.length,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

watch(
  () => props.ticket?.id,
  async () => {
    if (props.ticket) {
      await ticketStore.fetchDependencies(props.projectSlug, props.ticket.id);
    }
  },
  { immediate: true }
);

// Cleanup global drag listeners on unmount
onBeforeUnmount(() => {
  stopListening();
});

defineExpose({ handleBackdropClick, isResizing });
</script>

<template>
  <Teleport to="body">
    <div v-if="ticket" class="ticket-detail-backdrop" @click="handleBackdropClick">
      <div
        ref="panelRef"
        class="ticket-detail-panel"
        :style="{ width: panelWidth + 'px' }"
        @click="handlePanelClick"
      >
        <!-- Resize Handle -->
        <div
          class="ticket-detail__resize-handle"
          :class="{ 'ticket-detail__resize-handle--active': isResizing }"
          :style="{ width: HANDLE_WIDTH + 'px' }"
          @mousedown="onHandleMouseDown"
        ></div>
        <!-- Header -->
        <div class="ticket-detail__header">
          <div class="ticket-detail__header-left">
            <span class="ticket-detail__id">#{{ ticket.id }}</span>
            <h3
              class="ticket-detail__title"
              :class="{ 'ticket-detail__title--editable': !editingDetails }"
              @click="!editingDetails && startEdit()"
              :title="!editingDetails ? 'Click to edit' : ''"
            >
              {{ editingDetails ? (editTitle || ticket.title) : ticket.title }}
            </h3>
          </div>
          <button class="ticket-detail__delete-btn" @click="showDeleteConfirm = true" title="Delete ticket">
            Delete
          </button>
          <button class="ticket-detail__close" @click="emit('close')">
            &times;
          </button>
        </div>

        <!-- Delete Confirmation -->
        <div v-if="showDeleteConfirm" class="td-delete-confirm">
          <div class="td-delete-confirm__overlay" @click="showDeleteConfirm = false"></div>
          <div class="td-delete-confirm__panel">
            <h4 class="td-delete-confirm__title">Delete Ticket</h4>
            <p class="td-delete-confirm__text">
              Are you sure you want to delete <strong>#{{ ticket.id }}: {{ ticket.title }}</strong>?
              This action cannot be undone.
            </p>
            <p class="td-delete-confirm__warning">
              All comments, dependencies, and status history will also be permanently removed.
            </p>
            <div class="td-delete-confirm__actions">
              <button class="td-btn td-btn--secondary" @click="showDeleteConfirm = false">
                Cancel
              </button>
              <button
                class="td-btn td-btn--danger"
                :disabled="isDeleting"
                @click="handleDelete"
              >
                {{ isDeleting ? 'Deleting...' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Scrollable Content -->
        <div class="ticket-detail__content">
          <!-- Status Section -->
          <div class="td-section">
            <div class="td-section__header">
              <span class="td-section__title">Status</span>
            </div>
            <div class="td-section__body">
              <div class="td-status">
                <span class="td-status__left">
                  <span
                    class="td-status__badge"
                    :class="`td-status__badge--${currentColumn?.slug || 'unknown'}`"
                  >
                    {{ currentColumn?.name || 'Unknown' }}
                  </span>
                  <button class="td-status__move-btn" @click="toggleMoveDropdown">
                    Move
                  </button>
                </span>
                <span v-if="isBlocked && blockingTickets.length > 0" class="td-status__blocker" title="This ticket is blocked by: {{ blockingTickets.map(bt => '#' + bt.id).join(', ') }}">
                  Blocked by: {{ blockingTickets.map(bt => '#' + bt.id).join(', ') }}
                </span>
              </div>

              <!-- Move Dropdown -->
              <div v-if="showMoveDropdown" class="td-move-dropdown">
                <div class="td-move-dropdown__grid">
                  <button
                    v-for="transition in allowedTransitions"
                    :key="transition.toColumnSlug"
                    :class="[
                      'td-move-dropdown__item',
                      { 'td-move-dropdown__item--selected': selectedTargetColumn === transition.toColumnSlug },
                    ]"
                    :disabled="isCurrentColumn(transition.toColumnSlug)"
                    @click="selectedTargetColumn = transition.toColumnSlug"
                  >
                    <span class="td-move-dropdown__item-name">
                      {{ columns.find(c => c.slug === transition.toColumnSlug)?.name || transition.toColumnSlug }}
                    </span>
                    <span v-if="transition.requiresComment" class="td-move-dropdown__item-req" title="Comment required">
                      *
                    </span>
                  </button>
                </div>

                <div v-if="selectedTargetColumn" class="td-move-dropdown__comment-section">
                  <label class="td-move-dropdown__comment-label" for="move-comment">
                    {{ moveCommentRequired ? 'Comment (required)' : 'Comment (optional)' }}
                  </label>
                  <textarea
                    id="move-comment"
                    v-model="moveComment"
                    class="td-move-dropdown__comment-textarea"
                    rows="3"
                    placeholder="Describe the reason for this move..."
                  />
                  <p v-if="moveCommentRequired && !moveComment.trim()" class="td-move-dropdown__comment-error">
                    A comment is required for this transition.
                  </p>
                </div>

                <div class="td-move-dropdown__actions">
                  <button class="td-btn td-btn--secondary" @click="showMoveDropdown = false">
                    Cancel
                  </button>
                  <button
                    class="td-btn td-btn--primary"
                    :disabled="!selectedTargetColumn || (moveCommentRequired && !moveComment.trim()) || isMoving"
                    @click="handleMoveColumn"
                  >
                    {{ isMoving ? 'Moving...' : 'Move' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Details Section -->
          <div class="td-section">
            <div class="td-section__header">
              <span class="td-section__title">Details</span>
              <button v-if="!editingDetails" class="td-btn td-btn--ghost" @click="startEdit">
                Edit
              </button>
              <template v-else>
                <button class="td-btn td-btn--ghost" @click="cancelEdit">
                  Cancel
                </button>
                <button
                  class="td-btn td-btn--primary td-btn--sm"
                  :disabled="!hasEdits"
                  @click="saveAllEdits"
                >
                  Save
                </button>
              </template>
            </div>
            <div class="td-section__body">
              <!-- View Mode -->
              <template v-if="!editingDetails">
                <div class="td-detail-grid">
                  <!-- Priority -->
                  <div class="td-detail-item" @click="startEdit">
                    <span class="td-detail-item__label">Priority</span>
                    <span class="td-detail-item__value">
                      <span
                        class="td-badge"
                        :class="`td-badge--priority-${ticket.priority}`"
                      >
                        {{ getPriorityInfo(ticket.priority).label }}
                      </span>
                      <span class="td-detail-item__hint">Click to edit</span>
                    </span>
                  </div>

                  <!-- Estimate -->
                  <div class="td-detail-item" @click="startEdit">
                    <span class="td-detail-item__label">Estimate</span>
                    <span class="td-detail-item__value">
                      <span v-if="ticket.estimate != null">{{ ticket.estimate }}h</span>
                      <span v-else class="td-detail-item__empty">Not set</span>
                      <span class="td-detail-item__hint">Click to edit</span>
                    </span>
                  </div>

                  <!-- Labels -->
                  <div class="td-detail-item" @click="startEdit">
                    <span class="td-detail-item__label">Labels</span>
                    <span class="td-detail-item__value">
                      <template v-if="parseLabels(ticket.labels).length">
                        <span
                          v-for="(label, idx) in parseLabels(ticket.labels)"
                          :key="idx"
                          class="td-tag"
                        >
                          {{ label }}
                        </span>
                      </template>
                      <span v-else class="td-detail-item__empty">No labels</span>
                      <span class="td-detail-item__hint">Click to edit</span>
                    </span>
                  </div>

                  <!-- Description -->
                  <div class="td-detail-item td-detail-item--description" @click="startEdit">
                    <span class="td-detail-item__label">Description</span>
                    <span class="td-detail-item__value">
                      <MarkdownRenderer v-if="ticket.description" :content="ticket.description" />
                      <span v-else class="td-detail-item__empty">No description</span>
                      <span class="td-detail-item__hint">Click to edit</span>
                    </span>
                  </div>
                </div>
              </template>

              <!-- Edit Mode -->
              <template v-else>
                <div class="td-edit-form">
                  <div class="td-form-item td-form-item--large">
                    <label class="td-form-item__label" for="edit-title">Title</label>
                    <input
                      id="edit-title"
                      v-model="editTitle"
                      type="text"
                      class="td-form-item__input"
                      placeholder="Ticket title"
                    />
                  </div>

                  <div class="td-form-item">
                    <label class="td-form-item__label" for="edit-priority">Priority</label>
                    <select id="edit-priority" v-model.number="editPriority" class="td-form-item__input td-form-item__select">
                      <option v-for="opt in priorityOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>

                  <div class="td-form-item">
                    <label class="td-form-item__label" for="edit-estimate">Estimate (hours)</label>
                    <input
                      id="edit-estimate"
                      v-model.number="editEstimate"
                      type="number"
                      min="0"
                      step="0.5"
                      class="td-form-item__input"
                      placeholder="e.g. 4 or 2.5"
                    />
                  </div>

                  <div class="td-form-item">
                    <label class="td-form-item__label" for="edit-labels">Labels</label>
                    <input
                      id="edit-labels"
                      v-model="editLabels"
                      type="text"
                      class="td-form-item__input"
                      placeholder="Comma-separated labels"
                    />
                  </div>

                  <div class="td-form-item td-form-item--large">
                    <label class="td-form-item__label" for="edit-description">Description</label>
                    <textarea
                      id="edit-description"
                      v-model="editDescription"
                      class="td-form-item__input td-form-item__textarea"
                      rows="4"
                      placeholder="Describe this ticket..."
                    />
                  </div>

                  <div class="td-form-item">
                    <label class="td-form-item__label" for="edit-parent">Parent Ticket</label>
                    <TicketSelectDropdown
                      :tickets="availableParentTickets"
                      :selected-id="selectedParentTicket"
                      :exclude-ids="[ticket?.id]"
                      placeholder="Select a parent ticket..."
                      allow-none
                      @select="(id: number | null) => { selectedParentTicket = id; }"
                    />
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Sub-tickets Section -->
          <div class="td-section" v-if="ticket?.parent_id != null || ticketStore.isParentTicket(ticket?.id ?? 0)">
            <div class="td-section__header">
              <span class="td-section__title">Sub-tickets</span>
              <span class="td-section__count">{{ subTicketCount }}</span>
            </div>
            <div class="td-section__body">
              <!-- Parent reference -->
              <div v-if="ticket?.parent_id != null" class="td-sub-parent">
                <span class="td-sub-parent__label">Parent:</span>
                <button
                  class="td-sub-parent__link"
                  @click="handleSelectTicket(ticketStore.getParentTicket(ticket!.id!)!)"
                >
                  #{{ ticket.parent_id }} {{ ticketStore.tickets.find(t => t.id === ticket!.parent_id)?.title || '' }}
                </button>
              </div>
              <!-- Child tickets list -->
              <div v-if="childTickets.length > 0">
                <div
                  v-for="child in childTickets"
                  :key="child.id"
                  class="td-sub-item"
                  @click="handleSelectTicket(child)"
                >
                  <span class="td-sub-item__title">#{{ child.id }} - {{ child.title }}</span>
                  <span class="td-sub-item__status">{{ columns.find(c => c.id === child.column_id)?.name || child.column?.name || '' }}</span>
                  <span class="td-sub-item__closed" v-if="child.closed_at">✓</span>
                </div>
              </div>
              <div v-else class="td-empty">
                No sub-tickets
              </div>
            </div>
          </div>

          <!-- Dependencies Section -->
          <div class="td-section">
            <div class="td-section__header">
              <span class="td-section__title">Dependencies</span>
              <button class="td-btn td-btn--ghost" @click="showDependencySection = !showDependencySection">
                {{ showDependencySection ? 'Hide' : 'Show' }}
              </button>
            </div>
            <div v-if="showDependencySection" class="td-section__body">
              <div v-if="ticketStore.dependencies.length === 0" class="td-empty">
                No dependencies
              </div>
              <div v-else>
                <div
                  v-for="dep in ticketStore.dependencies"
                  :key="`${dep.ticket_id}-${dep.depends_on_id}-${dep.relation_type}`"
                  class="td-dep-item"
                >
                  <span class="td-dep-item__type">{{ dep.relation_type.replace(/_/g, ' ') }}</span>
                  <span class="td-dep-item__ref">#{{ dep.depends_on_id }} {{ dependencyTicketMap.get(dep.depends_on_id)?.title }}</span>
                  <button
                    class="td-dep-item__remove"
                    @click="handleRemoveDependency(dep.depends_on_id, dep.relation_type)"
                    title="Remove dependency"
                  >&times;</button>
                </div>
              </div>
              <div class="td-dep-add">
                <div class="td-dep-add__dropdown">
                  <TicketSelectDropdown
                    :tickets="availableDependencyTickets"
                    :selected-id="selectedDependencyTicket?.id ?? null"
                    placeholder="Find ticket to depend on..."
                    @select="(id: number | null) => {
                      selectedDependencyTicket = id ? availableDependencyTickets.find(t => t.id === id) || null : null;
                    }"
                  />
                </div>
                <select v-model="dependencyRelationType" class="td-form-item__select td-dep-add__select">
                  <option v-for="opt in relationTypeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <button
                  class="td-btn td-btn--primary td-btn--sm"
                  :disabled="!selectedDependencyTicket"
                  @click="handleAddDependency"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <!-- Comments Section -->
          <div class="td-section td-section--comments">
            <div class="td-section__header">
              <span class="td-section__title">Comments</span>
              <span class="td-section__count">{{ sortedComments.length }}</span>
            </div>
            <div class="td-section__body td-comments">
              <div ref="commentsContainer" class="td-comments__list">
                <div
                  v-for="(comment, idx) in sortedComments"
                  :key="comment.id"
                  class="td-comment"
                  :class="{ 'td-comment--even': idx % 2 === 0, 'td-comment--editing': editingCommentId === comment.id }"
                >
                  <div class="td-comment__header">
                    <span class="td-comment__role">{{ comment.author_role_name || `Role #${comment.author_role_id}` }}</span>
                    <span v-if="comment.action_type" class="td-comment__action">
                      {{ comment.action_type.replace(/_/g, ' ') }}
                    </span>
                    <span class="td-comment__time">{{ formatTimestamp(comment.created_at) }}</span>
                    <!-- Comment action buttons -->
                    <template v-if="editingCommentId !== comment.id">
                      <button
                        v-if="canEditComment(comment as any)"
                        class="td-btn td-btn--ghost td-btn--sm td-comment__action-btn"
                        title="Edit comment"
                        @click="startEditComment(comment as any)"
                      >&#9998;</button>
                      <button
                        v-if="canEditComment(comment as any)"
                        class="td-btn td-btn--ghost td-btn--sm td-comment__action-btn td-comment__action-btn--delete"
                        title="Delete comment"
                        @click="startDeleteComment(comment.id)"
                      >&#128465;</button>
                    </template>
                  </div>
                  <!-- Edit mode: textarea with raw markdown -->
                  <div v-if="editingCommentId === comment.id" class="td-comment__content td-comment__content--edit">
                    <textarea
                      v-model="editingCommentContent"
                      class="td-comments__textarea td-comment__edit-textarea"
                      rows="3"
                      placeholder="Edit comment..."
                    />
                    <div class="td-comment__edit-actions">
                      <button
                        class="td-btn td-btn--ghost"
                        @click="cancelEditComment"
                      >Cancel</button>
                      <button
                        class="td-btn td-btn--primary td-btn--sm"
                        :disabled="!editingCommentContent.trim()"
                        @click="saveEditComment(comment.id)"
                      >Save</button>
                    </div>
                  </div>
                  <!-- View mode: rendered markdown -->
                  <div v-else class="td-comment__content">
                    <MarkdownRenderer :content="comment.content" />
                  </div>
                </div>
                <div v-if="sortedComments.length === 0" class="td-comments__empty">
                  No comments yet
                </div>
              </div>
              <div class="td-comments__input">
                <textarea
                  v-model="newCommentContent"
                  class="td-comments__textarea"
                  rows="3"
                  placeholder="Write a comment..."
                  @keydown.enter="(e: KeyboardEvent) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }"
                />
                <button
                  class="td-btn td-btn--primary"
                  :disabled="!newCommentContent.trim()"
                  @click="handleAddComment"
                >
                  Comment
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Comment Delete Confirmation -->
        <div v-if="deletingCommentId != null" class="td-delete-confirm">
          <div class="td-delete-confirm__overlay" @click="cancelDeleteComment"></div>
          <div class="td-delete-confirm__panel">
            <h4 class="td-delete-confirm__title">Delete Comment</h4>
            <p class="td-delete-confirm__text">
              Are you sure you want to delete this comment?
              This action cannot be undone.
            </p>
            <div class="td-delete-confirm__actions">
              <button class="td-btn td-btn--secondary" @click="cancelDeleteComment">
                Cancel
              </button>
              <button
                class="td-btn td-btn--danger"
                :disabled="isDeletingComment"
                @click="confirmDeleteComment"
              >
                {{ isDeletingComment ? 'Deleting...' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ticket-detail__footer">
          <div class="td-meta">
            <span class="td-meta__item">
              <span class="td-meta__label">Created</span>
              <span class="td-meta__value">{{ formatTimestamp(ticket.created_at) }}</span>
            </span>
            <span class="td-meta__item">
              <span class="td-meta__label">Updated</span>
              <span class="td-meta__value">{{ formatTimestamp(ticket.updated_at) }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Backdrop */
.ticket-detail-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1100;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Panel */
.ticket-detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  z-index: 1200;
  transform: translateX(100%);
  transition: transform 0.2s ease;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.1);
  min-width: 280px;
  max-width: 1536px;
}

.ticket-detail-panel,
.ticket-detail-panel:hover {
  transform: translateX(0);
}

/* Resize Handle */
.ticket-detail__resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s ease;
}

.ticket-detail__resize-handle:hover,
.ticket-detail__resize-handle--active {
  background: var(--color-primary);
  opacity: 0.3;
}

.ticket-detail__resize-handle--active {
  opacity: 0.5;
}

@media (max-width: 900px) {
  .ticket-detail-panel {
    width: 100%;
    min-width: unset;
    max-width: 100%;
  }
  .ticket-detail__resize-handle {
    display: none;
  }
}

/* Header */
.ticket-detail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.ticket-detail__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ticket-detail__id {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ticket-detail__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ticket-detail__title--editable {
  cursor: pointer;
  transition: color 0.1s ease;
}

.ticket-detail__title--editable:hover {
  color: var(--color-primary);
}

.ticket-detail__close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
}

.ticket-detail__close:hover {
  color: var(--color-text);
}

.ticket-detail__delete-btn {
  background: none;
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 12px;
  margin-right: 8px;
  transition: background 0.15s ease;
}

.ticket-detail__delete-btn:hover {
  background: var(--color-danger);
  color: #fff;
}

/* Delete Confirmation */
.td-delete-confirm {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1300;
}

.td-delete-confirm__overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
}

.td-delete-confirm__panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  max-width: 440px;
  width: 90%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  z-index: 1;
}

.td-delete-confirm__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 12px;
}

.td-delete-confirm__text {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.5;
  margin: 0 0 8px;
}

.td-delete-confirm__warning {
  font-size: 13px;
  color: var(--color-danger);
  margin: 0 0 16px;
}

.td-delete-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Content */
.ticket-detail__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

/* Sections */
.td-section {
  margin-bottom: 20px;
}

.td-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.td-section__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
}

.td-section__count {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  padding: 2px 8px;
  border-radius: 10px;
}

.td-section__body {
  margin-top: 8px;
}

/* Status */
.td-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.td-status__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.td-status__badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.td-status__badge--done,
.td-status__badge--closed {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
}

.td-status__badge--in_progress,
.td-status__badge--wip {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
}

.td-status__move-btn {
  padding: 4px 14px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.td-status__move-btn:hover {
  opacity: 0.85;
}

.td-status__blocker {
  margin-left: 8px;
  font-size: 11px;
  color: var(--color-danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Move Dropdown */
.td-move-dropdown {
  margin-top: 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}

.td-move-dropdown__grid {
  max-height: 180px;
  overflow-y: auto;
  padding: 4px;
}

.td-move-dropdown__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  text-align: left;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s ease;
}

.td-move-dropdown__item:hover:not(:disabled) {
  background: var(--color-border);
}

.td-move-dropdown__item--selected {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  font-weight: 500;
  color: var(--color-primary);
}

.td-move-dropdown__item--selected .td-move-dropdown__item-name {
  font-weight: 600;
}

.td-move-dropdown__item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.td-move-dropdown__item-name {
  font-size: 13px;
}

.td-move-dropdown__item-req {
  color: var(--color-danger);
  font-weight: 700;
  font-size: 14px;
}

.td-move-dropdown__comment-section {
  padding: 12px;
  border-top: 1px solid var(--color-border);
}

.td-move-dropdown__comment-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 6px;
}

.td-move-dropdown__comment-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-surface);
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.td-move-dropdown__comment-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.td-move-dropdown__comment-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-danger);
}

.td-move-dropdown__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

/* Detail Grid */
.td-detail-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.td-detail-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.td-detail-item:hover {
  background: var(--color-bg);
}

.td-detail-item__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  min-width: 72px;
  padding-top: 2px;
  flex-shrink: 0;
}

.td-detail-item__value {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  overflow-wrap: break-word;
  word-wrap: break-word;
  hyphens: auto;
}

.td-detail-item__empty {
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 13px;
}

.td-detail-item__hint {
  font-size: 11px;
  color: var(--color-text-secondary);
  opacity: 0;
  transition: opacity 0.1s ease;
}

.td-detail-item:hover .td-detail-item__hint {
  opacity: 1;
}

.td-detail-item--description {
  cursor: default;
}

.td-detail-item--description .td-detail-item__hint {
  opacity: 1;
}

.td-detail-item--description .td-detail-item__value {
  cursor: pointer;
}

/* Badges & Tags */
.td-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.td-badge--priority-1 {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.td-badge--priority-2 {
  background: color-mix(in srgb, var(--priority-orange, #f97316) 15%, transparent);
  color: var(--priority-orange, #f97316);
}

.td-badge--priority-3 {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}

.td-badge--priority-4 {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  color: var(--color-warning);
}

.td-badge--priority-5 {
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary);
}

.td-tag {
  display: inline-block;
  padding: 2px 8px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text);
  margin-right: 4px;
}

.td-description {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-wrap: break-word;
  hyphens: auto;
}

/* Edit Form */
.td-edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.td-form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.td-form-item--large {
  flex: 1;
}

.td-form-item__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
}

.td-form-item__input,
.td-form-item__select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  box-sizing: border-box;
  transition: border-color 0.15s ease;
  font-family: inherit;
}

.td-form-item__input:focus,
.td-form-item__select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.td-form-item__textarea {
  resize: vertical;
  font-family: inherit;
}

/* Dependencies */
.td-dep-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}

.td-dep-item__type {
  color: var(--color-text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.td-dep-item__ref {
  font-weight: 600;
  color: var(--color-primary);
}

.td-dep-item__remove {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
}

.td-dep-item__remove:hover {
  color: var(--color-danger);
}

.td-dep-add {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.td-dep-add__input {
  flex: 1;
}

.td-dep-add__select {
  width: auto;
  min-width: 100px;
}

.td-dep-add__dropdown {
  flex: 1;
  min-width: 0;
}

/* Comments */
.td-section--comments {
  margin-bottom: 0;
}

.td-comments {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.td-comments__list {
  min-height: 200px;
  max-height: 60vh;
  overflow-y: auto;
  margin: 0 -4px;
  padding: 0 4px;
}

.td-comment {
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 4px;
}

.td-comment--even {
  background: var(--color-bg);
}

.td-comment__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
}

.td-comment__role {
  font-weight: 600;
  color: var(--color-text);
}

.td-comment__action {
  padding: 1px 6px;
  background: var(--color-border);
  border-radius: 4px;
  font-size: 10px;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}

.td-comment__time {
  margin-left: auto;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.td-comment__content {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.5;
  overflow-wrap: break-word;
  word-wrap: break-word;
  hyphens: auto;
}

/* Comment edit mode */
.td-comment__content--edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.td-comment__edit-textarea {
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}

.td-comment__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Comment action buttons (edit/delete) */
.td-comment__action-btn {
  margin-left: 4px;
  opacity: 0.5;
  transition: opacity 0.15s ease;
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
}

.td-comment__header:hover .td-comment__action-btn {
  opacity: 1;
}

.td-comment__action-btn--delete:hover {
  color: var(--color-danger);
}

/* Comment editing highlight */
.td-comment--editing {
  border: 1px solid var(--color-primary);
  border-radius: 8px;
}

.td-comments__empty {
  text-align: center;
  padding: 24px;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 13px;
}

.td-comments__input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.td-comments__textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.td-comments__textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

/* Buttons */
.td-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s ease, background 0.15s ease;
  white-space: nowrap;
}

.td-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.td-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.td-btn--sm {
  padding: 4px 10px;
  font-size: 12px;
}

.td-btn--primary {
  background: var(--color-primary);
  color: #fff;
}

.td-btn--secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text);
}

.td-btn--ghost {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  padding: 4px 8px;
  font-size: 12px;
}

.td-btn--ghost:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.td-btn--danger {
  background: var(--color-danger);
  color: #fff;
  border-color: var(--color-danger);
}

.td-btn--danger:hover:not(:disabled) {
  opacity: 0.85;
}

.ticket-detail__id {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

/* Empty */
.td-empty {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-style: italic;
  padding: 8px 0;
}

/* Footer */
.ticket-detail__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  background: var(--color-bg);
}

.td-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.td-meta__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.td-meta__label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
}

.td-meta__value {
  font-size: 12px;
  color: var(--color-text);
}

/* Sub-tickets */
.td-sub-parent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 13px;
}

.td-sub-parent__label {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.td-sub-parent__link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.td-sub-parent__link:hover {
  opacity: 0.8;
}

.td-sub-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s ease;
  font-size: 13px;
  margin-bottom: 4px;
}

.td-sub-item:hover {
  background: var(--color-bg);
}

.td-sub-item__title {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.td-sub-item__status {
  color: var(--color-text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

.td-sub-item__closed {
  color: var(--color-success);
  font-size: 14px;
  flex-shrink: 0;
}

/* Warning / Blocked By Section */
.td-section--warning {
  border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 4%, transparent);
  padding: 0 4px;
  margin-bottom: 20px;
}

.td-section--warning .td-section__header {
  margin-bottom: 10px;
}

.td-section__icon {
  margin-right: 4px;
  font-size: 12px;
}

.td-blocker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-danger) 20%, transparent);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s ease, border-color 0.1s ease;
}

.td-blocker-item:hover {
  background: var(--color-bg);
  border-color: var(--color-danger);
}

.td-blocker-item__id {
  font-weight: 700;
  color: var(--color-danger);
  font-size: 12px;
  flex-shrink: 0;
}

.td-blocker-item__title {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.td-blocker-item__type {
  font-size: 11px;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
</style>
