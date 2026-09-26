import type { ArticleDetail } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useArticles } from '@/hooks/use-articles';
import {
  registerMutationDefaults,
  useToggleAnyArticleState,
  useToggleArticleState,
} from './articles';

// #19: reading one article must not refetch the list on screen.

const filters = { sort: 'newest' as const, unread: true };
let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  registerMutationDefaults(qc);
  qc.setQueryData(['feeds'], { items: [{ feedId: 'f1', folderId: null, hideFromAll: false, attention: 'normal' }] });
  qc.setQueryData(['counts'], { feeds: [{ feedId: 'f1', unreadCount: 2 }], folders: [], total: 2 });
  qc.setQueryData(['articles', filters], {
    pages: [
      {
        items: [
          { id: 'a1', feedId: 'f1', read: false, starred: false },
          { id: 'a2', feedId: 'f1', read: false, starred: false },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  // Another scope, visited before, not on screen now.
  qc.setQueryData(['articles', { sort: 'newest', starred: true }], {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [null],
  });
  qc.setQueryData(['article', 'a1'], { id: 'a1', read: false, starred: false } as ArticleDetail);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const listIds = () =>
  (qc.getQueryData(['articles', filters]) as { pages: { items: { id: string; read: boolean }[] }[] })
    .pages[0]!.items;

test('marking the open article read keeps it in the unread-only list, shown as read', async () => {
  // The list on screen: an active observer on its query.
  renderHook(() => useArticles(filters), { wrapper });
  const { result } = renderHook(() => useToggleArticleState('a1'), { wrapper });

  act(() => result.current.mutate({ read: true }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await act(async () => {});

  expect(listIds()).toEqual([
    expect.objectContaining({ id: 'a1', read: true }),
    expect.objectContaining({ id: 'a2', read: false }),
  ]);
  // Only the PATCH went out: the list on screen was not refetched.
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/articles?'))).toBe(true);
  expect(qc.getQueryState(['articles', filters])!.isInvalidated).toBe(false);
  // The list off screen is marked stale, so it refetches when shown.
  expect(qc.getQueryState(['articles', { sort: 'newest', starred: true }])!.isInvalidated).toBe(true);
  expect(qc.getQueryState(['counts'])!.isInvalidated).toBe(true);
});

test('a failed toggle also rolls back the open article', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => null } as Response);
  const { result } = renderHook(() => useToggleArticleState('a1'), { wrapper });

  act(() => result.current.mutate({ starred: true }));
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(qc.getQueryData<ArticleDetail>(['article', 'a1'])!.starred).toBe(false);
});

test('the row toggle (#32) patches the article it names and moves the count', async () => {
  const { result } = renderHook(() => useToggleAnyArticleState(), { wrapper });

  act(() => result.current('a2', { read: true }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(String(fetchMock.mock.calls[0]![0])).toContain('/articles/a2/state');
  expect(listIds()).toEqual([
    expect.objectContaining({ id: 'a1', read: false }),
    expect.objectContaining({ id: 'a2', read: true }),
  ]);
  expect(qc.getQueryData<{ total: number }>(['counts'])!.total).toBe(1);
});
