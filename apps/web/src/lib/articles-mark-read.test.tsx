import type { UnreadCounts } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { registerMutationDefaults, useMarkRead } from './articles';

// Feeds: `shown` and `hidden` (hidden from All) in folder d1, `hose` a
// firehose feed in d1. Counts follow the server rollup: total leaves out
// hidden and firehose feeds; folders leave out firehose feeds.
const feeds = [
  { feedId: 'shown', folderId: 'd1', unreadCount: 3, hideFromAll: false, attention: 'normal' },
  { feedId: 'hidden', folderId: 'd1', unreadCount: 2, hideFromAll: true, attention: 'normal' },
  { feedId: 'hose', folderId: 'd1', unreadCount: 5, hideFromAll: false, attention: 'firehose' },
];

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  registerMutationDefaults(qc);
  qc.setQueryData(['feeds'], { items: feeds });
  qc.setQueryData<UnreadCounts>(['counts'], {
    feeds: feeds.map(({ feedId, unreadCount }) => ({ feedId, unreadCount })),
    folders: [{ folderId: 'd1', unreadCount: 5 }], // shown 3 + hidden 2
    total: 3, // shown only
  });
  qc.setQueryData(['articles', {}], {
    pages: [
      {
        items: [
          { id: 'a1', feedId: 'shown', read: false, starred: false },
          { id: 'a2', feedId: 'hidden', read: false, starred: false },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const counts = () => qc.getQueryData<UnreadCounts>(['counts'])!;
const unread = (id: string) => counts().feeds.find((f) => f.feedId === id)!.unreadCount;
const itemRead = (id: string) =>
  (
    qc.getQueryData(['articles', {}]) as { pages: { items: { id: string; read: boolean }[] }[] }
  ).pages[0]!.items.find((a) => a.id === id)!.read;

test('All items (#14): hidden feeds keep their unread, counts match the server rollup', async () => {
  const { result } = renderHook(() => useMarkRead(), { wrapper });
  act(() => result.current.mutate({ fetchedBefore: '2026-01-01T00:00:00.000Z' }));

  await waitFor(() => expect(unread('shown')).toBe(0));
  expect(unread('hidden')).toBe(2);
  expect(unread('hose')).toBe(0); // firehose items do show in All items
  expect(counts().total).toBe(0);
  expect(counts().folders[0]!.unreadCount).toBe(2); // only hidden's 2 remain
  expect(itemRead('a1')).toBe(true);
  expect(itemRead('a2')).toBe(false);

  // The cutoff is sent to the server.
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body).toEqual({ fetchedBefore: '2026-01-01T00:00:00.000Z' });
});

test('a scroll batch (#17) marks only its ids and leaves the list in place', async () => {
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useMarkRead(), { wrapper });
  act(() => result.current.mutate({ articleIds: ['a2'] }));

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(itemRead('a2')).toBe(true);
  expect(itemRead('a1')).toBe(false);
  expect(unread('hidden')).toBe(1);
  expect(counts().folders[0]!.unreadCount).toBe(4);
  expect(counts().total).toBe(3); // hidden feeds never count toward the total
  // Counts are refreshed; the article list is not refetched.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['counts'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['articles'] });
});

test('a folder scope still includes its hidden feeds', async () => {
  const { result } = renderHook(() => useMarkRead(), { wrapper });
  act(() => result.current.mutate({ folderId: 'd1' }));

  await waitFor(() => expect(unread('hidden')).toBe(0));
  expect(counts().folders[0]!.unreadCount).toBe(0);
  expect(counts().total).toBe(0);
});
