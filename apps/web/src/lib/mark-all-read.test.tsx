import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { registerMutationDefaults } from './articles';
import { olderThan, useMarkAllRead } from './mark-all-read';

// #26: Mark all read offers Undo, which restores exactly what it marked.

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
let marked: string[];

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerMutationDefaults(qc);
  qc.setQueryData(['feeds'], { items: [] });
  qc.setQueryData(['counts'], { feeds: [], folders: [], total: 0 });
  marked = ['a1', 'a2'];
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/mark-read')
      ? ({ ok: true, status: 200, json: async () => ({ markedIds: marked }) } as Response)
      : ({ ok: true, status: 204 } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const call = (path: string) =>
  fetchMock.mock.calls.find(([url]) => String(url).endsWith(path));

test('the toast counts what the server marked, and Undo sends exactly those ids', async () => {
  render(<Toaster />);
  const { result } = renderHook(() => useMarkAllRead(), { wrapper });

  act(() => result.current({ feedId: 'f1' }, 'Dave Rupert'));
  expect(await screen.findByText('Marked 2 articles as read in Dave Rupert.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(call('/mark-unread')).toBeDefined());
  expect(JSON.parse(call('/mark-unread')![1].body)).toEqual({ articleIds: ['a1', 'a2'] });
});

test('when nothing changed, it says so and offers no Undo', async () => {
  marked = [];
  render(<Toaster />);
  const { result } = renderHook(() => useMarkAllRead(), { wrapper });

  act(() => result.current({}, 'All items'));
  expect(await screen.findByText('Nothing to mark as read in All items.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
});

test('"older than" sends a before cutoff that far back', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');
  expect(olderThan(24 * 60 * 60 * 1000, now)).toBe('2026-09-25T12:00:00.000Z');
});
