import { describe, expect, test } from 'vitest';
import { resolveAutoView } from './article-view';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const url = 'https://blog.example/post';

describe('resolveAutoView', () => {
  test('uses the feed when it carries a full article', () => {
    expect(resolveAutoView({ url, contentHtml: `<p>${words(200)}.</p>` })).toBe('readable');
  });

  test('extracts when the feed has no body', () => {
    expect(resolveAutoView({ url, contentHtml: null })).toBe('simplified');
    expect(resolveAutoView({ url, contentHtml: '<p> </p>' })).toBe('simplified');
  });

  test('extracts when the feed body is only a short teaser', () => {
    expect(resolveAutoView({ url, contentHtml: `<p>${words(10)}</p>` })).toBe('simplified');
  });

  test.each([
    ['an ellipsis', `<p>${words(60)}…</p>`],
    ['three dots', `<p>${words(60)}...</p>`],
    ['a bracketed ellipsis', `<p>${words(60)} [&hellip;]</p>`],
    ['a read-more link', `<p>${words(60)}</p><p><a href="${url}">Continue reading →</a></p>`],
  ])('extracts when the feed body ends with %s', (_label, contentHtml) => {
    expect(resolveAutoView({ url, contentHtml })).toBe('simplified');
  });

  test('never extracts a #fragment of a shared page, even with no body', () => {
    const changelog = 'https://code.claude.com/docs/en/changelog#2-1-281';
    expect(resolveAutoView({ url: changelog, contentHtml: '<ul><li>Fixed a bug</li></ul>' })).toBe(
      'readable',
    );
    expect(resolveAutoView({ url: changelog, contentHtml: null })).toBe('readable');
  });

  test('uses the feed when there is no link to extract from', () => {
    expect(resolveAutoView({ url: null, contentHtml: null })).toBe('readable');
  });

  test('a bare trailing "#" is not a fragment link', () => {
    expect(resolveAutoView({ url: `${url}#`, contentHtml: null })).toBe('simplified');
  });
});
