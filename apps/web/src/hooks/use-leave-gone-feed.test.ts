import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useLeaveGoneFeed } from './use-leave-gone-feed';

type Props = { feedId: string | undefined; ids: Set<string> | undefined };
const setup = (initial: Props) => {
  const leave = vi.fn();
  const hook = renderHook(({ feedId, ids }: Props) => useLeaveGoneFeed(feedId, ids, leave), {
    initialProps: initial,
  });
  return { leave, ...hook };
};

test('leaves once when the feed in view is unsubscribed (#16)', () => {
  const { leave, rerender } = setup({ feedId: 'f1', ids: new Set(['f1', 'f2']) });
  expect(leave).not.toHaveBeenCalled();

  rerender({ feedId: 'f1', ids: new Set(['f2']) });
  expect(leave).toHaveBeenCalledOnce();

  // A later refetch with the same result does not fire again.
  rerender({ feedId: 'f1', ids: new Set(['f2']) });
  expect(leave).toHaveBeenCalledOnce();
});

test('does not bounce while the feed list is still loading', () => {
  const { leave } = setup({ feedId: 'f1', ids: undefined });
  expect(leave).not.toHaveBeenCalled();
});

test('scopes with no feed never leave', () => {
  const { leave } = setup({ feedId: undefined, ids: new Set() });
  expect(leave).not.toHaveBeenCalled();
});
