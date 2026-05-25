<template>
  <footer class="app-footer">
    <span class="app-footer__text">&copy;2026 Agent-Kanban Developers</span>
  </footer>
</template>

<script setup lang="ts">
</script>

<style scoped>
.app-footer {
  padding: 16px 24px;
  text-align: center;
  color: var(--color-text-secondary, #6b7280);
  font-size: 13px;
  border-top: 1px solid var(--color-border, #e5e7eb);
  background-color: var(--color-bg, #f8f9fa);
}

.app-footer__text {
  user-select: none;
}
</style>
