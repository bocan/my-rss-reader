import { describe, expect, test } from 'vitest';
import { SLUG_RE } from './profile.js';

describe('SLUG_RE', () => {
  test.each(['chris', 'chris-f', 'a1b', 'reader-42', 'x'.repeat(32)])('accepts %s', (slug) => {
    expect(SLUG_RE.test(slug)).toBe(true);
  });

  test.each([
    'ab', // too short
    'x'.repeat(33), // too long
    'Chris', // uppercase
    '-chris', // leading dash
    'chris-', // trailing dash
    'chris_f', // underscore
    'chris f', // space
    'chr/is', // slash
    '', // empty
  ])('rejects %j', (slug) => {
    expect(SLUG_RE.test(slug)).toBe(false);
  });
});
