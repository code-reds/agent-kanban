<template>
  <div id="app">
    <Layout>
      <router-view />
    </Layout>
  </div>
</template>

<script setup lang="ts">
import { useTheme } from './composables/useTheme';
import Layout from './components/layout/Layout.vue';

const theme = useTheme();
theme.applyTheme(theme.isDark);
</script>
