<script setup lang="ts">
import { ref } from 'vue';
import type { Ticket, Column } from '../../api';
import TicketCard from './TicketCard.vue';

interface Props {
  parent: Ticket;
  children: Ticket[];
  column: Column;
}

defineProps<Props>();

const emit = defineEmits<{
  selectTicket: [ticket: Ticket];
}>();

const isExpanded = ref(true);

function toggle(): void {
  isExpanded.value = !isExpanded.value;
}

function handleSelect(ticket: Ticket): void {
  emit('selectTicket', ticket);
}
</script>

<template>
  <div class="sub-ticket-group">
    <TicketCard
      :ticket="parent"
      :column="column"
      :is-child="false"
      :is-parent-card="true"
      :is-expanded="isExpanded"
      @select="handleSelect"
      @toggle="toggle"
    />
    <div v-if="isExpanded" class="sub-ticket-group__children">
      <TicketCard
        v-for="child in children"
        :key="child.id"
        :ticket="child"
        :column="column"
        :is-child="true"
        :parent-ticket="parent"
        @select="handleSelect"
      />
    </div>
  </div>
</template>

<style scoped>
.sub-ticket-group {
  margin-bottom: 4px;
}

.sub-ticket-group__children {
  margin-left: 20px;
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
}
</style>
