import { describe, expect, test } from 'vitest';
import { findRenamedEntries, type EntryKey } from './renamed-entries.js';

// #51: a post whose URL (and so guid) changed is the same post.

const day = new Date('2026-09-20T10:00:00Z');
const body = 'I went to the movie theater last night and watched a film about films.';
const entry = (guid: string, over: Partial<EntryKey> = {}): EntryKey => ({
  guid,
  title: 'Notes of movie theater',
  publishedAt: day,
  contentText: body,
  ...over,
});
const OLD = 'https://hamatti.org/posts/notes-ofmovie-theater/';
const NEW = 'https://hamatti.org/posts/notes-of-movie-theater/';

describe('findRenamedEntries', () => {
  test('a URL-only change maps the new guid to the stored article', () => {
    const map = findRenamedEntries([entry(NEW)], [{ id: 'a1', ...entry(OLD) }]);
    expect(map).toEqual(new Map([[NEW, 'a1']]));
  });

  test('whitespace in the body does not matter, and a small clock skew is fine', () => {
    const stored = { id: 'a1', ...entry(OLD, { contentText: `  ${body.replace(/ /g, '\n ')} ` }) };
    const moved = entry(NEW, { publishedAt: new Date(day.getTime() + 5 * 60_000) });
    expect(findRenamedEntries([moved], [stored]).get(NEW)).toBe('a1');
  });

  test('the same title on another date is a different post', () => {
    const later = entry(NEW, { publishedAt: new Date('2026-09-21T10:00:00Z') });
    expect(findRenamedEntries([later], [{ id: 'a1', ...entry(OLD) }]).size).toBe(0);
  });

  test('the same title and date with another body is a different post (a daily digest)', () => {
    const digest = entry(NEW, { contentText: 'Today: three new links about CSS.' });
    expect(findRenamedEntries([digest], [{ id: 'a1', ...entry(OLD) }]).size).toBe(0);
  });

  test('a stored article whose guid is still in the feed is a separate post', () => {
    const map = findRenamedEntries([entry(OLD), entry(NEW)], [{ id: 'a1', ...entry(OLD) }]);
    expect(map.size).toBe(0);
  });

  test('a known guid, or no title or date, never matches', () => {
    const stored = [{ id: 'a1', ...entry(OLD) }];
    expect(findRenamedEntries([entry(OLD)], stored).size).toBe(0);
    expect(findRenamedEntries([entry(NEW, { title: null })], stored).size).toBe(0);
    expect(findRenamedEntries([entry(NEW, { publishedAt: null })], stored).size).toBe(0);
  });

  test('one stored article matches only one incoming entry', () => {
    const map = findRenamedEntries([entry(NEW), entry(`${NEW}?v=2`)], [{ id: 'a1', ...entry(OLD) }]);
    expect([...map.values()]).toEqual(['a1']);
  });
});
