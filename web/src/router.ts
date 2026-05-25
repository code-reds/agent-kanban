import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('./views/Dashboard.vue'),
    },
    {
      path: '/global-settings',
      name: 'global-settings',
      component: () => import('./views/GlobalSettings.vue'),
    },
    {
      path: '/projects/:slug',
      name: 'project',
      redirect: '/projects/:slug/board',
      children: [
        {
          path: 'board',
          name: 'board',
          component: () => import('./views/ProjectBoard.vue'),
        },
        {
          path: 'conversations',
          name: 'conversations',
          component: () => import('./views/Conversations.vue'),
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('./views/Settings.vue'),
        },
      ],
    },
  ],
});

export default router;
