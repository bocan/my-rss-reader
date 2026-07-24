import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { articles } from '../db/schema.js';
import {
  loginAs,
  resetDb,
  seedArticle,
  seedArticleState,
  seedFeed,
  seedFolder,
  seedSubscription,
  seedUser,
} from '../../test/helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
});

const search = (cookie: string, q: string, extra = '') =>
  app
    .inject({
      method: 'GET',
      url: `/api/articles?q=${encodeURIComponent(q)}${extra}`,
      headers: { cookie },
    })
    .then((r) => r.json());

const titles = (res: { items: { title: string | null }[] }) => res.items.map((i) => i.title);

/** A user subscribed to one feed, with a small distinctive corpus. */
async function corpus() {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const titleMatch = await seedArticle(feed.id, {
    title: 'Quantum computing breakthrough',
    contentText: 'unrelated body text about gardening',
  });
  const bodyMatch = await seedArticle(feed.id, {
    title: 'Gardening weekly',
    contentText: 'a long discussion of quantum mechanics in the body',
  });
  const authorMatch = await seedArticle(feed.id, {
    title: 'Sports roundup',
    author: 'Quantum Dave',
    contentText: 'football results',
  });
  return { user, feed, titleMatch, bodyMatch, authorMatch, cookie: await loginAs(user) };
}

test('title matches rank above body-only matches', async () => {
  const { cookie } = await corpus();
  const res = await search(cookie, 'quantum');
  expect(res.items.length).toBe(3);
  expect(titles(res)[0]).toBe('Quantum computing breakthrough'); // weight A wins
  const order = titles(res);
  expect(order.indexOf('Quantum computing breakthrough')).toBeLessThan(
    order.indexOf('Gardening weekly'),
  );
});

test('an author-name query surfaces that author articles', async () => {
  const { cookie } = await corpus();
  const res = await search(cookie, 'Dave');
  expect(titles(res)).toEqual(['Sports roundup']);
});

test('search never returns articles from feeds the user is not subscribed to', async () => {
  const { cookie } = await corpus();
  const otherFeed = await seedFeed();
  await seedArticle(otherFeed.id, { title: 'Quantum secrets', contentText: 'quantum quantum' });

  const res = await search(cookie, 'quantum');
  expect(titles(res)).not.toContain('Quantum secrets');
  expect(res.items.length).toBe(3);
});

test('q composes with unread, starred, feedId and folderId', async () => {
  const { user, feed, cookie, titleMatch, bodyMatch } = await corpus();
  await seedArticleState(user.id, titleMatch.id, { read: true });
  await seedArticleState(user.id, bodyMatch.id, { starred: true });

  const unread = await search(cookie, 'quantum', '&unread=true');
  expect(titles(unread)).not.toContain('Quantum computing breakthrough');

  const starred = await search(cookie, 'quantum', '&starred=true');
  expect(titles(starred)).toEqual(['Gardening weekly']);

  const byFeed = await search(cookie, 'quantum', `&feedId=${feed.id}`);
  expect(byFeed.items.length).toBe(3);

  // A folder the feed is not in yields nothing.
  const emptyFolder = await seedFolder(user.id);
  const byFolder = await search(cookie, 'quantum', `&folderId=${emptyFolder.id}`);
  expect(byFolder.items).toEqual([]);
});

test('sort is ignored while searching (relevance order either way)', async () => {
  const { cookie } = await corpus();
  const newest = await search(cookie, 'quantum', '&sort=newest');
  const oldest = await search(cookie, 'quantum', '&sort=oldest');
  expect(titles(oldest)).toEqual(titles(newest));
});

test('phrase and exclusion syntax behave as websearch_to_tsquery documents', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { title: 'Ordered', contentText: 'the quick brown fox jumps' });
  await seedArticle(feed.id, { title: 'Scrambled', contentText: 'brown then later the quick fox' });
  const cookie = await loginAs(user);

  const phrase = await search(cookie, '"quick brown"');
  expect(titles(phrase)).toEqual(['Ordered']);

  const excluded = await search(cookie, 'fox -jumps');
  expect(titles(excluded)).toEqual(['Scrambled']);
});

