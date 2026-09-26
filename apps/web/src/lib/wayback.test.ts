import { expect, test } from 'vitest';
import { waybackUrl } from './wayback';

test('the /web/<url> form, with the query string kept', () => {
  expect(waybackUrl('https://example.com/post?id=7')).toBe(
    'https://web.archive.org/web/https://example.com/post?id=7',
  );
});
