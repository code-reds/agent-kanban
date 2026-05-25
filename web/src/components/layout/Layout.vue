<template>
  <div class="app-layout">
    <Header />
    <main class="app-content">
      <slot />
    </main>
    <Footer />
  </div>
</template>

<script setup lang="ts">
import Header from './Header.vue';
import Footer from './Footer.vue';
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-content {
  flex: 1;
  padding: 24px;
}
</style>
