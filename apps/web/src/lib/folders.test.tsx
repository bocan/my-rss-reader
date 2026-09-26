import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import {
  useFetchAllFeeds,
  useRefreshFeed,
  useUpdateFolder,
  useUpdateSubscription,
  type FolderRow,
  type SubscriptionRow,
} from './folders';

// #27: in manual order a drop must show at once, so the optimistic update
// renumbers the whole scope, as the server does.

let qc: QueryClient;
const never = new Promise<Response>(() => {});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  // Hold every request, so only the optimistic state is visible.
  vi.stubGlobal('fetch', vi.fn(() => never));
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const sub = (id: string, position: number, folderId: string | null = null) =>
  ({ subscriptionId: id, feedId: `f-${id}`, folderId, position, title: id }) as SubscriptionRow;
const order = () =>
  [...qc.getQueryData<{ items: SubscriptionRow[] }>(['feeds'])!.items]
    .sort((a, b) => a.position - b.position)
    .map((s) => s.subscriptionId);

test('a feed moved to index 0 takes the top, and its siblings shift down', async () => {
  qc.setQueryData(['feeds'], { items: [sub('a', 0), sub('b', 1), sub('c', 2)] });
  const { result } = renderHook(() => useUpdateSubscription(), { wrapper });

  act(() => result.current.mutate({ id: 'c', position: 0 }));
  await vi.waitFor(() => expect(order()).toEqual(['c', 'a', 'b']));
});

test('a rename does not move the feed', async () => {
  qc.setQueryData(['feeds'], { items: [sub('a', 0), sub('b', 1), sub('c', 2)] });
  const { result } = renderHook(() => useUpdateSubscription(), { wrapper });

  act(() => result.current.mutate({ id: 'a', title: 'Renamed' }));
  await vi.waitFor(() =>
    expect(qc.getQueryData<{ items: SubscriptionRow[] }>(['feeds'])!.items[0]!.customTitle).toBe('Renamed'),
  );
  expect(order()).toEqual(['a', 'b', 'c']);
});

// #29: "Retry now" replaces the row and says how it went.
test('a retry puts the new state in the list, and a toast says it still fails', async () => {
  const still = { ...sub('a', 0), lastError: 'HTTP 404' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => still }) as Response),
  );
  qc.setQueryData(['feeds'], { items: [{ ...sub('a', 0), lastError: 'read ECONNRESET' }, sub('b', 1)] });
  render(<Toaster />);
  const { result } = renderHook(() => useRefreshFeed(), { wrapper });

  act(() => result.current.mutate('a'));
  expect(await screen.findByText('a still fails: The feed is not at this address any more.')).toBeInTheDocument();
  expect(qc.getQueryData<{ items: SubscriptionRow[] }>(['feeds'])!.items[0]!.lastError).toBe('HTTP 404');
  toast.dismiss();
});

// #42: the r key and the refresh button share this, so both say the result.
test('fetch all feeds says how many it fetched, and a second press while it runs does nothing', async () => {
  let finish: (r: Response) => void = () => {};
  const fetchMock = vi.fn(
    (_url: string) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<Toaster />);
  const { result } = renderHook(() => useFetchAllFeeds(), { wrapper });

  act(() => result.current.fetchAll());
  await vi.waitFor(() => expect(result.current.isPending).toBe(true));
  act(() => result.current.fetchAll());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toContain('/feeds/refresh');

  await act(async () =>
    finish({ ok: true, status: 200, json: async () => ({ refreshed: 3 }) } as Response),
  );
  expect(await screen.findByText('Fetched 3 feeds.')).toBeInTheDocument();
  toast.dismiss();
});

test('a folder moved to index 0 takes the top of its parent scope', async () => {
  const folder = (id: string, position: number) =>
    ({ id, name: id, parentId: null, position, createdAt: '' }) as FolderRow;
  qc.setQueryData(['folders'], { items: [folder('x', 0), folder('y', 1)] });
  const { result } = renderHook(() => useUpdateFolder(), { wrapper });

  act(() => result.current.mutate({ id: 'y', position: 0 }));
  await vi.waitFor(() =>
    expect(
      qc.getQueryData<{ items: FolderRow[] }>(['folders'])!.items.map((f) => [f.id, f.position]),
    ).toEqual([['x', 1], ['y', 0]]),
  );
});
