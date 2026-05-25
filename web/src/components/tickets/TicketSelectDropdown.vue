<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import type { Ticket } from '../../api';

interface Props {
  tickets: Ticket[];
  selectedId?: number | null;
  placeholder?: string;
  allowNone?: boolean;
  excludeIds?: number[];
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: null,
  placeholder: 'Search tickets...',
  allowNone: false,
  excludeIds: () => [],
});

const emit = defineEmits<{
  select: [id: number | null];
}>();

const modelValue = computed({
  get: () => props.selectedId,
  set: (val: number | null) => {
    emit('select', val);
  },
});

const isOpen = ref(false);
const searchQuery = ref('');
const dropdownRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

const filteredTickets = computed(() => {
  let filtered = props.tickets;
  
  if (props.excludeIds && props.excludeIds.length > 0) {
    filtered = filtered.filter((t) => !props.excludeIds!.includes(t.id));
  }
  
  if (!searchQuery.value.trim()) {
    return filtered.slice().sort((a, b) => {
      const aClosed = a.column?.slug === 'done' ? 1 : 0;
      const bClosed = b.column?.slug === 'done' ? 1 : 0;
      return aClosed - bClosed;
    });
  }
  
  const query = searchQuery.value.toLowerCase();
  return filtered.filter((t) => {
    return (
      `#${t.id}`.includes(query) ||
      t.title.toLowerCase().includes(query) ||
      (t.column?.name || '').toLowerCase().includes(query)
    );
  });
});

const selectedTicket = computed(() => {
  if (!modelValue.value) return null;
  return props.tickets.find((t) => t.id === modelValue.value) || null;
});

function toggleDropdown(): void {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    nextTick(() => {
      inputRef.value?.focus();
      searchQuery.value = '';
    });
  }
}

function selectTicket(ticket: Ticket | null): void {
  modelValue.value = ticket ? ticket.id : null;
  isOpen.value = false;
  searchQuery.value = '';
}

function clearSelection(): void {
  modelValue.value = null;
}

function handleClickOutside(event: MouseEvent): void {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

function formatTicketLabel(ticket: Ticket): string {
  const columnInfo = ticket.column?.name ? ` (${ticket.column.name})` : '';
  return `#${ticket.id} - ${ticket.title}${columnInfo}`;
}

function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

document.addEventListener('click', handleClickOutside);
</script>

<template>
  <div class="ticket-select-dropdown" ref="dropdownRef">
    <div class="ticket-select-dropdown__trigger" @click="toggleDropdown">
      <div v-if="selectedTicket" class="ticket-select-dropdown__selected">
        <span class="ticket-select-dropdown__selected-id">#{{ selectedTicket.id }}</span>
        <span class="ticket-select-dropdown__selected-title">{{ selectedTicket.title }}</span>
        <span v-if="selectedTicket.column" class="ticket-select-dropdown__selected-column">
          ({{ selectedTicket.column.name }})
        </span>
        <button class="ticket-select-dropdown__clear" @click.stop="clearSelection" type="button">&times;</button>
      </div>
      <div v-else class="ticket-select-dropdown__placeholder">
        {{ allowNone ? 'Select a ticket...' : placeholder }}
      </div>
      <span class="ticket-select-dropdown__arrow" :class="{ 'ticket-select-dropdown__arrow--open': isOpen }">▼</span>
    </div>
    
    <div v-if="isOpen" class="ticket-select-dropdown__menu">
      <div class="ticket-select-dropdown__search">
        <input
          ref="inputRef"
          v-model="searchQuery"
          type="text"
          class="ticket-select-dropdown__input"
          :placeholder="allowNone ? 'Search tickets...' : placeholder"
        />
      </div>
      
      <div v-if="allowNone" class="ticket-select-dropdown__option" @click="selectTicket(null)">
        <span class="ticket-select-dropdown__option-text">None (Top-Level)</span>
      </div>
      
      <div v-if="filteredTickets.length === 0" class="ticket-select-dropdown__empty">
        No tickets found
      </div>
      
      <div
        v-for="ticket in filteredTickets"
        :key="ticket.id"
        class="ticket-select-dropdown__option"
        :class="{ 'ticket-select-dropdown__option--selected': modelValue === ticket.id }"
        @click="selectTicket(ticket)"
      >
        <span class="ticket-select-dropdown__option-id">#{{ ticket.id }}</span>
        <span
          class="ticket-select-dropdown__option-title"
          v-html="highlightMatch(ticket.title, searchQuery)"
        ></span>
        <span v-if="ticket.column" class="ticket-select-dropdown__option-column">
          {{ ticket.column.name }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ticket-select-dropdown {
  position: relative;
  width: 100%;
}

.ticket-select-dropdown__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color 0.15s ease;
  min-height: 38px;
}

.ticket-select-dropdown__trigger:hover {
  border-color: var(--color-primary);
}

.ticket-select-dropdown__selected {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.ticket-select-dropdown__selected-id {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  flex-shrink: 0;
}

.ticket-select-dropdown__selected-title {
  font-size: 13px;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ticket-select-dropdown__selected-column {
  font-size: 11px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ticket-select-dropdown__clear {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
}

.ticket-select-dropdown__clear:hover {
  color: var(--color-danger);
}

.ticket-select-dropdown__placeholder {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.ticket-select-dropdown__arrow {
  font-size: 10px;
  color: var(--color-text-secondary);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.ticket-select-dropdown__arrow--open {
  transform: rotate(180deg);
}

.ticket-select-dropdown__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ticket-select-dropdown__search {
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.ticket-select-dropdown__input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-bg);
  box-sizing: border-box;
}

.ticket-select-dropdown__input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.ticket-select-dropdown__option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s ease;
  font-size: 13px;
}

.ticket-select-dropdown__option:hover {
  background: var(--color-bg);
}

.ticket-select-dropdown__option--selected {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  font-weight: 500;
}

.ticket-select-dropdown__option-id {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
  flex-shrink: 0;
  min-width: 30px;
}

.ticket-select-dropdown__option-title {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ticket-select-dropdown__option-column {
  font-size: 11px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ticket-select-dropdown__empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-style: italic;
}

.ticket-select-dropdown__option mark {
  background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
