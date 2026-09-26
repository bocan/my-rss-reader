import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
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

test('j after the focused item dropped out goes to the item that followed it', () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  act(() => {
    qc.setQueryData(['articles', filters], page(['a1', 'a2', 'a4', 'a5']));
  });

  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a4');
});

test('k after the focused item dropped out goes to the item before it', () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  act(() => {
    qc.setQueryData(['articles', filters], page(['a1', 'a2', 'a4', 'a5']));
  });

  act(() => s.current.focusPrev());
  expect(s.current.focusedId).toBe('a2');
});

test('j with nothing focused still starts at the top', () => {
  const s = setup();
  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a1');
});

test('j steps normally while the focused item is in the list', () => {
  const s = setup();
  act(() => s.current.setFocusedId('a3'));
  act(() => s.current.focusNext());
  expect(s.current.focusedId).toBe('a4');
});
