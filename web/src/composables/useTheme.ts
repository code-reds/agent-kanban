import { ref, computed, watch, reactive, type Ref, type ComputedRef } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-mode';

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored as ThemeMode;
  }
  return 'system';
}

// Module-level singleton for shared theme state
const _mode: Ref<ThemeMode> = ref(getStoredMode());
const _isDark: ComputedRef<boolean> = computed(() => {
  const m = _mode.value;
  return m === 'dark' || (m === 'system' && getSystemPreference() === 'dark');
});

function applyTheme(isDark: boolean): void {
  if (typeof document === 'undefined') return;
  if (isDark) {
    document.documentElement.classList.add('theme-dark');
  } else {
    document.documentElement.classList.remove('theme-dark');
  }
}

export function useTheme() {
  // Read from localStorage on each call to pick up changes made before mounting
  const stored = getStoredMode();
  if (stored !== _mode.value) {
    _mode.value = stored;
  }

  watch(_mode, (newMode) => {
    applyTheme(newMode === 'dark' || (newMode === 'system' && getSystemPreference() === 'dark'));
  }, { immediate: true });

  function toggleTheme(): void {
    if (_mode.value === 'system') {
      _mode.value = _isDark.value ? 'light' : 'dark';
    } else if (_mode.value === 'dark') {
      _mode.value = 'light';
    } else {
      _mode.value = 'dark';
    }
    localStorage.setItem(STORAGE_KEY, _mode.value);
  }

  function setMode(newMode: ThemeMode): void {
    _mode.value = newMode;
    localStorage.setItem(STORAGE_KEY, newMode);
  }

  return reactive({ mode: _mode, isDark: _isDark, toggleTheme, setMode, applyTheme });
}

// Reset module state for testing — not exported for production use
export function resetThemeModule(): void {
  _mode.value = 'system';
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
