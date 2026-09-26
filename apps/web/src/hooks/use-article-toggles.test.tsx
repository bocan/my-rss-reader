import type { ArticleDetail } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { registerMutationDefaults } from '@/lib/articles';
import { useArticleToggles } from './use-article-toggles';

// #20: m and s flip the open article's real state, both ways.

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerMutationDefaults(qc);
  qc.setQueryData(['counts'], { feeds: [{ feedId: 'f1', unreadCount: 0 }], folders: [], total: 0 });
  qc.setQueryData(['articles', { sort: 'newest' }], {
    pages: [
      {
        items: [
          // The list row is out of date on purpose: the detail must win.
          { id: 'open', feedId: 'f1', read: false, starred: false },
          { id: 'row', feedId: 'f1', read: false, starred: true },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  // Opened (so marked read) and starred, e.g. from a deep link.
  qc.setQueryData(['article', 'open'], {
    id: 'open',
    feed: { id: 'f1' },
    read: true,
    starred: true,
    shared: false,
  } as ArticleDetail);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));
const detail = () => qc.getQueryData<ArticleDetail>(['article', 'open'])!;

test('m on an open read article marks it unread, then read again', async () => {
  const { result } = renderHook(() => useArticleToggles('open'), { wrapper });

  act(() => result.current.toggleRead());
  await waitFor(() => expect(detail().read).toBe(false));
  act(() => result.current.toggleRead());
  await waitFor(() => expect(detail().read).toBe(true));

  await waitFor(() => expect(bodies()).toHaveLength(2));
  expect(bodies()[0]).toMatchObject({ read: false });
  expect(bodies()[1]).toMatchObject({ read: true });
});

test('s toggles the open article star both ways, after a deep link', async () => {
  const { result } = renderHook(() => useArticleToggles('open'), { wrapper });

  act(() => result.current.toggleStar());
  await waitFor(() => expect(detail().starred).toBe(false));
  act(() => result.current.toggleStar());
  await waitFor(() => expect(detail().starred).toBe(true));

  await waitFor(() => expect(bodies()).toHaveLength(2));
  expect(bodies()[0]).toMatchObject({ starred: false });
  expect(bodies()[1]).toMatchObject({ starred: true });
});

test('with no article open, the focused row state is used', async () => {
  const { result } = renderHook(() => useArticleToggles('row'), { wrapper });

  act(() => result.current.toggleStar());
  await waitFor(() => expect(bodies()).toHaveLength(1));
  expect(bodies()[0]).toMatchObject({ starred: false }); // the row was starred
});

test('with no target the keys do nothing', () => {
  const { result } = renderHook(() => useArticleToggles(null), { wrapper });
  act(() => {
    result.current.toggleRead();
    result.current.toggleStar();
    result.current.toggleShared();
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

// #49: v opens the original, of the open article or the focused row.
test('v opens the original in a new tab, from the detail or the list row', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  qc.setQueryData(['article', 'open'], { ...detail(), url: 'https://ex.com/open' });
  qc.setQueryData(['articles', { sort: 'newest' }], {
    pages: [{ items: [{ id: 'row', feedId: 'f1', url: 'https://ex.com/row' }], nextCursor: null }],
    pageParams: [null],
  });

  renderHook(() => useArticleToggles('open'), { wrapper }).result.current.openOriginal();
  renderHook(() => useArticleToggles('row'), { wrapper }).result.current.openOriginal();
  expect(open.mock.calls).toEqual([
    ['https://ex.com/open', '_blank', 'noopener,noreferrer'],
    ['https://ex.com/row', '_blank', 'noopener,noreferrer'],
  ]);
  open.mockRestore();
});

test('v on an article with no link opens nothing', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  qc.setQueryData(['article', 'open'], { ...detail(), url: null });
  renderHook(() => useArticleToggles('open'), { wrapper }).result.current.openOriginal();
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});
