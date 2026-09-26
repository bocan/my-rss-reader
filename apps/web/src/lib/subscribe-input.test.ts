import { describe, expect, test } from 'vitest';
import { isSubscribableUrl, normalizeSubscribeInput } from './subscribe-input';

// SPEC-023: handles and bare domains are fine in the subscribe box.

describe('normalizeSubscribeInput', () => {
  test.each([
    // Fediverse handles, with and without the leading @.
    ['@someone@hachyderm.io', 'https://hachyderm.io/@someone'],
    ['someone@hachyderm.io', 'https://hachyderm.io/@someone'],
    ['  @someone@hachyderm.io  ', 'https://hachyderm.io/@someone'],
    ['@Some.One_2@Social.Example.ORG', 'https://social.example.org/@Some.One_2'],
    // Full URLs stay as they are.
    ['https://hachyderm.io/@someone', 'https://hachyderm.io/@someone'],
    ['https://bsky.app/profile/somebody.bsky.social', 'https://bsky.app/profile/somebody.bsky.social'],
    ['http://example.com/feed.xml', 'http://example.com/feed.xml'],
    ['HTTPS://Example.com/', 'HTTPS://Example.com/'],
    // feed:// is what browsers use for feed links.
    ['feed://example.com/rss.xml', 'https://example.com/rss.xml'],
    // Bare domains get https://.
    ['example.com', 'https://example.com'],
    ['blog.example.co.uk/posts?page=2', 'https://blog.example.co.uk/posts?page=2'],
    ['localhost.test:8080/feed', 'https://localhost.test:8080/feed'],
    // Anything else is left for the caller to reject.
    ['not a url', 'not a url'],
    ['@someone', '@someone'],
    ['someone@localhost', 'someone@localhost'],
    ['', ''],
  ])('%j -> %j', (input, out) => {
    expect(normalizeSubscribeInput(input)).toBe(out);
  });
});

describe('isSubscribableUrl', () => {
  test('http and https only', () => {
    expect(isSubscribableUrl('https://example.com')).toBe(true);
    expect(isSubscribableUrl('http://example.com/feed')).toBe(true);
    expect(isSubscribableUrl('ftp://example.com')).toBe(false);
    expect(isSubscribableUrl('javascript:alert(1)')).toBe(false);
    expect(isSubscribableUrl('not a url')).toBe(false);
  });
});
