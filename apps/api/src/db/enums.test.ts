import { ARTICLE_VIEWS, THEMES, VIEW_MODES } from '@rss/shared';
import { expect, test } from 'vitest';
import { articleViewEnum, themePref, viewModeEnum } from './schema.js';

// The pgEnum members and the shared Zod vocab must match exactly, or a settings
// value valid in one layer would be rejected by the other.
test('DB preference enums match the shared vocabulary', () => {
  expect([...viewModeEnum.enumValues]).toEqual([...VIEW_MODES]);
  expect([...articleViewEnum.enumValues]).toEqual([...ARTICLE_VIEWS]);
  expect([...themePref.enumValues]).toEqual([...THEMES]);
});
