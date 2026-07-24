import { DEFAULT_SETTINGS, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useTheme } from './theme';

const CACHE_KEY = 'rss-settings';

function mockMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark')
      ? dark
      : query.includes('reduced-motion')
        ? true // no-preference: motion allowed
        : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

/** Seed the settings cache so useSettings resolves synchronously to `theme`. */
function seed(theme: Settings['theme']) {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, theme }));
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves
  mockMatchMedia(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('applies data-theme and the dark class for a named dark theme', () => {
  seed('ember');
  renderHook(() => useTheme(), { wrapper });
  expect(document.documentElement.getAttribute('data-theme')).toBe('ember');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('applies a named light theme without the dark class', () => {
  seed('paper');
  renderHook(() => useTheme(), { wrapper });
  expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

test('auto follows the OS: dark preference resolves to midnight', () => {
  mockMatchMedia(true);
  seed('auto');
  renderHook(() => useTheme(), { wrapper });
  expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('preview changes the DOM without persisting, and null reverts', () => {
  seed('daylight');
  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(document.documentElement.getAttribute('data-theme')).toBe('daylight');

  act(() => result.current.preview('void'));
  expect(document.documentElement.getAttribute('data-theme')).toBe('void');
  // The persisted settings cache is untouched by a preview.
  expect(JSON.parse(window.localStorage.getItem(CACHE_KEY)!).theme).toBe('daylight');

  act(() => result.current.preview(null));
  expect(document.documentElement.getAttribute('data-theme')).toBe('daylight');
});
