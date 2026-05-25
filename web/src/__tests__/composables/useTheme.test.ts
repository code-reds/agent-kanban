import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Provide a real in-memory localStorage polyfill — happy-dom does not include it
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => Object.hasOwn(store, key) ? store[key] : null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    length: 0,
    keys: () => Object.keys(store),
  },
  writable: true,
});

let useTheme: () => ReturnType<typeof import('@/composables/useTheme').useTheme>;

beforeEach(async () => {
  vi.resetModules();
  // Clear the in-memory store so each test starts fresh
  for (const k in store) delete store[k];
  localStorage.clear();
  const mod = await import('@/composables/useTheme');
  useTheme = mod.useTheme;
});

afterEach(() => {
  document.documentElement.classList.remove('theme-dark');
});

describe('useTheme', () => {
  it('returns isDark as false by default in system mode with light preference', () => {
    const theme = useTheme();
    expect(theme.isDark).toBe(false);
  });

  it('returns isDark as true when mode is explicitly dark', () => {
    const theme = useTheme();
    theme.setMode('dark');
    expect(theme.isDark).toBe(true);
  });

  it('calls setMode to change mode', () => {
    const theme = useTheme();
    theme.setMode('dark');
    expect(theme.mode).toBe('dark');
  });

  it('calls toggleTheme to switch between light and dark', () => {
    const theme = useTheme();
    theme.toggleTheme();
    expect(theme.mode).toBe('dark');
    theme.toggleTheme();
    expect(theme.mode).toBe('light');
  });

  it('persists mode to localStorage', () => {
    const theme = useTheme();
    theme.setMode('dark');
    expect(localStorage.getItem('theme-mode')).toBe('dark');
  });

  it('persists light mode to localStorage', () => {
    const theme = useTheme();
    theme.setMode('light');
    expect(localStorage.getItem('theme-mode')).toBe('light');
  });

  it('persists system mode to localStorage', () => {
    const theme = useTheme();
    theme.setMode('system');
    expect(localStorage.getItem('theme-mode')).toBe('system');
  });

  it('applies theme-dark class when dark', () => {
    const theme = useTheme();
    theme.setMode('dark');
    theme.applyTheme(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
  });

  it('removes theme-dark class when light', () => {
    const theme = useTheme();
    theme.setMode('light');
    theme.applyTheme(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });
});
