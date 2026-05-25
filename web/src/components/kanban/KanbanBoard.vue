<script setup lang="ts">
import { computed } from 'vue';
import { useTicketStore } from '../../stores/tickets';
import { useProjectStore } from '../../stores/projects';
import KanbanColumn from './KanbanColumn.vue';
import type { Ticket, Column } from '../../api';

const ticketStore = useTicketStore();
const projectStore = useProjectStore();

interface ParentTicketGroup {
  parent: Ticket;
  children: Ticket[];
}

defineProps<{
  projectSlug: string;
}>();

const emit = defineEmits<{
  newTicket: [columnSlug: string];
  selectTicket: [ticket: Ticket];
}>();

function handleSelectTicket(ticket: Ticket): void {
  emit('selectTicket', ticket);
}

function handleAddTicket(columnSlug: string): void {
  emit('newTicket', columnSlug);
}

const sortedColumns = computed(() => {
  return [...ticketStore.columns].sort((a, b) => a.order - b.order);
});

function getTicketsForColumn(columnId: number): Ticket[] {
  const tickets = ticketStore.ticketsByColumn[columnId] || [];
  return tickets.sort((a, b) => a.priority - b.priority);
}

function getParentTicketGroups(columnId: number): ParentTicketGroup[] {
  const groups = ticketStore.getChildTicketsForColumn(columnId);
  return groups.filter((g) => {
    const hasTickets = g.children.some((c) => c.column_id === columnId);
    return hasTickets;
  });
}

const crossColumnParentMap = computed<Record<number, Ticket>>(() => {
  const map: Record<number, Ticket> = {};
  for (const [parentIdStr, children] of Object.entries(ticketStore.orphanChildTickets)) {
    const parentId = Number(parentIdStr);
    const parent = ticketStore.tickets.find((t) => t.id === parentId);
    if (!parent) continue;
    for (const child of children) {
      map[child.id] = parent;
    }
  }
  return map;
});

const crossColumnChildIds = computed<Set<number>>(() => {
  const ids = new Set<number>();
  for (const children of Object.values(ticketStore.orphanChildTickets)) {
    for (const child of children) {
      ids.add(child.id);
    }
  }
  return ids;
});

const doneCol = computed(() => {
  return ticketStore.columns.find((c) => c.slug === 'done');
});

const doneHasMore = computed(() => {
  return ticketStore.doneColumnHasMore;
});

const doneCountLoaded = computed(() => {
  const col = doneCol.value;
  if (!col) return 0;
  const individualCount = ticketStore.ticketsByColumn[col.id]?.length ?? 0;
  // Also count child tickets displayed inside TicketSubTicketsGroup boxes
  const groups = ticketStore.getChildTicketsForColumn(col.id);
  const childCount = groups.reduce((sum, g) => {
    return sum + g.children.filter((c) => c.column_id === col.id).length;
  }, 0);
  return individualCount + childCount;
});

const doneTotalCount = computed(() => {
  return ticketStore.doneTicketsTotal;
});
</script>

<template>
  <div class="kanban-board">
    <div v-if="ticketStore.loading" class="kanban-board__loading">
      Loading board...
    </div>
    <div v-else-if="ticketStore.error" class="kanban-board__error">
      {{ ticketStore.error }}
    </div>
    <div v-else class="kanban-board__columns">
      <KanbanColumn
        v-for="column in sortedColumns"
        :key="column.id"
        :column="column"
        :tickets="getTicketsForColumn(column.id)"
        :parent-ticket-groups="getParentTicketGroups(column.id)"
        :cross-column-children-ids="crossColumnChildIds"
        :cross-column-parent-map="crossColumnParentMap"
        :has-more-done="column.slug === 'done' && doneHasMore"
        :show-all-done="column.slug === 'done' ? ticketStore.showAllDone : false"
        :done-count-loaded="column.slug === 'done' ? doneCountLoaded : 0"
        :done-total-count="column.slug === 'done' ? doneTotalCount : 0"
        @select-ticket="handleSelectTicket"
        @add-ticket="handleAddTicket"
        @load-more-done="ticketStore.loadMoreDone(projectSlug)"
        @collapse-done="ticketStore.collapseDone()"
      />
      <div v-if="sortedColumns.length === 0" class="kanban-board__empty">
        No columns available.
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-board {
  flex: 1;
  overflow-x: auto;
  padding: 16px;
}

.kanban-board__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-text);
  opacity: 0.6;
}

.kanban-board__error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-danger);
  padding: 16px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border-radius: 8px;
}

.kanban-board__columns {
  display: flex;
  gap: 16px;
  min-height: 400px;
  align-items: flex-start;
}

.kanban-board__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text);
  opacity: 0.5;
  font-size: 14px;
}
</style>
