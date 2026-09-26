import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { restoreBody, useUnsubscribe, type SubscriptionRow } from './folders';

// #16: unsubscribe offers Undo, which subscribes again exactly as before.

const sub: SubscriptionRow = {
  subscriptionId: 's1',
  feedId: 'f1',
  title: 'Feed X',
  customTitle: 'My X',
  feedUrl: 'https://x.example/rss',
  siteUrl: null,
  faviconUrl: null,
  folderId: 'd1',
  position: 3,
  viewMode: 'cards',
  articleView: 'web',
  hideFromAll: true,
  inBlogroll: false,
  attention: 'precious',
  websubState: 'inactive',
  websubLeaseExpiresAt: null,
  fetchIntervalSec: null,
  lastFetchedAt: null,
  lastError: null,
  unreadCount: 4,
};

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['feeds'], { items: [sub] });
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/feeds/restore')
      ? ({ ok: true, status: 201, json: async () => ({ ...sub, subscriptionId: 's2' }) } as Response)
      : ({ ok: true, status: 204 } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  // sonner keeps toasts in a module-level store; start each test clean.
  toast.dismiss();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

test('restoreBody carries the folder, title, place, and settings', () => {
  expect(restoreBody(sub)).toEqual({
    feedId: 'f1',
    folderId: 'd1',
    title: 'My X',
    position: 3,
    viewMode: 'cards',
    articleView: 'web',
    hideFromAll: true,
    inBlogroll: false,
    attention: 'precious',
  });
});

test('unsubscribe removes the row at once, then Undo on the toast restores it', async () => {
  render(<Toaster />);
  const { result } = renderHook(() => useUnsubscribe(), { wrapper });

  act(() => result.current.mutate('s1'));
  await waitFor(() =>
    expect(qc.getQueryData<{ items: SubscriptionRow[] }>(['feeds'])!.items).toEqual([]),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/feeds\/s1$/),
    expect.objectContaining({ method: 'DELETE' }),
  );

  expect(await screen.findByText('Unsubscribed from My X.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/feeds\/restore$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(restoreBody(sub)) }),
    ),
  );
});

test('a failed unsubscribe puts the row back and offers no Undo', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => null } as Response);
  render(<Toaster />);
  const { result } = renderHook(() => useUnsubscribe(), { wrapper });

  act(() => result.current.mutate('s1'));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(qc.getQueryData<{ items: SubscriptionRow[] }>(['feeds'])!.items).toEqual([sub]);
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
});
