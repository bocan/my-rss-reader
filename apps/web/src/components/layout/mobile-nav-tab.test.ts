import { expect, test } from 'vitest';
import { mobileNavTab } from './mobile-nav-tab';

const tab = (filters: Record<string, unknown>, extra: { isSearching?: boolean; communityOpen?: boolean } = {}) =>
  mobileNavTab({
    isSearching: extra.isSearching ?? false,
    communityOpen: extra.communityOpen ?? false,
    filters: { sort: 'newest', ...filters },
  });

test('All items lights All; Starred lights Starred; a search lights Search', () => {
  expect(tab({})).toBe('all');
  expect(tab({ starred: true })).toBe('starred');
  expect(tab({}, { isSearching: true })).toBe('search');
});

test('Shared, Precious, Community, a feed, and a folder light no tab (#22)', () => {
  expect(tab({ shared: true })).toBeNull();
  expect(tab({ attention: 'precious' })).toBeNull();
  expect(tab({}, { communityOpen: true })).toBeNull();
  expect(tab({ feedId: 'f1' })).toBeNull();
  expect(tab({ folderId: 'd1' })).toBeNull();
});
