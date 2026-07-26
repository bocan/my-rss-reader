import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type * as FeedFetch from '../lib/feed-fetch.js';

// Keep the route off the network: the "fetch that validates the new URL" is a
// controllable no-op here.
const fetchAndStoreFeed = vi.hoisted(() => vi.fn(async (_feed?: { id: string }) => {}));
vi.mock('../lib/feed-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FeedFetch>();
  return { ...actual, fetchAndStoreFeed };
});

const { buildApp } = await import('../app.js');
const { db } = await import('../db/index.js');
const { feeds, subscriptions } = await import('../db/schema.js');
const { loginAs, resetDb, seedFeed, seedSubscription, seedUser } = await import(
  '../../test/helpers.js'
);

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
  fetchAndStoreFeed.mockReset();
  fetchAndStoreFeed.mockImplementation(async () => {});
});

const changeUrl = (cookie: string, subId: string, feedUrl: string) =>
  app.inject({ method: 'PATCH', url: `/api/feeds/${subId}/url`, headers: { cookie }, payload: { feedUrl } });

test('re-points the subscription to a feed at the new URL and drops the orphan', async () => {
  const user = await seedUser();
  const oldFeed = await seedFeed({ feedUrl: 'https://old.example/feed.xml' });
  const sub = await seedSubscription(user.id, oldFeed.id);
  const cookie = await loginAs(user);

  const res = await changeUrl(cookie, sub.id, 'https://new.example/feed.xml');
  expect(res.statusCode).toBe(200);
  expect(res.json().feedUrl).toBe('https://new.example/feed.xml');
  expect(fetchAndStoreFeed).toHaveBeenCalledTimes(1); // validated the new feed

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(row!.feedId).not.toBe(oldFeed.id);
  expect(await db.select().from(feeds).where(eq(feeds.id, oldFeed.id))).toHaveLength(0);
});

test('rejects a new URL that is not a valid feed (422) and cleans up', async () => {
  const user = await seedUser();
  const oldFeed = await seedFeed();
  const sub = await seedSubscription(user.id, oldFeed.id);
  const cookie = await loginAs(user);
  fetchAndStoreFeed.mockImplementationOnce(async (feed) => {
    await db.update(feeds).set({ lastError: 'not xml' }).where(eq(feeds.id, feed!.id));
  });

  const res = await changeUrl(cookie, sub.id, 'https://bad.example/parking.html');
  expect(res.statusCode).toBe(422);

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(row!.feedId).toBe(oldFeed.id); // unchanged
  expect(
    await db.select().from(feeds).where(eq(feeds.feedUrl, 'https://bad.example/parking.html')),
  ).toHaveLength(0);
});

test('rejects re-pointing to a feed the user already subscribes to (409)', async () => {
  const user = await seedUser();
  const feedA = await seedFeed({ feedUrl: 'https://a.example/feed.xml' });
  const feedB = await seedFeed({ feedUrl: 'https://b.example/feed.xml' });
  const subA = await seedSubscription(user.id, feedA.id);
  await seedSubscription(user.id, feedB.id);
  const cookie = await loginAs(user);

  expect((await changeUrl(cookie, subA.id, 'https://b.example/feed.xml')).statusCode).toBe(409);
});

test('a no-op change to the same URL returns 200 without fetching', async () => {
  const user = await seedUser();
  const feed = await seedFeed({ feedUrl: 'https://same.example/feed.xml' });
  const sub = await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const res = await changeUrl(cookie, sub.id, 'https://same.example/feed.xml');
  expect(res.statusCode).toBe(200);
  expect(fetchAndStoreFeed).not.toHaveBeenCalled();
});
