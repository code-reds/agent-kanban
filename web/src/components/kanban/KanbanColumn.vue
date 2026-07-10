<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Column, Ticket } from '../../api';
import TicketCard from './TicketCard.vue';
import TicketSubTicketsGroup from './TicketSubTicketsGroup.vue';
import TicketParentRef from './TicketParentRef.vue';

interface ParentTicketGroup {
  parent: Ticket;
  children: Ticket[];
}

const props = withDefaults(defineProps<{
  column: Column;
  tickets: Ticket[];
  parentTicketGroups?: ParentTicketGroup[];
  crossColumnChildrenIds?: Set<number>;
  crossColumnParentMap?: Record<number, Ticket>;
  hasMoreDone?: boolean;
  showAllDone?: boolean;
  doneCountLoaded?: number;
  doneTotalCount?: number;
}>(), {
  parentTicketGroups: () => [],
  crossColumnChildrenIds: () => new Set<number>(),
  crossColumnParentMap: () => ({}),
  hasMoreDone: false,
  showAllDone: false,
  doneCountLoaded: 0,
  doneTotalCount: 0,
});

const emit = defineEmits<{
  selectTicket: [ticket: Ticket];
  addTicket: [columnSlug: string];
  loadMoreDone: [];
  collapseDone: [];
}>();

const isDragOver = ref(false);

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = true;
}

function handleDragLeave(): void {
  isDragOver.value = false;
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = false;
}

function handleSelectTicket(ticket: Ticket): void {
  emit('selectTicket', ticket);
}

function handleAddTicket(): void {
  emit('addTicket', props.column.slug);
}

const childTicketIds = computed<Set<number>>(() => {
  const ids = new Set<number>();
  for (const ticket of props.tickets) {
    if (ticket.parent_id != null) {
      const parent = props.tickets.find((t) => t.id === ticket.parent_id);
      if (parent && parent.column_id === props.column.id) {
        ids.add(ticket.id);
      }
    }
  }
  return ids;
});

const ticketCount = computed(() => {
  // Count tickets that belong to this column.
  //
  // Subtract cross-column children that are in this column's tickets
  // but whose column_id does not match this column (i.e., they're in the
  // wrong column - like when a cross-column child is in the parent's
  // column's tickets). Children whose column_id matches this column
  // ARE counted correctly.
  // Do NOT add orphan children to the parent's column - children count
  // in their own actual column, not their parent's column.
  const crossColChildrenInWrongColumn = new Set<number>(
    props.tickets.filter((t) =>
      (props.crossColumnChildrenIds || new Set()).has(t.id) && t.column_id !== props.column.id,
    ).map((t) => t.id),
  );

  return props.tickets.length - crossColChildrenInWrongColumn.size;
});

const crossColumnParentGroups = computed<Record<number, Ticket[]>>(() => {
  const grouped: Record<number, Ticket[]> = {};
  const crossColChildren = props.tickets.filter((t) =>
    (props.crossColumnChildrenIds || new Set()).has(t.id),
  );
  for (const child of crossColChildren) {
    const parent = props.crossColumnParentMap?.[child.id];
    if (!parent) continue;
    if (!grouped[parent.id]) {
      grouped[parent.id] = [];
    }
    grouped[parent.id].push(child);
  }
  // Sort children within each group by priority
  for (const children of Object.values(grouped)) {
    children.sort((a, b) => a.priority - b.priority);
  }
  return grouped;
});

