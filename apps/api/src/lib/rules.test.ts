import { describe, expect, test } from 'vitest';
import { likePattern, matchRules, ruleFieldText, type RuleArticle, type RuleRow } from './rules.js';

// SPEC-025: a rule phrase is a case-insensitive literal, never a pattern.

describe('likePattern', () => {
  test.each([
    ['sponsored', '%sponsored%'],
    ['100%', '%100\\%%'],
    ['snake_case', '%snake\\_case%'],
    ['C:\\temp', '%C:\\\\temp%'],
    ['100%_\\', '%100\\%\\_\\\\%'],
    ['a.b*c', '%a.b*c%'],
  ])('%j -> %j', (phrase, pattern) => {
    expect(likePattern(phrase)).toBe(pattern);
  });
});

const article = (over: Partial<RuleArticle> = {}): RuleArticle => ({
  id: 'a1',
  title: 'Sponsored: a new laptop',
  author: 'Simon Willison',
  contentText: 'The body text.',
  summary: 'The summary.',
  ...over,
});
const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  userId: 'u1',
  field: 'title',
  phrase: 'sponsored',
  action: 'markRead',
  ...over,
});

describe('ruleFieldText', () => {
  test('content is the body text, else the summary', () => {
    expect(ruleFieldText(article(), 'content')).toBe('The body text.');
    expect(ruleFieldText(article({ contentText: null }), 'content')).toBe('The summary.');
    expect(ruleFieldText(article(), 'author')).toBe('Simon Willison');
  });
});

describe('matchRules', () => {
  test('case-insensitive substring', () => {
    expect(matchRules([rule({ phrase: 'SPONSORED' })], [article()])).toEqual([
      { userId: 'u1', articleId: 'a1', read: true, starred: false },
    ]);
  });

  test('a dot is only a dot, and a star is only a star', () => {
    const batch = [article({ title: 'version 1x2' }), article({ id: 'a2', title: 'version 1.2' })];
    expect(matchRules([rule({ phrase: '1.2' })], batch).map((h) => h.articleId)).toEqual(['a2']);
    expect(matchRules([rule({ phrase: 'a*' })], [article()])).toEqual([]);
  });

  test('pattern characters are literal', () => {
    expect(matchRules([rule({ phrase: '100%_\\' })], [article({ title: 'We gave 100%_\\ today' })])).toHaveLength(1);
    expect(matchRules([rule({ phrase: '100%' })], [article({ title: '1000 things' })])).toEqual([]);
  });

  test('two rules on one article for one user merge into read and starred', () => {
    const hits = matchRules(
      [rule(), rule({ field: 'author', phrase: 'simon', action: 'star' })],
      [article()],
    );
    expect(hits).toEqual([{ userId: 'u1', articleId: 'a1', read: true, starred: true }]);
  });

  test('each user gets their own hit', () => {
    const hits = matchRules([rule(), rule({ userId: 'u2', action: 'star' })], [article()]);
    expect(hits).toEqual([
      { userId: 'u1', articleId: 'a1', read: true, starred: false },
      { userId: 'u2', articleId: 'a1', read: false, starred: true },
    ]);
  });

  test('a missing field matches nothing', () => {
    expect(matchRules([rule({ field: 'author' })], [article({ author: null })])).toEqual([]);
  });
});
