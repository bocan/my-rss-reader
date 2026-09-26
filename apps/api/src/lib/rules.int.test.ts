import { RULE_APPLY_LIMIT } from '@rss/shared';
import { and, eq } from 'drizzle-orm';
import { beforeEach, expect, test, vi } from 'vitest';

// SPEC-025: filter rules at ingestion, and "Run on existing articles".

// Keep fetches off the network: each test sets the feed XML.
const responses = vi.hoisted(() => new Map<string, string>());
vi.mock('undici', () => ({
  request: vi.fn(async (url: string) => {
    const body = responses.get(url);
    if (body === undefined) throw new Error(`no mock for ${url}`);
    return { statusCode: 200, headers: {}, body: { text: async () => body } };
  }),
  Agent: class {
    compose() {
      return this;
    }
  },
  interceptors: { redirect: () => ({}) },
}));

const { fetchAndStoreFeed, storeNewArticles } = await import('./feed-fetch.js');
const { applyRuleToExisting, applyRulesToNewSubscription } = await import('./rules.js');
const { db } = await import('../db/index.js');
const { articles, articleStates, filterRules } = await import('../db/schema.js');
const { resetDb, seedArticle, seedArticleState, seedFeed, seedSubscription, seedUser } = await import(
  '../../test/helpers.js'
);

beforeEach(async () => {
  await resetDb();
  responses.clear();
});

type Rule = typeof filterRules.$inferInsert;
const addRule = async (rule: Rule) => (await db.insert(filterRules).values(rule).returning())[0]!;

const stateOf = async (userId: string, guid: string) => {
  const [row] = await db
    .select({ read: articleStates.read, starred: articleStates.starred })
    .from(articleStates)
    .innerJoin(articles, eq(articles.id, articleStates.articleId))
    .where(and(eq(articleStates.userId, userId), eq(articles.guid, guid)));
  return row ?? null;
};

const RSS = (items: { guid: string; title: string; author?: string; body?: string }[]) =>
  '<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>' +
  '<title>Noisy</title><link>https://noisy.example</link>' +
  items
    .map(
      (i) =>
        `<item><guid>${i.guid}</guid><title>${i.title}</title><link>https://noisy.example/${i.guid}</link>` +
        (i.author ? `<dc:creator>${i.author}</dc:creator>` : '') +
        (i.body ? `<description>${i.body}</description>` : '') +
        '</item>',
    )
    .join('') +
  '</channel></rss>';

test('a poll applies each subscriber\'s own rules; others see pristine state', async () => {
  const feed = await seedFeed();
  const [ann, bob, cat] = [await seedUser(), await seedUser(), await seedUser()];
  for (const u of [ann, bob, cat]) await seedSubscription(u.id, feed.id);
  await addRule({ userId: ann.id, feedId: feed.id, field: 'title', phrase: 'sponsored', action: 'markRead' });
  await addRule({ userId: bob.id, feedId: null, field: 'author', phrase: 'simon', action: 'star' });
  responses.set(
    feed.feedUrl,
    RSS([
      { guid: 'ad', title: 'SPONSORED: buy a laptop', author: 'Ad Team' },
      { guid: 'post', title: 'On WebAssembly', author: 'Simon Willison' },
      { guid: 'plain', title: 'Plain post', author: 'Someone' },
    ]),
  );

  await fetchAndStoreFeed(feed);

  expect(await stateOf(ann.id, 'ad')).toEqual({ read: true, starred: false });
  expect(await stateOf(ann.id, 'post')).toBeNull();
  expect(await stateOf(bob.id, 'post')).toEqual({ read: false, starred: true });
  expect(await stateOf(bob.id, 'ad')).toBeNull();
  // Cat has no rules, and nobody's rule touches "plain".
  for (const guid of ['ad', 'post', 'plain']) expect(await stateOf(cat.id, guid)).toBeNull();
  expect(await stateOf(ann.id, 'plain')).toBeNull();
});

