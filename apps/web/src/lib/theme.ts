import { useEffect } from 'react';
import { useSettings } from './settings';

export type Theme = 'light' | 'dark' | 'system';

// Theme-only key kept for the synchronous pre-mount paint (initTheme). The full
// settings object lives under 'rss-settings' (see lib/settings.ts).
const STORAGE_KEY = 'rss-theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Paint the last-known theme before React mounts, so there is no flash. Reads
 * only localStorage (synchronous); the server value reconciles after hydration
 * via useTheme. Call once at startup.
 */
export function initTheme(): Theme {
  let stored: Theme = 'system';
  try {
    stored = (window.localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';
  } catch {
    // no storage access; fall back to the initialized 'system'
  }
  apply(stored);
  return stored;
}

/** Server-backed theme (via useSettings), applied to the DOM and mirrored to
 * localStorage so the next cold load paints correctly. */
export function useTheme() {
  const { settings, update } = useSettings();
  const theme = settings.theme;

  // Reconcile: whenever the (server-backed) theme changes, apply it and update
  // the synchronous cache used by initTheme.
  useEffect(() => {
    apply(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Follow the OS when on 'system'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') apply('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next: Theme) => update({ theme: next });
  return { theme, setTheme } as const;
}
