import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// SPEC-024: retention deletes old articles, never what someone wants kept.

// Keep the re-poll off the network: the feed URL answers with this XML.
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

const { pruneOldArticles, KEEP_NEWEST_PER_FEED } = await import('./prune.js');
const { fetchAndStoreFeed } = await import('../lib/feed-fetch.js');
const { db } = await import('../db/index.js');
const { appSettings, articles, articleStates } = await import('../db/schema.js');
const { getAppSettings } = await import('../lib/app-settings.js');
const { resetDb, seedArticle, seedArticleState, seedFeed, seedUser } = await import('../../test/helpers.js');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetDb();
  responses.clear();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

async function setRetention(days: number | null) {
  await getAppSettings(); // the singleton row
  await db.update(appSettings).set({ articleRetentionDays: days }).where(eq(appSettings.id, 1));
}
const ids = async (feedId: string) =>
  (await db.select({ id: articles.id }).from(articles).where(eq(articles.feedId, feedId))).map((r) => r.id);

/** A busy feed: `n` recent articles, so its newest 100 are all recent. */
async function busyFeed(n = KEEP_NEWEST_PER_FEED) {
  const feed = await seedFeed();
  await db.insert(articles).values(
    Array.from({ length: n }, (_, i) => ({
      feedId: feed.id,
      guid: `recent-${i}`,
      publishedAt: daysAgo(1 + i / 1000),
      fetchedAt: daysAgo(1),
    })),
  );
  return feed;
}
const old = { publishedAt: daysAgo(400), fetchedAt: daysAgo(400) };

test('with retention off (the default), nothing is deleted and nothing is logged', async () => {
  const feed = await busyFeed();
  const a = await seedArticle(feed.id, old);
  expect(await pruneOldArticles()).toBe(0);
  expect(await ids(feed.id)).toContain(a.id);
  expect(log).not.toHaveBeenCalled();
});

test('old articles go; starred, shared and recently fetched ones stay', async () => {
  await setRetention(30);
  const feed = await busyFeed();
  const user = await seedUser();
  const plain = await seedArticle(feed.id, old);
  const read = await seedArticle(feed.id, old);
  await seedArticleState(user.id, read.id, { read: true });
  const starred = await seedArticle(feed.id, old);
  await seedArticleState(user.id, starred.id, { starred: true });
  const shared = await seedArticle(feed.id, old);
  await seedArticleState(user.id, shared.id, { shared: true });
  // An old post from a feed subscribed to this week.
  const newlyFetched = await seedArticle(feed.id, { publishedAt: daysAgo(400), fetchedAt: daysAgo(2) });
  // Inside the window.
  const young = await seedArticle(feed.id, { publishedAt: daysAgo(10), fetchedAt: daysAgo(10) });

  expect(await pruneOldArticles()).toBe(2);
  const left = await ids(feed.id);
  expect(left).not.toContain(plain.id);
  expect(left).not.toContain(read.id);
  expect(left).toEqual(expect.arrayContaining([starred.id, shared.id, newlyFetched.id, young.id]));
  expect(log).toHaveBeenCalledWith('[worker] pruned 2 article(s) older than 30 days');

  // The read state went with its article (cascade).
  const states = await db.select().from(articleStates).where(eq(articleStates.articleId, read.id));
  expect(states).toEqual([]);
});

test('an undated article goes by its fetch date', async () => {
  await setRetention(30);
  const feed = await busyFeed();
  const undatedOld = await seedArticle(feed.id, { publishedAt: null, fetchedAt: daysAgo(90) });
  expect(await pruneOldArticles()).toBe(1);
  expect(await ids(feed.id)).not.toContain(undatedOld.id);
});

test("each feed's newest 100 stay, however old", async () => {
  await setRetention(30);
  const feed = await seedFeed();
  await db.insert(articles).values(
    Array.from({ length: KEEP_NEWEST_PER_FEED + 5 }, (_, i) => ({
      feedId: feed.id,
      guid: `old-${i}`,
      publishedAt: daysAgo(400 + i),
      fetchedAt: daysAgo(400),
    })),
  );
  expect(await pruneOldArticles()).toBe(5);
  const left = await db.select({ guid: articles.guid }).from(articles).where(eq(articles.feedId, feed.id));
  expect(left).toHaveLength(KEEP_NEWEST_PER_FEED);
  // The oldest five went.
  expect(left.map((r) => r.guid)).not.toContain(`old-${KEEP_NEWEST_PER_FEED + 4}`);
});

test('a sparse feed keeps its old items, and a re-poll adds nothing new', async () => {
  await setRetention(30);
  const feed = await seedFeed();
  const items = [2019, 2020, 2021].map((y) => ({ guid: `https://sparse.example/${y}`, date: `${y}-06-01T00:00:00Z` }));
  for (const it of items) {
    await seedArticle(feed.id, { guid: it.guid, url: it.guid, publishedAt: new Date(it.date), fetchedAt: daysAgo(900) });
  }
  // The feed XML still lists all three.
  responses.set(
    feed.feedUrl,
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Sparse</title><link>https://sparse.example</link>' +
      items.map((it) => `<item><guid>${it.guid}</guid><link>${it.guid}</link><pubDate>${new Date(it.date).toUTCString()}</pubDate></item>`).join('') +
      '</channel></rss>',
  );

  expect(await pruneOldArticles()).toBe(0);
  await fetchAndStoreFeed(feed);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .where(eq(articles.feedId, feed.id));
  expect(row?.count).toBe(3);
});

test('the guards are per feed: one busy feed does not shield another', async () => {
  await setRetention(30);
  await busyFeed();
  const quiet = await seedFeed();
  // 101 old articles in the quiet feed: exactly one is past its newest 100.
  await db.insert(articles).values(
    Array.from({ length: KEEP_NEWEST_PER_FEED + 1 }, (_, i) => ({
      feedId: quiet.id,
      guid: `q-${i}`,
      publishedAt: daysAgo(100 + i),
      fetchedAt: daysAgo(100),
    })),
  );
  expect(await pruneOldArticles()).toBe(1);
});
