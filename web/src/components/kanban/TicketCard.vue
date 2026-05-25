<script setup lang="ts">
import { computed } from 'vue';
import type { Ticket, Column } from '../../api';
import { useTicketStore } from '../../stores/tickets';

const props = withDefaults(defineProps<{
  ticket: Ticket;
  column: Column;
  isChild?: boolean;
  parentTicket?: Ticket | null;
  compact?: boolean;
  isParentCard?: boolean;
  isExpanded?: boolean;
}>(), {
  isChild: false,
  parentTicket: null,
  compact: false,
  isParentCard: false,
  isExpanded: true,
});

const emit = defineEmits<{
  select: [ticket: Ticket];
  toggle: [];
}>();

const ticketStore = useTicketStore();

const isBlocked = computed(() => {
  // Prefer the store's blocking status, fall back to the ticket's is_blocked
  const storeStatus = (ticketStore.blockingStatus as Record<number, { is_blocked?: boolean } | undefined>)[props.ticket.id];
  if (storeStatus !== undefined) {
    return storeStatus.is_blocked === true;
  }
  return props.ticket.is_blocked === true;
});

const blockingTicketIds = computed(() => {
  // First try the ticket's own blocking_ticket_ids
  const ticketIds = props.ticket.blocking_ticket_ids;
  if (ticketIds && ticketIds.length > 0) {
    return ticketIds;
  }
  // Fall back to the store's blockingStatus blocking_tickets
  const storeStatus = (ticketStore.blockingStatus as Record<number, { blocking_tickets?: { id: number }[] } | undefined>)[props.ticket.id];
  if (storeStatus?.blocking_tickets) {
    return storeStatus.blocking_tickets.map(bt => bt.id);
  }
  return [];
});

const priorityConfig: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: 'var(--color-danger)' },
  2: { label: 'High', color: 'var(--color-warning)' },
  3: { label: 'Medium', color: 'var(--priority-medium)' },
  4: { label: 'Low', color: 'var(--color-primary)' },
  5: { label: 'Trivial', color: 'var(--color-text-tertiary, var(--color-border))' },
};

const priorityInfo = computed(() => {
  const config = priorityConfig[props.ticket.priority] || { label: 'Unknown', color: 'var(--color-border)' };
  return config;
});

const formattedLabels = computed(() => {
  try {
    const parsed = JSON.parse(props.ticket.labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
});

const createdDate = computed(() => {
  try {
    return new Date(props.ticket.created_at).toLocaleDateString();
  } catch {
    return '';
  }
});

function handleSelect(): void {
  emit('select', props.ticket);
}
</script>

<template>
  <div class="ticket-card" :class="{ 'ticket-card--child': isChild, 'ticket-card--compact': compact, 'ticket-card--parent': isParentCard, 'ticket-card--blocked': isBlocked }" @click="handleSelect">
    <div class="ticket-card__priority" :style="{ backgroundColor: priorityInfo.color }" @click.stop="emit('toggle')">
      <span v-if="isParentCard" class="ticket-card__toggle" :class="{ 'ticket-card__toggle--expanded': isExpanded }">
        {{ isExpanded ? '▼' : '▶' }}
      </span>
      <span v-else class="ticket-card__priority-dot" />
    </div>
    <!-- Blocking indicator with native browser tooltip -->
    <div v-if="isBlocked" class="ticket-card__blocker" :title="blockingTicketIds.length > 0 ? 'Blocked by: ' + blockingTicketIds.map(id => '#' + id).join(', ') : 'Blocked'" @click.stop>
      <span class="ticket-card__blocker-icon">🔒</span>
    </div>
    <div class="ticket-card__content">
      <div class="ticket-card__id">#{{ ticket.id }}</div>
      <div class="ticket-card__title">{{ ticket.title }}</div>
      <div class="ticket-card__meta">
        <span class="ticket-card__priority-label" :style="{ color: priorityInfo.color }">
          {{ priorityInfo.label }}
        </span>
        <span v-if="formattedLabels.length > 0" class="ticket-card__labels">
          <span v-for="(label, index) in formattedLabels" :key="index" class="ticket-card__label">
            {{ label }}
          </span>
        </span>
        <span class="ticket-card__date">{{ createdDate }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ticket-card {
  display: flex;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  position: relative;
}

.ticket-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  border-color: var(--color-primary);
}

.ticket-card__priority {
  display: flex;
  align-items: center;
  padding: 2px 0;
}

.ticket-card__priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-surface);
  flex-shrink: 0;
}

.ticket-card__toggle {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
  width: 12px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  line-height: 1;
  padding-top: 2px;
}

.ticket-card__toggle--expanded {
  transform: rotate(0deg);
}

.ticket-card__content {
  flex: 1;
  min-width: 0;
}

.ticket-card__id {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-tertiary, var(--color-text));
  opacity: 0.6;
  margin-bottom: 2px;
}

.ticket-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.ticket-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.ticket-card__priority-label {
  font-weight: 500;
}

.ticket-card__labels {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.ticket-card__label {
  background: var(--color-border);
  color: var(--color-text);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.ticket-card__date {
  color: var(--color-text);
  opacity: 0.6;
  font-size: 11px;
}

.ticket-card__parent-ref {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 2px;
}

.ticket-card__parent-id {
  font-weight: 500;
  color: var(--color-primary);
  opacity: 0.7;
}

.ticket-card--child {
  background: color-mix(in srgb, var(--color-bg) 50%, var(--color-surface));
}

.ticket-card--compact {
  padding: 6px 8px;
}

.ticket-card--compact .ticket-card__title {
  font-size: 13px;
}

.ticket-card--compact .ticket-card__meta {
  display: none;
}

/* Blocking indicator */
.ticket-card__blocker {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 1;
}

.ticket-card__blocker-icon {
  font-size: 14px;
  line-height: 1;
  color: var(--color-danger);
  filter: drop-shadow(0 1px 2px rgba(220, 38, 38, 0.3));
}

.ticket-card--blocked {
  border-left: 3px solid var(--color-danger);
}
</style>
