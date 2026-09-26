import { describe, expect, test } from 'vitest';
import {
  createRuleSchema,
  createSavedSearchSchema,
  updateRuleSchema,
  updateSavedSearchSchema,
} from './search-rules.js';

// SPEC-025: saved searches and filter rules.

describe('createSavedSearchSchema', () => {
  test('trims, and defaults starred to false', () => {
    expect(createSavedSearchSchema.parse({ name: ' Postgres ', q: ' postgres ' })).toEqual({
      name: 'Postgres',
      q: 'postgres',
      starred: false,
    });
  });
  test('refuses an empty name or query, and a long name', () => {
    expect(createSavedSearchSchema.safeParse({ name: '  ', q: 'x' }).success).toBe(false);
    expect(createSavedSearchSchema.safeParse({ name: 'x', q: '' }).success).toBe(false);
    expect(createSavedSearchSchema.safeParse({ name: 'x'.repeat(61), q: 'x' }).success).toBe(false);
  });
  test('the scope is optional and may be null', () => {
    const scoped = { name: 'n', q: 'q', feedId: null, folderId: null, unread: null };
    expect(createSavedSearchSchema.safeParse(scoped).success).toBe(true);
  });
});

test('updateSavedSearchSchema needs a name or a position', () => {
  expect(updateSavedSearchSchema.safeParse({}).success).toBe(false);
  expect(updateSavedSearchSchema.safeParse({ position: 2 }).success).toBe(true);
});

describe('createRuleSchema', () => {
  test('a phrase is at least 2 characters after trimming', () => {
    const base = { field: 'title', action: 'markRead' } as const;
    expect(createRuleSchema.safeParse({ ...base, phrase: ' a ' }).success).toBe(false);
    expect(createRuleSchema.parse({ ...base, phrase: ' ad ' }).phrase).toBe('ad');
  });
  test('only the known fields and actions', () => {
    expect(createRuleSchema.safeParse({ field: 'url', phrase: 'xx', action: 'star' }).success).toBe(false);
    expect(createRuleSchema.safeParse({ field: 'title', phrase: 'xx', action: 'delete' }).success).toBe(false);
  });
  test('a phrase with pattern characters is fine: it is a literal', () => {
    expect(createRuleSchema.safeParse({ field: 'title', phrase: '100%_\\', action: 'star' }).success).toBe(true);
  });
});

test('updateRuleSchema needs at least one field', () => {
  expect(updateRuleSchema.safeParse({}).success).toBe(false);
  expect(updateRuleSchema.safeParse({ enabled: false }).success).toBe(true);
  expect(updateRuleSchema.safeParse({ feedId: null }).success).toBe(true);
});
