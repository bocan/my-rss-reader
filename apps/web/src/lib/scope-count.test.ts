import { expect, test } from 'vitest';
import { unreadForScope, type ScopeCounts } from './scope-count';

// #39: each scope shows its own count, or none. Never the All items total by
// mistake.

const counts: ScopeCounts = {
  byFeed: new Map([['f1', 7]]),
  byFolder: new Map([['d1', 12]]),
  total: 412,
  mustRead: 9,
};

test('All items shows the total', () => {
  expect(unreadForScope({}, counts)).toBe(412);
});

test('a feed shows its own count, and 0 when it has none', () => {
  expect(unreadForScope({ feedId: 'f1' }, counts)).toBe(7);
  expect(unreadForScope({ feedId: 'other' }, counts)).toBe(0);
});

test('a folder shows its own count, and 0 when it has none', () => {
  expect(unreadForScope({ folderId: 'd1' }, counts)).toBe(12);
  expect(unreadForScope({ folderId: 'other' }, counts)).toBe(0);
});

test('Must read shows the must-read total, not the All items total', () => {
  expect(unreadForScope({ attention: 'precious' }, counts)).toBe(9);
});

test('Starred and Shared show no count', () => {
  expect(unreadForScope({ starred: true }, counts)).toBeNull();
  expect(unreadForScope({ shared: true }, counts)).toBeNull();
});
