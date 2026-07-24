import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { SHORTCUTS } from '@/lib/shortcuts/registry';
import { useSidebar } from './use-sidebar';

beforeEach(() => window.localStorage.clear());

test('defaults to expanded when nothing is stored', () => {
  const { result } = renderHook(() => useSidebar());
  expect(result.current.collapsed).toBe(false);
});

test('reads a stored collapsed state', () => {
  window.localStorage.setItem('reader:sidebar-collapsed', 'true');
  const { result } = renderHook(() => useSidebar());
  expect(result.current.collapsed).toBe(true);
});

test('ignores a corrupt stored value (treated as not collapsed)', () => {
  window.localStorage.setItem('reader:sidebar-collapsed', 'yes-please');
  const { result } = renderHook(() => useSidebar());
  expect(result.current.collapsed).toBe(false);
});

test('persists a toggle so it survives a reload', () => {
  const { result } = renderHook(() => useSidebar());
  act(() => result.current.toggle());
  expect(result.current.collapsed).toBe(true);
  expect(window.localStorage.getItem('reader:sidebar-collapsed')).toBe('true');
  const { result: remounted } = renderHook(() => useSidebar());
  expect(remounted.current.collapsed).toBe(true);
});

test('the sidebar toggle shortcut is registered so the overlay lists it', () => {
  expect(SHORTCUTS.find((s) => s.label === 'Toggle sidebar')?.keys).toContain('[');
});
