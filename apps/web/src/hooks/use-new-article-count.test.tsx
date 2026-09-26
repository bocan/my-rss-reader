import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LIVE_REFRESH_MS } from '@/lib/live-refresh';
import { useNewArticleCount, type ArticleFilters } from './use-articles';

// #30: the "N new articles" check.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 4 }) }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function run(filters: ArticleFilters, since: string | null) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useNewArticleCount(filters, since), { wrapper });
}

const since = '2026-09-26T12:00:00.000Z';

test('the list just loaded, so it first asks after one interval, in the same scope', async () => {
  const { result } = run({ feedId: 'f1', unread: true, sort: 'oldest' }, since);
  expect(result.current).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();

  await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
  await vi.waitFor(() => expect(result.current).toBe(4));
  const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://x');
  expect(url.pathname).toBe('/api/articles/new-count');
  expect(Object.fromEntries(url.searchParams)).toEqual({ feedId: 'f1', unread: 'true', since });
});

test('a hidden tab and an offline app do not ask', async () => {
  focusManager.setFocused(false);
  run({ sort: 'newest' }, since);
  await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 2));
  expect(fetchMock).not.toHaveBeenCalled();
  focusManager.setFocused(undefined);

  onlineManager.setOnline(false);
  run({ sort: 'newest' }, since);
  await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 2));
  expect(fetchMock).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
});

test('search results never ask', async () => {
  run({ q: 'css', sort: 'newest' }, since);
  await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 2));
  expect(fetchMock).not.toHaveBeenCalled();
});
