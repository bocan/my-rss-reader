import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useArticleSurface } from './use-article-surface';

// #19: j/k step from where the focused item was, even after it left the list.

const filters = { sort: 'newest' as const };
let qc: QueryClient;

const page = (ids: string[]) => ({
  pages: [{ items: ids.map((id) => ({ id, feedId: 'f1', read: false, starred: false })), nextCursor: null }],
  pageParams: [null],
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['articles', filters], page(['a1', 'a2', 'a3', 'a4', 'a5']));
  vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const setup = () => renderHook(() => useArticleSurface(filters), { wrapper }).result;

/** Replace the cached list and wait until the hook has re-rendered with it. */
async function setList(s: { current: { items: { id: string }[] } }, data: unknown, ids: string[]) {
  await act(async () => {
    qc.setQueryData(['articles', filters], data);
  });
  await waitFor(() => expect(s.current.items.map((a) => a.id)).toEqual(ids));
}

test('j after the focused item dropped out goes to the item that followed it', async () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  await setList(s, page(['a1', 'a2', 'a4', 'a5']), ['a1', 'a2', 'a4', 'a5']);

  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a4');
});

test('k after the focused item dropped out goes to the item before it', async () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  await setList(s, page(['a1', 'a2', 'a4', 'a5']), ['a1', 'a2', 'a4', 'a5']);

  act(() => s.current.focusPrev());
  expect(s.current.focusedId).toBe('a2');
});

test('j with nothing focused still starts at the top', () => {
  const s = setup();
  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a1');
});

// #23: step through articles from inside the reader.

test('openAdjacent opens the next and previous article from the open one', () => {
  const onOpen = vi.fn();
  const s = renderHook(() => useArticleSurface(filters, undefined, { onOpen }), { wrapper }).result;
  act(() => s.current.setFocusedId('a3'));

  act(() => s.current.openAdjacent(1));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a4' }));
  expect(s.current.focusedId).toBe('a4');

  act(() => s.current.openAdjacent(-1));
  act(() => s.current.openAdjacent(-1));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a2' }));
});

test('adjacency says where the ends are; Next stays on while pages remain', async () => {
  const s = setup();
  expect(s.current.adjacency('a1')).toEqual({ hasPrev: false, hasNext: true });
  expect(s.current.adjacency('a3')).toEqual({ hasPrev: true, hasNext: true });
  expect(s.current.adjacency('a5')).toEqual({ hasPrev: true, hasNext: false });

  await act(async () => {
    qc.setQueryData(['articles', filters], {
      pages: [{ ...page(['a1', 'a2', 'a3', 'a4', 'a5']).pages[0]!, nextCursor: 'more' }],
      pageParams: [null],
    });
  });
  await waitFor(() => expect(s.current.hasNextPage).toBe(true));
  expect(s.current.adjacency('a5')).toEqual({ hasPrev: true, hasNext: true });
});

test('stepping near the end of a page loads the next page, and j continues', async () => {
  const onOpen = vi.fn();
  const more = { items: [{ id: 'a6', feedId: 'f1', read: false, starred: false }], nextCursor: null };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => more });
  vi.stubGlobal('fetch', fetchMock);
  qc.setQueryData(['articles', filters], {
    pages: [{ ...page(['a1', 'a2', 'a3', 'a4', 'a5']).pages[0]!, nextCursor: 'c1' }],
    pageParams: [null],
  });
  const s = renderHook(() => useArticleSurface(filters, undefined, { onOpen }), { wrapper }).result;
  act(() => s.current.setFocusedId('a2'));

  act(() => s.current.openAdjacent(1)); // lands on a3: within 3 of the end
  await waitFor(() => expect(s.current.items).toHaveLength(6));
  expect(fetchMock.mock.calls[0]![0]).toContain('cursor=c1');

  act(() => s.current.openAdjacent(1));
  act(() => s.current.openAdjacent(1));
  act(() => s.current.openAdjacent(1));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a6' }));
});

test('j steps normally while the focused item is in the list', () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a4');
});
