import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
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

/** Seed a user subscribed to one feed with `n` dated articles (newest first). */
async function userWithArticles(n: number) {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    // Descending published dates so "newest" order is deterministic.
    const a = await seedArticle(feed.id, {
      title: `Article ${i}`,
      publishedAt: new Date(Date.UTC(2026, 0, 100 - i)),
    });
    ids.push(a.id);
  }
  return { user, feed, cookie: await loginAs(user), ids };
}

const list = (app: FastifyInstance, cookie: string, query = '') =>
  app.inject({ method: 'GET', url: `/api/articles${query}`, headers: { cookie } }).then((r) => r.json());

test('keyset walk concatenates to the single-page result with no dupes or gaps', async () => {
  const { cookie } = await userWithArticles(5);

  const single = (await list(app, cookie, '?limit=100')).items.map((a: { id: string }) => a.id);
  expect(single).toHaveLength(5);

  const walked: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await list(app, cookie, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    walked.push(...page.items.map((a: { id: string }) => a.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 20);

  expect(walked).toEqual(single); // same order, no dupes, no gaps
  expect(new Set(walked).size).toBe(walked.length);
  expect(cursor).toBeNull(); // no trailing empty page
});

test('oldest sort is the reverse of newest', async () => {
  const { cookie } = await userWithArticles(4);
  const newest = (await list(app, cookie, '?sort=newest&limit=100')).items.map((a: { id: string }) => a.id);
  const oldest = (await list(app, cookie, '?sort=oldest&limit=100')).items.map((a: { id: string }) => a.id);
  expect(oldest).toEqual([...newest].reverse());
});

test('a null-publishedAt article appears exactly once', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { title: 'dated', publishedAt: new Date('2026-01-01') });
  const undated = await seedArticle(feed.id, { title: 'undated', publishedAt: null });
  const cookie = await loginAs(user);

  const ids = (await list(app, cookie, '?limit=100')).items.map((a: { id: string }) => a.id);
  expect(ids.filter((id: string) => id === undated.id)).toHaveLength(1);
});

test('unread and starred filters work', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const a1 = await seedArticle(feed.id, { publishedAt: new Date('2026-01-03') });
  const a2 = await seedArticle(feed.id, { publishedAt: new Date('2026-01-02') });
  await seedArticle(feed.id, { publishedAt: new Date('2026-01-01') });
  await seedArticleState(user.id, a1.id, { read: true });
  await seedArticleState(user.id, a2.id, { starred: true });
  const cookie = await loginAs(user);

  const unread = (await list(app, cookie, '?unread=true&limit=100')).items;
  expect(unread.every((a: { read: boolean }) => !a.read)).toBe(true);
  expect(unread).toHaveLength(2); // a1 is read

  const starred = (await list(app, cookie, '?starred=true&limit=100')).items;
  expect(starred).toHaveLength(1);
  expect(starred[0].id).toBe(a2.id);
});

test('folderId filters to that folder feeds only', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id);
  const feedIn = await seedFeed();
  const feedOut = await seedFeed();
  await seedSubscription(user.id, feedIn.id, { folderId: folder.id });
  await seedSubscription(user.id, feedOut.id);
  await seedArticle(feedIn.id, { title: 'in' });
  await seedArticle(feedOut.id, { title: 'out' });
  const cookie = await loginAs(user);

  const items = (await list(app, cookie, `?folderId=${folder.id}&limit=100`)).items;
  expect(items).toHaveLength(1);
  expect(items[0].feedId).toBe(feedIn.id);
});

test('a user never sees another user feed articles', async () => {
  const { cookie } = await userWithArticles(3);
  // A second user with their own feed + articles.
  const other = await seedUser();
  const otherFeed = await seedFeed();
  await seedSubscription(other.id, otherFeed.id);
  const leak = await seedArticle(otherFeed.id, { title: 'secret' });

  const ids = (await list(app, cookie, '?limit=100')).items.map((a: { id: string }) => a.id);
  expect(ids).toHaveLength(3);
  expect(ids).not.toContain(leak.id);
});

test('a malformed cursor returns 400', async () => {
  const { cookie } = await userWithArticles(2);
  const res = await app.inject({
    method: 'GET',
    url: '/api/articles?cursor=not-a-real-cursor',
    headers: { cookie },
  });
  expect(res.statusCode).toBe(400);
});
