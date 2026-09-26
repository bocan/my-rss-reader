import { describe, expect, test } from 'vitest';
import { emptyReason, nextUnreadFeed } from './empty-state';

// #35: each empty list says why.

const base = {
  hasSubscriptions: true,
  query: '',
  scope: 'All items',
  allFeeds: true,
  unreadOnly: false,
  starred: false,
  shared: false,
  feed: undefined,
};

describe('emptyReason', () => {
  test('no subscriptions is the first run, whatever else is set', () => {
    expect(emptyReason({ ...base, hasSubscriptions: false, query: 'x', unreadOnly: true })).toEqual({
      kind: 'welcome',
    });
  });

  test('a search that found nothing names the query, the scope and the filter', () => {
    expect(
      emptyReason({ ...base, query: 'rust', scope: 'Blog', allFeeds: false, unreadOnly: true }),
    ).toEqual({ kind: 'search', query: 'rust', scope: 'Blog', allFeeds: false, unreadOnly: true });
  });

  test('unread only and nothing unread is "caught up", also in Starred', () => {
    expect(emptyReason({ ...base, unreadOnly: true })).toEqual({ kind: 'caught-up' });
    expect(emptyReason({ ...base, unreadOnly: true, starred: true })).toEqual({ kind: 'caught-up' });
  });

  test('Starred and Shared have their own', () => {
    expect(emptyReason({ ...base, starred: true })).toEqual({ kind: 'starred' });
    expect(emptyReason({ ...base, shared: true })).toEqual({ kind: 'shared' });
  });

  test('a really empty feed gives its last fetch time', () => {
    const at = '2026-09-26T08:00:00Z';
    expect(emptyReason({ ...base, feed: { lastFetchedAt: at } })).toEqual({
      kind: 'feed',
      lastFetchedAt: at,
    });
  });

  test('anything else is plain "none"', () => {
    expect(emptyReason(base)).toEqual({ kind: 'none' });
  });
});

describe('nextUnreadFeed', () => {
  const order = ['a', 'b', 'c', 'd'];
  const unread = new Map([
    ['a', 1],
    ['b', 0],
    ['c', 0],
    ['d', 4],
  ]);

  test('skips feeds with nothing unread', () => {
    expect(nextUnreadFeed(order, 'a', unread)).toBe('d');
  });

  test('wraps around to the top', () => {
    expect(nextUnreadFeed(order, 'd', unread)).toBe('a');
  });

  test('starts at the top when no feed is in view', () => {
    expect(nextUnreadFeed(order, undefined, unread)).toBe('a');
  });

  test('never returns the current feed, and nothing when no other has unread', () => {
    expect(nextUnreadFeed(['a', 'b'], 'a', new Map([['a', 3]]))).toBeUndefined();
    expect(nextUnreadFeed([], undefined, unread)).toBeUndefined();
  });
});
