import { describe, expect, test } from 'vitest';
import { orderedVisibleFeedIds } from './feed-order';
import type { FolderRow, SubscriptionRow } from './folders';

const folder = (id: string, name: string, parentId: string | null = null): FolderRow =>
  ({ id, name, parentId }) as FolderRow;

const sub = (feedId: string, title: string, folderId: string | null = null): SubscriptionRow =>
  ({ subscriptionId: `sub-${feedId}`, feedId, title, customTitle: null, feedUrl: '', folderId }) as SubscriptionRow;

describe('orderedVisibleFeedIds', () => {
  test('folders alphabetical, feeds alphabetical within, unfoldered last', () => {
    const folders = [folder('fZ', 'Zeta'), folder('fA', 'Alpha')];
    const subs = [
      sub('u2', 'unfoldered beta'),
      sub('u1', 'unfoldered alpha'),
      sub('z1', 'zzz', 'fZ'),
      sub('a2', 'banana', 'fA'),
      sub('a1', 'apple', 'fA'),
    ];
    const order = orderedVisibleFeedIds({
      folders,
      subs,
      sort: 'name',
      countByFeed: new Map(),
      expanded: new Set(['fA', 'fZ']),
    });
    // Alpha folder (apple, banana), Zeta folder (zzz), then unfoldered (alpha, beta).
    expect(order).toEqual(['a1', 'a2', 'z1', 'u1', 'u2']);
  });

  test('collapsed folders hide their feeds from the order', () => {
    const folders = [folder('fA', 'Alpha')];
    const subs = [sub('a1', 'apple', 'fA'), sub('u1', 'loose')];
    const order = orderedVisibleFeedIds({
      folders,
      subs,
      sort: 'name',
      countByFeed: new Map(),
      expanded: new Set(), // Alpha collapsed
    });
    expect(order).toEqual(['u1']);
  });

  test('unread sort puts feeds with unread first (desc), zero-unread back to A-Z', () => {
    const folders = [folder('fA', 'Alpha')];
    const subs = [
      sub('low', 'aaa', 'fA'),
      sub('high', 'zzz', 'fA'),
      sub('zeroB', 'yankee', 'fA'),
      sub('zeroA', 'bravo', 'fA'),
    ];
    const order = orderedVisibleFeedIds({
      folders,
      subs,
      sort: 'unread',
      countByFeed: new Map([
        ['low', 3],
        ['high', 20],
        ['zeroA', 0],
        ['zeroB', 0],
      ]),
      expanded: new Set(['fA']),
    });
    // high(20), low(3), then zero-unread alphabetical: bravo, yankee.
    expect(order).toEqual(['high', 'low', 'zeroA', 'zeroB']);
  });

  test('child folder feeds precede the parent folder’s own feeds', () => {
    const folders = [folder('root', 'Root'), folder('kid', 'Kid', 'root')];
    const subs = [sub('own', 'own feed', 'root'), sub('child', 'child feed', 'kid')];
    const order = orderedVisibleFeedIds({
      folders,
      subs,
      sort: 'name',
      countByFeed: new Map(),
      expanded: new Set(['root', 'kid']),
    });
    expect(order).toEqual(['child', 'own']);
  });
});
