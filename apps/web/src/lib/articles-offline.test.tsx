import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerMutationDefaults, useToggleArticleState } from './articles';

function seed(qc: QueryClient) {
  qc.setQueryData(['articles', {}], {
    pages: [{ items: [{ id: 'a1', feedId: 'f1', read: false, starred: false }], nextCursor: null }],
    pageParams: [null],
  });
  qc.setQueryData(['counts'], {
    feeds: [{ feedId: 'f1', unreadCount: 1 }],
    folders: [],
    total: 1,
  });
  qc.setQueryData(['feeds'], { items: [{ feedId: 'f1', folderId: null, unreadCount: 1 }] });
}

function readState(qc: QueryClient) {
  const articles = qc.getQueryData(['articles', {}]) as {
    pages: { items: { id: string; read: boolean }[] }[];
  };
  const counts = qc.getQueryData(['counts']) as { total: number };
  return { read: articles.pages[0]!.items[0]!.read, total: counts.total };
}

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  registerMutationDefaults(qc);
  seed(qc);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('offline read/star replay', () => {
  test('an offline toggle is optimistic and paused, then replays once on reconnect', async () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useToggleArticleState('a1'), { wrapper });

    act(() => result.current.mutate({ read: true }));

    // Optimistic: the cache and unread badge update (onMutate is async), no
    // network yet, and the mutation parks in the paused state.
    await waitFor(() => expect(readState(qc)).toEqual({ read: true, total: 0 }));
    expect(fetchMock).not.toHaveBeenCalled();

    const mutation = qc.getMutationCache().getAll()[0];
    expect(mutation?.state.isPaused).toBe(true);

    // Reconnect: the queued mutation replays exactly once.
    onlineManager.setOnline(true);
    await act(async () => {
      await qc.resumePausedMutations();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/articles/a1/state');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ read: true });
    expect(readState(qc).read).toBe(true);
  });

  test('an online toggle fires immediately', async () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useToggleArticleState('a1'), { wrapper });
    act(() => result.current.mutate({ starred: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
