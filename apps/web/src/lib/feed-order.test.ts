import { describe, expect, test } from 'vitest';
import {
  canReorder,
  dropIndex,
  FEED_SORTS,
  feedMatches,
  isFeedSort,
  makeFeedComparator,
  makeFolderComparator,
  orderedVisibleFeedIds,
  placeAt,
} from './feed-order';
import type { FolderRow, SubscriptionRow } from './folders';

const folder = (id: string, name: string, parentId: string | null = null, position = 0): FolderRow =>
  ({ id, name, parentId, position, createdAt: '2026-01-01T00:00:00Z' }) as FolderRow;

const sub = (
  feedId: string,
  title: string,
  folderId: string | null = null,
  position = 0,
): SubscriptionRow =>
  ({ subscriptionId: `sub-${feedId}`, feedId, title, customTitle: null, feedUrl: '', folderId, position }) as SubscriptionRow;

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

  // #27: n/p follow the manual order the sidebar shows.
  test('manual sort orders folders and feeds by saved position, not by name', () => {
    const folders = [folder('fA', 'Alpha', null, 1), folder('fZ', 'Zeta', null, 0)];
    const subs = [
      sub('a1', 'apple', 'fA', 1),
      sub('a2', 'banana', 'fA', 0),
      sub('z1', 'zzz', 'fZ', 0),
      sub('u1', 'loose alpha', null, 1),
      sub('u2', 'loose beta', null, 0),
    ];
    const order = orderedVisibleFeedIds({
      folders,
      subs,
      sort: 'manual',
      countByFeed: new Map([['a1', 99]]),
      expanded: new Set(['fA', 'fZ']),
    });
    expect(order).toEqual(['z1', 'a2', 'a1', 'u2', 'u1']);
  });
});

describe('manual order comparators', () => {
  test('feeds: position first, the name only breaks a tie', () => {
    const cmp = makeFeedComparator('manual', new Map());
    const rows = [sub('b', 'bravo', null, 1), sub('z', 'zulu', null, 0), sub('a', 'alpha', null, 1)];
    expect(rows.sort(cmp).map((s) => s.feedId)).toEqual(['z', 'a', 'b']);
  });

  test('folders: position, then age, as the server orders them', () => {
    const older = { ...folder('old', 'Zeta', null, 0), createdAt: '2025-01-01T00:00:00Z' };
    const rows = [folder('new', 'Alpha', null, 0), older, folder('last', 'Beta', null, 2)];
    expect(rows.sort(makeFolderComparator('manual')).map((f) => f.id)).toEqual(['old', 'new', 'last']);
    // Other modes stay alphabetical.
    expect(rows.sort(makeFolderComparator('unread')).map((f) => f.name)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });

  test('only manual mode offers reorder, and saved values are checked', () => {
    expect(FEED_SORTS.filter(canReorder)).toEqual(['manual']);
    expect(isFeedSort('manual')).toBe(true);
    expect(isFeedSort('oldest')).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});

describe('dropIndex', () => {
  const scope = ['a', 'b', 'c', 'd'];

  test('dragged down, the row lands after the row under it', () => {
    // b onto d: [a, c, d, b], so index 3 among the others.
    expect(dropIndex(scope, 'b', 'd')).toBe(3);
  });

  test('dragged up, the row lands before the row under it', () => {
    expect(dropIndex(scope, 'd', 'b')).toBe(1);
  });

  test('from another folder, the row lands before the row under it', () => {
    expect(dropIndex(scope, 'x', 'c')).toBe(2);
  });

  test('an unknown target appends', () => {
    expect(dropIndex(scope, 'x', 'gone')).toBe(4);
  });
});

describe('placeAt (the optimistic copy of the server placement)', () => {
  const row = (id: string, scope: string, position: number) => ({ id, scope, position });

  test('moves a row inside its scope and renumbers the scope 0..n-1', () => {
    const items = [row('a', 's', 0), row('b', 's', 1), row('c', 's', 2), row('x', 't', 0)];
    const out = placeAt(items, {
      isMoved: (r) => r.id === 'c',
      inScope: (r) => r.scope === 's',
      index: 0,
      move: (r) => r,
    });
    const order = out.filter((r) => r.scope === 's').sort((p, q) => p.position - q.position);
    expect(order.map((r) => [r.id, r.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
    expect(out.find((r) => r.id === 'x')!.position).toBe(0); // other scopes untouched
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'x']); // array order kept
  });

  test('moves a row into another scope, appending when no index is given', () => {
    const items = [row('a', 's', 0), row('x', 't', 0), row('y', 't', 1)];
    const out = placeAt(items, {
      isMoved: (r) => r.id === 'a',
      inScope: (r) => r.scope === 't',
      move: (r) => ({ ...r, scope: 't' }),
    });
    expect(out.find((r) => r.id === 'a')).toEqual({ id: 'a', scope: 't', position: 2 });
  });
});

// #46: the sidebar filter.
describe('feedMatches', () => {
  const s = { title: 'Dave Rupert', customTitle: 'Dave', feedUrl: 'https://daverupert.com/atom.xml' };
  test('matches the title, the custom title or the URL, in any case', () => {
    expect(feedMatches(s, 'rupert')).toBe(true);
    expect(feedMatches({ ...s, title: null }, 'dave')).toBe(true);
    expect(feedMatches(s, 'atom.xml')).toBe(true);
  });
  test('no match, and a missing title is not an error', () => {
    expect(feedMatches({ ...s, title: null, customTitle: null }, 'simon')).toBe(false);
  });
});
