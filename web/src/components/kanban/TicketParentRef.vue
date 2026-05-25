<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Ticket, Column } from '../../api';
import TicketCard from './TicketCard.vue';

interface Props {
  parent: Ticket;
  children: Ticket[];
  singleChildMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  singleChildMode: false,
});

const emit = defineEmits<{
  selectTicket: [ticket: Ticket];
}>();

const isExpanded = ref(true);

function toggle(): void {
  isExpanded.value = !isExpanded.value;
}

const parentColumn = computed<Column>(() => ({
  id: props.parent.column_id,
  name: props.parent.column?.name || 'Unknown',
  slug: props.parent.column?.slug || 'unknown',
  order: 0,
  is_default: 0,
  project_id: props.parent.project_id,
}));

function handleSelect(ticket: Ticket): void {
  emit('selectTicket', ticket);
}
</script>

<template>
  <div class="parent-ref-group" :class="{ 'parent-ref-group--single': singleChildMode }">
    <div class="parent-ref-group__header" @click="toggle">
      <span class="parent-ref-group__toggle" :class="{ 'parent-ref-group__toggle--expanded': isExpanded }">
        {{ isExpanded ? '▼' : '▶' }}
      </span>
      <span class="parent-ref-group__parent-id">#{{ parent.id }}</span>
      <span class="parent-ref-group__parent-title">{{ parent.title }}</span>
    </div>
    <div v-if="isExpanded" class="parent-ref-group__children">
      <TicketCard
        v-for="child in children"
        :key="child.id"
        :ticket="child"
        :column="parentColumn"
        :is-child="true"
        :parent-ticket="parent"
        @select="handleSelect"
      />
    </div>
  </div>
</template>

<style scoped>
.parent-ref-group {
  margin-bottom: 4px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.parent-ref-group__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: color-mix(in srgb, var(--color-bg) 30%, var(--color-surface));
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.parent-ref-group__header:hover {
  background: color-mix(in srgb, var(--color-bg) 20%, var(--color-surface));
}

.parent-ref-group__toggle {
  font-size: 10px;
  color: var(--color-text-secondary);
  transition: transform 0.15s ease;
  flex-shrink: 0;
  width: 12px;
}

.parent-ref-group__toggle--expanded {
  transform: rotate(0deg);
}

.parent-ref-group__parent-id {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
  flex-shrink: 0;
}

.parent-ref-group__parent-title {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.parent-ref-group__children {
  padding: 4px;
}

.parent-ref-group--single {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.parent-ref-group--single .parent-ref-group__header {
  padding: 4px 10px;
}

.parent-ref-group--single .parent-ref-group__children {
  padding: 0;
}
</style>
