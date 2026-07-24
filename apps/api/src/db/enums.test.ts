import { ARTICLE_VIEWS } from '@rss/shared';
import { expect, test } from 'vitest';
import { articleViewEnum } from './schema.js';

// articleView is the only remaining pgEnum-backed preference; theme, density and
// the view-mode columns are text (SPEC-016). Its members must match the shared
// vocab or a value valid in one layer would be rejected by the other.
test('the article_view enum matches the shared vocabulary', () => {
  expect([...articleViewEnum.enumValues]).toEqual([...ARTICLE_VIEWS]);
});
