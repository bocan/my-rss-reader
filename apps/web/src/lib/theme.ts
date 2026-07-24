import {
  DENSITIES,
  resolveTheme,
  THEME_SETTINGS,
  type Density,
  type ThemeSetting,
} from '@rss/shared';
import { useCallback, useEffect } from 'react';
import { useSettings } from './settings';

// Theme-only key for the synchronous pre-mount paint (initTheme). Holds a theme
// setting: a named theme id or 'auto'. The full settings live under 'rss-settings'.
const STORAGE_KEY = 'rss-theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function prefersMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

let animTimer: number | undefined;

/** Resolve a setting and paint it: set data-theme and toggle the dark class. */
function applyResolved(setting: ThemeSetting, animate: boolean): void {
  const { id, mode } = resolveTheme(setting, systemPrefersDark());
  const el = document.documentElement;
  if (animate && prefersMotion()) {
    // Enable the crossfade for a brief window so hover/focus stays snappy.
    el.classList.add('theme-anim');
    window.clearTimeout(animTimer);
    animTimer = window.setTimeout(() => el.classList.remove('theme-anim'), 260);
  }
  el.setAttribute('data-theme', id);
  el.classList.toggle('dark', mode === 'dark');
}

function readStored(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (THEME_SETTINGS as readonly string[]).includes(raw)) return raw as ThemeSetting;
  } catch {
    // no storage access
  }
  return 'auto';
}

/** Apply the row density to the DOM (drives the `compact:` variant). */
export function applyDensity(density: Density): void {
  document.documentElement.setAttribute('data-density', density);
}

/** Read the density out of the localStorage settings mirror for a no-flash init. */
function readStoredDensity(): Density {
  try {
    const raw = window.localStorage.getItem('rss-settings');
    const value = raw ? (JSON.parse(raw) as { density?: string }).density : undefined;
    if (value && (DENSITIES as readonly string[]).includes(value)) return value as Density;
  } catch {
    // no storage access
  }
  return 'comfortable';
}

/**
 * Paint the last-known theme and density before React mounts, so there is no
 * flash. Reads only localStorage (synchronous); server values reconcile after
 * hydration via useTheme. Call once at startup.
 */
export function initTheme(): ThemeSetting {
  const setting = readStored();
  applyResolved(setting, false);
  applyDensity(readStoredDensity());
  return setting;
}

/**
 * Server-backed theme (via useSettings), applied to the DOM and mirrored to
 * localStorage. `preview` applies a theme without persisting (for hover); pass
 * null to revert to the saved theme.
 */
export function useTheme() {
  const { settings, update } = useSettings();
  const theme = settings.theme;

  // Reconcile: apply and cache whenever the (server-backed) theme changes.
  useEffect(() => {
    applyResolved(theme, true);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Follow the OS while on 'auto'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'auto') applyResolved('auto', true);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemeSetting) => update({ theme: next }), [update]);
  const preview = useCallback(
    (next: ThemeSetting | null) => applyResolved(next ?? theme, true),
    [theme],
  );

  return { theme, setTheme, preview } as const;
}
