import type { ViewMode } from '@rss/shared';
import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useListView, type ViewScope } from './use-list-view';

type Props = { scope: ViewScope; scopeKey: string; defaultView: ViewMode };

function setup(initial: Props) {
  const save = { feed: vi.fn(), folder: vi.fn(), default: vi.fn() };
  const hook = renderHook((p: Props) => useListView(p.scope, p.scopeKey, p.defaultView, save), {
    initialProps: initial,
  });
  return { ...hook, save };
}

const feed = (saved: ViewMode | null): ViewScope => ({ kind: 'feed', subscriptionId: 's1', saved });
const folder = (saved: ViewMode | null): ViewScope => ({ kind: 'folder', folderId: 'd1', saved });

test('each scope shows its saved layout, else the default', () => {
  expect(setup({ scope: feed('list'), scopeKey: 'f', defaultView: 'cards' }).result.current[0]).toBe('list');
  expect(setup({ scope: feed(null), scopeKey: 'f', defaultView: 'cards' }).result.current[0]).toBe('cards');
  expect(setup({ scope: folder('magazine'), scopeKey: 'd', defaultView: 'cards' }).result.current[0]).toBe(
    'magazine',
  );
  expect(setup({ scope: { kind: 'all' }, scopeKey: '', defaultView: 'list' }).result.current[0]).toBe('list');
});

test('a pick on a feed saves that feed only, never the default', () => {
  const { result, save } = setup({ scope: feed(null), scopeKey: 'f', defaultView: 'cards' });
  act(() => result.current[1]('list'));
  expect(save.feed).toHaveBeenCalledWith('s1', 'list');
  expect(save.default).not.toHaveBeenCalled();
});

test('a pick on a folder saves that folder only', () => {
  const { result, save } = setup({ scope: folder(null), scopeKey: 'd', defaultView: 'cards' });
  act(() => result.current[1]('magazine'));
  expect(save.folder).toHaveBeenCalledWith('d1', 'magazine');
  expect(save.default).not.toHaveBeenCalled();
});

test('a pick on All items changes the default', () => {
  const { result, save } = setup({ scope: { kind: 'all' }, scopeKey: '', defaultView: 'cards' });
  act(() => result.current[1]('list'));
  expect(save.default).toHaveBeenCalledWith('list');
});

test('Starred and friends: a pick lasts for this visit only and saves nothing', () => {
  const { result, rerender, save } = setup({ scope: { kind: 'other' }, scopeKey: 'starred', defaultView: 'cards' });
  act(() => result.current[1]('list'));
  expect(result.current[0]).toBe('list');
  expect(save.feed).not.toHaveBeenCalled();
  expect(save.folder).not.toHaveBeenCalled();
  expect(save.default).not.toHaveBeenCalled();

  rerender({ scope: { kind: 'other' }, scopeKey: 'shared', defaultView: 'cards' });
  expect(result.current[0]).toBe('cards');
});

// The original bug: a saved feed view changed while on the feed must show at
// once. With no local override, the view simply follows the saved value.
test('the view follows a saved layout that changes while on the feed', () => {
  const { result, rerender } = setup({ scope: feed(null), scopeKey: 'f', defaultView: 'cards' });
  rerender({ scope: feed('list'), scopeKey: 'f', defaultView: 'cards' });
  expect(result.current[0]).toBe('list');
});

test('picking the view already shown saves nothing', () => {
  const { result, save } = setup({ scope: feed(null), scopeKey: 'f', defaultView: 'cards' });
  act(() => result.current[1]('cards'));
  expect(save.feed).not.toHaveBeenCalled();
});
