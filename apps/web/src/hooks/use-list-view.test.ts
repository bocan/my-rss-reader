import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useListView } from './use-list-view';

beforeEach(() => window.localStorage.clear());

test('defaults to list when nothing is stored', () => {
  const { result } = renderHook(() => useListView());
  expect(result.current[0]).toBe('list');
});

test('reads a valid stored view', () => {
  window.localStorage.setItem('reader.listView', 'magazine');
  const { result } = renderHook(() => useListView());
  expect(result.current[0]).toBe('magazine');
});

test('falls back to list for a corrupt stored value', () => {
  window.localStorage.setItem('reader.listView', 'not-a-view');
  const { result } = renderHook(() => useListView());
  expect(result.current[0]).toBe('list');
});

test('persists a change so it survives a reload', () => {
  const { result } = renderHook(() => useListView());
  act(() => result.current[1]('cards'));
  expect(result.current[0]).toBe('cards');
  expect(window.localStorage.getItem('reader.listView')).toBe('cards');
  // A fresh mount (as after reload) picks it up.
  const { result: remounted } = renderHook(() => useListView());
  expect(remounted.current[0]).toBe('cards');
});
