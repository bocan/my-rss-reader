import { expect, test } from 'vitest';
import { relativeTime } from './relative-time';

test('relative times round to the largest unit', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const ago = (secs: number) => new Date(now - secs * 1000).toISOString();
  expect(relativeTime(null, now)).toBe('never');
  expect(relativeTime(ago(30), now)).toBe('just now');
  expect(relativeTime(ago(7 * 60), now)).toBe('7m ago');
  expect(relativeTime(ago(3 * 3600), now)).toBe('3h ago');
  expect(relativeTime(ago(2 * 86400), now)).toBe('2d ago');
});
