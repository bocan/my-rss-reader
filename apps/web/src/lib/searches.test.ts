import type { SavedSearchDto } from '@rss/shared';
import { describe, expect, test } from 'vitest';
import { canSaveSearch, captureScope, describeScope, savedSearchFilters, showsSavedSearch } from './searches';

// SPEC-025: a saved search opens the same list as the manual search.

const saved = (over: Partial<SavedSearchDto> = {}): SavedSearchDto => ({
  id: 's1',
  name: 'Postgres',
  q: 'postgres',
  feedId: null,
  folderId: null,
  starred: false,
  unread: null,
  position: 0,
  createdAt: '',
  ...over,
});

describe('savedSearchFilters', () => {
  test('all feeds', () => {
    expect(savedSearchFilters(saved())).toEqual({ sort: 'newest' });
  });
  test('the full scope', () => {
    expect(savedSearchFilters(saved({ folderId: 'd1', starred: true, unread: true }))).toEqual({
      sort: 'newest',
      folderId: 'd1',
      starred: true,
      unread: true,
    });
  });
});

describe('showsSavedSearch', () => {
  const s = saved({ feedId: 'f1', unread: true });
  const filters = savedSearchFilters(s);
  test('true for its own query and scope, spaces aside', () => {
    expect(showsSavedSearch(s, filters, ' postgres ')).toBe(true);
  });
  test('false once the query or the scope changes', () => {
    expect(showsSavedSearch(s, filters, 'postgresql')).toBe(false);
    expect(showsSavedSearch(s, { ...filters, feedId: 'f2' }, 'postgres')).toBe(false);
    expect(showsSavedSearch(s, { ...filters, unread: undefined }, 'postgres')).toBe(false);
    expect(showsSavedSearch(s, { ...filters, shared: true }, 'postgres')).toBe(false);
  });
});

describe('captureScope and describeScope', () => {
  test('the live scope, with the global unread switch', () => {
    const scope = captureScope({ sort: 'newest', folderId: 'd1', starred: true }, true);
    expect(scope).toEqual({ feedId: null, folderId: 'd1', starred: true, unread: true });
    expect(describeScope(scope, { folder: 'Tech' })).toBe('in folder Tech, starred only, unread only');
  });
  test('all feeds, read and unread', () => {
    const scope = captureScope({ sort: 'newest' }, false);
    expect(scope).toEqual({ feedId: null, folderId: null, starred: false, unread: null });
    expect(describeScope(scope, {})).toBe('in all feeds');
  });
  test('a feed by name', () => {
    expect(describeScope(captureScope({ sort: 'newest', feedId: 'f1' }, false), { feed: 'CSS Tricks' })).toBe(
      'in CSS Tricks',
    );
  });
});

test('Shared and Must read lists cannot be saved as such', () => {
  expect(canSaveSearch({ sort: 'newest' })).toBe(true);
  expect(canSaveSearch({ sort: 'newest', starred: true })).toBe(true);
  expect(canSaveSearch({ sort: 'newest', shared: true })).toBe(false);
  expect(canSaveSearch({ sort: 'newest', attention: 'precious' })).toBe(false);
});