test('content rules read the body, and the summary of a summary-only feed', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  await addRule({ userId: user.id, feedId: null, field: 'content', phrase: 'giveaway', action: 'markRead' });
  responses.set(feed.feedUrl, RSS([{ guid: 'g', title: 't', body: 'Enter our GIVEAWAY now' }]));

  await fetchAndStoreFeed(feed);
  expect(await stateOf(user.id, 'g')).toEqual({ read: true, starred: false });
});

test('disabled rules, rules for another feed, and rules of non-subscribers do nothing', async () => {
  const feed = await seedFeed();
  const other = await seedFeed();
  const [sub, outsider] = [await seedUser(), await seedUser()];
  await seedSubscription(sub.id, feed.id);
  await addRule({ userId: sub.id, feedId: null, field: 'title', phrase: 'ad', action: 'markRead', enabled: false });
  await addRule({ userId: sub.id, feedId: other.id, field: 'title', phrase: 'ad', action: 'markRead' });
  await addRule({ userId: outsider.id, feedId: null, field: 'title', phrase: 'ad', action: 'markRead' });
  responses.set(feed.feedUrl, RSS([{ guid: 'ad', title: 'An ad' }]));

  await fetchAndStoreFeed(feed);
  expect(await db.select().from(articleStates)).toEqual([]);
});

test('a crafted phrase ingests fine and matches only literally', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  await addRule({ userId: user.id, feedId: null, field: 'title', phrase: '100%_\\', action: 'star' });
  responses.set(feed.feedUrl, RSS([{ guid: 'yes', title: 'We gave 100%_\\ today' }, { guid: 'no', title: '1000 ways' }]));

  await fetchAndStoreFeed(feed);
  expect(await stateOf(user.id, 'yes')).toEqual({ read: false, starred: true });
  expect(await stateOf(user.id, 'no')).toBeNull();
});

test('rules act on NEW articles only: a stored row whose gap is filled is not new', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  // Stored before, with no body; the next fetch fills the body (an update).
  await seedArticle(feed.id, { guid: 'old', title: 'Sponsored old post', contentHtml: null });
  await addRule({ userId: user.id, feedId: null, field: 'title', phrase: 'sponsored', action: 'markRead' });

  await storeNewArticles(feed.id, [
    { feedId: feed.id, guid: 'old', title: 'Sponsored old post', contentHtml: '<p>Body</p>' },
    { feedId: feed.id, guid: 'new', title: 'Sponsored new post' },
  ]);

  expect(await stateOf(user.id, 'old')).toBeNull();
  expect(await stateOf(user.id, 'new')).toEqual({ read: true, starred: false });
  const [filled] = await db.select().from(articles).where(eq(articles.guid, 'old'));
  expect(filled!.contentHtml).toBe('<p>Body</p>');
});

// --- Run on existing articles --------------------------------------------

test('apply matches existing articles, counts them, and is idempotent', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  for (const t of ['Sponsored one', 'a SPONSORED two', 'Plain']) await seedArticle(feed.id, { title: t });
  const rule = { feedId: null, field: 'title' as const, phrase: 'sponsored', action: 'markRead' as const };

  expect(await applyRuleToExisting(rule, user.id)).toBe(2);
  expect(await applyRuleToExisting(rule, user.id)).toBe(2);
  const states = await db.select().from(articleStates).where(eq(articleStates.userId, user.id));
  expect(states).toHaveLength(2);
  expect(states.every((s) => s.read && !s.starred)).toBe(true);
});

