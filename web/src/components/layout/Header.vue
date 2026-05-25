<template>
  <header class="app-header">
    <div class="header-content">
      <router-link to="/" class="app-title">
        <img src="/icons/favicon.png" alt="Agent Kanban" class="app-logo" />
        <span class="app-title-text">Agent Kanban</span>
      </router-link>
      <nav class="header-nav">
          <router-link to="/" class="nav-link" :class="{ active: route.path === '/' }">
            Dashboard
          </router-link>
          <template v-if="projectSlug">
            <router-link
              :to="`/projects/${projectSlug}/board`"
              class="nav-link"
              :class="{ active: route.path.startsWith('/projects') && route.path.includes('/board') }"
            >
              Board
            </router-link>
            <router-link
              :to="`/projects/${projectSlug}/conversations`"
              class="nav-link"
              :class="{ active: route.path.includes('/conversations') }"
            >
              Conversations
              <span v-if="convStore.unreadCount > 0" class="unread-badge">{{ convStore.unreadCount }}</span>
            </router-link>
            <router-link
              :to="`/projects/${projectSlug}/settings`"
              class="nav-link"
              :class="{ active: route.path.startsWith('/projects') && route.path.includes('/settings') }"
            >
              Settings
            </router-link>
          </template>
        </nav>
    </div>
      <div class="header-actions">
        <button class="theme-toggle" :title="!theme.isDark ? 'Switch to dark mode' : 'Switch to light mode'" @click="theme.toggleTheme()">
            <svg v-if="!theme.isDark" class="theme-toggle__icon" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            <svg v-else class="theme-toggle__icon" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        <div class="settings-menu" ref="settingsMenuRef">
          <button class="settings-icon" :title="'Global Settings'" @click="showSettingsDropdown = !showSettingsDropdown" @mousedown.prevent>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <Teleport to="body">
            <div v-if="showSettingsDropdown" class="settings-dropdown" @mousedown.prevent @click.self="showSettingsDropdown = false">
              <ul class="settings-dropdown__list">
                <li class="settings-dropdown__item" @click="navigateToGlobalSettings">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                  Global Settings
                </li>
              </ul>
            </div>
          </Teleport>
        </div>
      </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectStore } from '../../stores/projects';
import { useConversationStore } from '../../stores/conversations';
import { useTheme } from '../../composables/useTheme';

const route = useRoute();
const router = useRouter();
const store = useProjectStore();
const convStore = useConversationStore();
const theme = useTheme();
const settingsMenuRef = ref<HTMLElement | null>(null);

const showSettingsDropdown = ref(false);

const projectSlug = computed(() => {
  if (store.currentProject) return store.currentProject.slug;
  const path = route.path.match(/^\/projects\/([^/]+)/);
  return path ? path[1] : null;
});

function navigateToGlobalSettings() {
  showSettingsDropdown.value = false;
  router.push('/global-settings');
}

function handleClickOutside(event: MouseEvent) {
  if (settingsMenuRef.value && !settingsMenuRef.value.contains(event.target as Node)) {
    showSettingsDropdown.value = false;
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    showSettingsDropdown.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
.app-header {
  background-color: var(--header-bg, #1a1a2e);
  color: var(--header-text, #ffffff);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  height: 60px;
}

.app-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--header-text, #ffffff);
  text-decoration: none;
  margin-right: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-logo {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.app-title-text {
  white-space: nowrap;
}

.app-title:hover {
  color: var(--header-text-hover, #e0e0ff);
}

.header-nav {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
}

.nav-link {
  padding: 8px 16px;
  border-radius: 6px;
  color: var(--header-link, #b0b0d0);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s, color 0.2s;
  position: relative;
}

.nav-link:hover {
  background-color: var(--header-link-hover, rgba(255, 255, 255, 0.1));
  color: var(--header-text, #ffffff);
}

.nav-link.active {
  background-color: var(--header-active, rgba(99, 102, 241, 0.3));
  color: var(--header-text, #ffffff);
}

.unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background-color: var(--color-danger);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 9px;
  margin-left: 6px;
  line-height: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
}

.theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle__icon {
  width: 20px;
  height: 20px;
  color: var(--header-text, #ffffff);
  transition: color 0.2s;
}

.theme-toggle:hover {
  background-color: var(--header-link-hover, rgba(255, 255, 255, 0.1));
}

.settings-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-icon svg {
  width: 20px;
  height: 20px;
  color: var(--header-text, #ffffff);
}

.settings-icon:hover {
  background-color: var(--header-link-hover, rgba(255, 255, 255, 0.1));
}

.settings-menu {
  position: relative;
}

.settings-dropdown {
  position: fixed;
  right: 24px;
  top: 56px;
  background-color: var(--header-bg, #1a1a2e);
  border: 1px solid var(--header-link-hover, rgba(255, 255, 255, 0.15));
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 180px;
  z-index: 200;
}

.settings-dropdown__list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  margin: 0;
}

.settings-dropdown__item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  color: var(--header-text, #ffffff);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.15s;
  border-radius: 0;
}

.settings-dropdown__item:hover {
  background-color: var(--header-link-hover, rgba(255, 255, 255, 0.1));
}
</style>
