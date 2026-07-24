import { describe, expect, test } from 'vitest';
import { ARTICLE_VIEWS, VIEW_MODES } from '../types.js';
import {
  DEFAULT_SETTINGS,
  settingsSchema,
  THEMES,
  updateSettingsSchema,
} from './settings.js';

describe('settingsSchema', () => {
  test('accepts a full valid object and the defaults', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  test('partial accepts single-field updates', () => {
    expect(updateSettingsSchema.safeParse({ theme: 'dark' }).success).toBe(true);
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
  expect([...VIEW_MODES]).toEqual(['cards', 'list', 'magazine', 'compact']);
  expect([...ARTICLE_VIEWS]).toEqual(['simplified', 'readable', 'web']);
  expect([...THEMES]).toEqual(['light', 'dark', 'system']);
});