test('apply never un-reads or un-stars, and keeps the first read time', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  const starredUnread = await seedArticle(feed.id, { title: 'Sponsored A' });
  await seedArticleState(user.id, starredUnread.id, { starred: true, starredAt: new Date('2026-01-01') });
  const readAlready = await seedArticle(feed.id, { title: 'Sponsored B' });
  const readAt = new Date('2026-02-02T00:00:00Z');
  await seedArticleState(user.id, readAlready.id, { read: true, readAt });

  await applyRuleToExisting({ feedId: null, field: 'title', phrase: 'sponsored', action: 'markRead' }, user.id);
  await applyRuleToExisting({ feedId: null, field: 'title', phrase: 'sponsored', action: 'star' }, user.id);

  const [a] = await db.select().from(articleStates).where(eq(articleStates.articleId, starredUnread.id));
  const [b] = await db.select().from(articleStates).where(eq(articleStates.articleId, readAlready.id));
  expect(a).toMatchObject({ read: true, starred: true, starredAt: new Date('2026-01-01') });
  expect(b).toMatchObject({ read: true, starred: true, readAt });
});

test('apply is literal in SQL too: % and _ match only themselves', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { title: 'snake_case tips' });
  await seedArticle(feed.id, { title: 'snakeXcase tips' });
  await seedArticle(feed.id, { title: 'Save 50% now' });
  await seedArticle(feed.id, { title: 'Save 500 now' });
  const run = (phrase: string) =>
    applyRuleToExisting({ feedId: null, field: 'title', phrase, action: 'star' }, user.id);

  expect(await run('snake_case')).toBe(1);
  expect(await run('50%')).toBe(1);
  expect(await run('\\')).toBe(0);
});

test('apply touches only feeds the user still follows, and the rule\'s own feed', async () => {
  const [mine, left, other] = [await seedFeed(), await seedFeed(), await seedFeed()];
  const user = await seedUser();
  await seedSubscription(user.id, mine.id);
  await seedSubscription(user.id, other.id);
  await seedArticle(mine.id, { title: 'Sponsored' });
  await seedArticle(left.id, { title: 'Sponsored' }); // not subscribed
  await seedArticle(other.id, { title: 'Sponsored' });

  expect(await applyRuleToExisting({ feedId: null, field: 'title', phrase: 'sponsored', action: 'star' }, user.id)).toBe(2);
  expect(
    await applyRuleToExisting({ feedId: mine.id, field: 'title', phrase: 'sponsored', action: 'star' }, user.id),
  ).toBe(1);
});

test(`apply looks at no more than the newest ${RULE_APPLY_LIMIT} articles`, async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedSubscription(user.id, feed.id);
  const now = Date.now();
  await db.insert(articles).values(
    Array.from({ length: RULE_APPLY_LIMIT + 3 }, (_, i) => ({
      feedId: feed.id,
      guid: `g${i}`,
      title: 'Sponsored',
      publishedAt: new Date(now - i * 60_000),
    })),
  );
  expect(await applyRuleToExisting({ feedId: null, field: 'title', phrase: 'sponsored', action: 'markRead' }, user.id)).toBe(
    RULE_APPLY_LIMIT,
  );
  // The three oldest were outside the window.
  for (const i of [RULE_APPLY_LIMIT, RULE_APPLY_LIMIT + 1, RULE_APPLY_LIMIT + 2]) {
    expect(await stateOf(user.id, `g${i}`)).toBeNull();
  }
});

test('a new subscription runs the user\'s rules over the articles already stored', async () => {
  const feed = await seedFeed();
  const user = await seedUser();
  await seedArticle(feed.id, { guid: 'ad', title: 'Sponsored post' });
  await seedArticle(feed.id, { guid: 'ok', title: 'Real post' });
  await addRule({ userId: user.id, feedId: null, field: 'title', phrase: 'sponsored', action: 'markRead' });
  await addRule({ userId: user.id, feedId: null, field: 'title', phrase: 'real', action: 'star', enabled: false });
  await seedSubscription(user.id, feed.id);

  await applyRulesToNewSubscription(user.id, feed.id);
  expect(await stateOf(user.id, 'ad')).toEqual({ read: true, starred: false });
  expect(await stateOf(user.id, 'ok')).toBeNull();
});