test('an all-stopword query returns empty rather than erroring', async () => {
  const { cookie } = await corpus();
  const res = await search(cookie, 'the a of');
  expect(res.items).toEqual([]);
  expect(res.nextCursor).toBeNull();
});

test('search paginates with disjoint ordered pages and stops at the result cap', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  // 550 identical matches: ties are broken by id, exercising the (rank, id) keyset.
  await db.insert(articles).values(
    Array.from({ length: 550 }, (_, i) => ({
      feedId: feed.id,
      guid: `bulk-${i}`,
      title: `Widget ${i}`,
      contentText: 'widget widget widget',
    })),
  );
  const cookie = await loginAs(user);

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await search(
      cookie,
      'widget',
      `&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    seen.push(...page.items.map((i: { id: string }) => i.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 20);

  expect(seen.length).toBe(500); // SEARCH_RESULT_CAP, not all 550
  expect(new Set(seen).size).toBe(500); // disjoint pages, no duplicates
  expect(cursor).toBeNull(); // terminated at the cap
});

test('a mode-mismatched cursor is rejected as 400, not 500', async () => {
  const { cookie } = await corpus();

  // A chronological cursor (from a non-search list) replayed with q.
  const chrono = await app.inject({ method: 'GET', url: '/api/articles?limit=1', headers: { cookie } });
  const chronoCursor = chrono.json().nextCursor as string;
  expect(chronoCursor).toBeTruthy();
  const wrongWay = await app.inject({
    method: 'GET',
    url: `/api/articles?q=quantum&cursor=${encodeURIComponent(chronoCursor)}`,
    headers: { cookie },
  });
  expect(wrongWay.statusCode).toBe(400);

  // A search cursor replayed without q.
  const searchPage = await app.inject({
    method: 'GET',
    url: '/api/articles?q=quantum&limit=1',
    headers: { cookie },
  });
  const searchCursor = searchPage.json().nextCursor as string;
  expect(searchCursor).toBeTruthy();
  const otherWay = await app.inject({
    method: 'GET',
    url: `/api/articles?cursor=${encodeURIComponent(searchCursor)}`,
    headers: { cookie },
  });
  expect(otherWay.statusCode).toBe(400);
});

test('the GIN index is applicable to the search query', async () => {
  const feed = await seedFeed();
  const filler = Array.from({ length: 1000 }, (_, i) => ({
    feedId: feed.id,
    guid: `big-${i}`,
    title: `Filler ${i}`,
    contentText: 'common filler text repeated everywhere',
  }));
  await db.insert(articles).values(filler);
  await db.insert(articles).values({
    feedId: feed.id,
    guid: 'needle',
    title: 'Zebra',
    contentText: 'zebra',
  });
  await db.execute(sql`analyze articles`);

  // Whether the planner *picks* the index is a cost decision that varies with
  // table size, stats and PG version (on a small table a seq scan is genuinely
  // cheaper), so asserting the choice would be brittle. Assert the property we
  // actually care about: the index is usable for this query shape. With seq
  // scans disabled the planner must reach for it. `set local` keeps the setting
  // on the same pooled connection as the EXPLAIN and reverts on commit.
  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    return tx.execute(
      sql`explain select id from articles where search_vector @@ websearch_to_tsquery('english','zebra')`,
    );
  });
  const text = JSON.stringify(plan);
  expect(text).toContain('articles_search_vector_idx');
  expect(text).toMatch(/Bitmap Index Scan|Index Scan/);
});

test('omitting q behaves as the plain chronological list', async () => {
  const { cookie } = await corpus();
  const res = await app.inject({ method: 'GET', url: '/api/articles?limit=100', headers: { cookie } });
  expect(res.json().items.length).toBe(3);
});
