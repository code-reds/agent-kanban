import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import Header from '@/components/layout/Header.vue';
import Layout from '@/components/layout/Layout.vue';

describe('Layout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the Header component', () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
    });
    const wrapper = mount(Layout, {
      global: {
        plugins: [router],
        components: { Header },
      },
      slots: { default: '<div class="slot-content">Content</div>' },
    });
    expect(wrapper.find('.app-header').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders a main element with app-content class', () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
    });
    const wrapper = mount(Layout, {
      global: {
        plugins: [router],
        components: { Header },
      },
      slots: { default: '<div>Content</div>' },
    });
    const mainEl = wrapper.find('main.app-content');
    expect(mainEl.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders slot content inside main', () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
    });
    const wrapper = mount(Layout, {
      global: {
        plugins: [router],
        components: { Header },
      },
      slots: { default: '<div class="slot-content">Hello</div>' },
    });
    expect(wrapper.text()).toContain('Hello');
    wrapper.unmount();
  });

  it('renders app-layout class on root div', () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
    });
    const wrapper = mount(Layout, {
      global: {
        plugins: [router],
        components: { Header },
      },
      slots: { default: '<div>Content</div>' },
    });
    expect(wrapper.find('.app-layout').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders children passed to default slot', () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', name: 'dashboard', component: { template: '<div/>' } }],
    });
    const wrapper = mount(Layout, {
      global: {
        plugins: [router],
        components: { Header },
      },
      slots: { default: '<p>Test paragraph</p><span>Span text</span>' },
    });
    expect(wrapper.text()).toContain('Test paragraph');
    expect(wrapper.text()).toContain('Span text');
    wrapper.unmount();
  });
});