function buildTicketList(): { type: 'ticket' | 'parent-group' | 'cross-col-parent-ref'; ticketId: number }[] {
  const list: { type: 'ticket' | 'parent-group' | 'cross-col-parent-ref'; ticketId: number }[] = [];
  const parentGroups = props.parentTicketGroups || [];
  const parentGroupIds = new Set(parentGroups.map((g) => g.parent.id));
  const crossColGroups = crossColumnParentGroups.value;
  const crossColParentIds = new Set(Object.keys(crossColGroups).map(Number));

  for (const ticket of props.tickets) {
    // Skip same-column children (grouped under the parent TicketSubTicketsGroup)
    // Also skip cross-column children (rendered inside cross-col-parent-ref)
    if (childTicketIds.value.has(ticket.id)) continue;
    if ((props.crossColumnChildrenIds || new Set()).has(ticket.id)) continue;
    if (parentGroupIds.has(ticket.id)) {
      // Parent renders normally in its own column (as parent-group)
      const idx = list.findIndex((item) => item.type === 'ticket' && item.ticketId === ticket.id);
      if (idx === -1) {
        list.push({ type: 'parent-group', ticketId: ticket.id });
      }
    } else {
      list.push({ type: 'ticket', ticketId: ticket.id });
    }
  }

  // Add cross-col-parent-ref entries for parents that have cross-column children in this column.
  // These parents are NOT in the current column's tickets (they're in a different column),
  // so we add the reference group separately to show parent info alongside cross-column children.
  for (const parentId of crossColParentIds) {
    if (!list.find((item) => item.type === 'cross-col-parent-ref' && item.ticketId === parentId)) {
      list.push({ type: 'cross-col-parent-ref', ticketId: parentId });
    }
  }

  return list;
}
</script>

<template>
  <div
    class="kanban-column"
    :class="{ 'kanban-column--drag-over': isDragOver }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="kanban-column__header">
      <h3 class="kanban-column__name">{{ column.name }}</h3>
      <span class="kanban-column__count">{{ ticketCount }}</span>
    </div>
    <div class="kanban-column__cards">
      <template v-for="item in buildTicketList()" :key="item.ticketId">
        <TicketSubTicketsGroup
          v-if="item.type === 'parent-group'"
          :parent="parentTicketGroups.find((g) => g.parent.id === item.ticketId)!.parent"
          :children="parentTicketGroups.find((g) => g.parent.id === item.ticketId)!.children.filter((c) => c.column_id === column.id)"
          :column="column"
          @select-ticket="handleSelectTicket"
        />
        <TicketParentRef
          v-else-if="item.type === 'cross-col-parent-ref' && crossColumnParentGroups[item.ticketId]?.length"
          :parent="crossColumnParentMap?.[crossColumnParentGroups[item.ticketId][0].id]!"
          :children="crossColumnParentGroups[item.ticketId]"
          :single-child-mode="false"
          @select-ticket="handleSelectTicket"
        />
        <TicketCard
          v-else
          :ticket="tickets.find((t) => t.id === item.ticketId)!"
          :column="column"
          @select="handleSelectTicket"
        />
      </template>
      <div v-if="column.slug === 'done' && showAllDone && doneTotalCount > 8" class="kanban-column__load-more">
        <button class="kanban-column__load-more-btn" @click="emit('collapseDone')">
          Hide older tickets
        </button>
      </div>
      <div v-else-if="column.slug === 'done' && doneTotalCount > 8 && !showAllDone" class="kanban-column__load-more">
        <button class="kanban-column__load-more-btn" @click="emit('loadMoreDone')">
          Show all tickets ({{ Math.max(0, doneTotalCount - doneCountLoaded) }} more)
        </button>
      </div>
      <div class="kanban-column__add-area">
        <button class="kanban-column__add-btn" @click="handleAddTicket">
          + Add ticket
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-column {
  display: flex;
  flex-direction: column;
  min-width: 280px;
  max-width: 320px;
  width: 300px;
  flex-shrink: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
}

.kanban-column--drag-over {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-bg));
}

.kanban-column__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.kanban-column__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.kanban-column__count {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  background: var(--color-border);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 600;
}

.kanban-column__cards {
  flex: 1;
  overflow-y: auto;
  min-height: 40px;
}

.kanban-column__add-area {
  margin-top: 8px;
}

.kanban-column__add-btn {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  opacity: 0.7;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}

.kanban-column__add-btn:hover {
  opacity: 1;
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.kanban-column__load-more {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.kanban-column__load-more-btn {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  background: var(--color-primary-bg, rgba(0, 123, 255, 0.1));
  color: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s ease;
}

.kanban-column__load-more-btn:hover {
  background: var(--color-primary-bg-hover, rgba(0, 123, 255, 0.2));
}
</style>
