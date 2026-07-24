import { describe, expect, test } from 'vitest';
import { ARTICLE_VIEWS, DENSITIES, THEME_SETTINGS, THEMES, VIEW_MODES } from '../types.js';
import { DEFAULT_SETTINGS, settingsSchema, updateSettingsSchema } from './settings.js';

describe('settingsSchema', () => {
  test('accepts a full valid object and the defaults', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  test('partial accepts single-field updates', () => {
    expect(updateSettingsSchema.safeParse({ theme: 'auto' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ theme: 'ember' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({}).success).toBe(true);
  });

  test('rejects out-of-enum and wrong-typed values', () => {
    expect(updateSettingsSchema.safeParse({ theme: 'sepia' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ defaultViewMode: 'grid' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ defaultArticleView: 'pdf' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ markReadOnScroll: 'yes' }).success).toBe(false);
  });

  test('rejects unknown keys', () => {
    // settingsSchema is a strict shape; partial() keeps that, so extras fail.
    expect(settingsSchema.strict().safeParse({ ...DEFAULT_SETTINGS, bogus: 1 }).success).toBe(false);
  });
});

test('preference vocab is the single source of truth', () => {
  // These arrays back the DB pgEnums; a drift here means a migration mismatch.
  expect([...VIEW_MODES]).toEqual(['cards', 'list', 'magazine']);
  expect([...DENSITIES]).toEqual(['comfortable', 'compact']);
  expect([...ARTICLE_VIEWS]).toEqual(['simplified', 'readable', 'web']);
  // theme is now a free-form text column of a named theme or 'auto' (SPEC-016).
  expect([...THEME_SETTINGS]).toEqual([
    'auto',
    'daylight',
    'paper',
    'meadow',
    'beacon',
    'midnight',
    'ember',
    'pine',
    'void',
  ]);
  expect(THEMES.every((t) => t.mode === 'light' || t.mode === 'dark')).toBe(true);
});
