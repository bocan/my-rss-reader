import { eq } from 'drizzle-orm';
import { beforeEach, expect, test, vi } from 'vitest';

// Keep fetches off the network: each test sets the status the feed URL returns.
const responses = vi.hoisted(() => new Map<string, { statusCode: number; body?: string }>());
vi.mock('undici', () => ({
  request: vi.fn(async (url: string) => {
    const r = responses.get(url);
    if (!r) throw new Error('getaddrinfo EAI_AGAIN example');
    return { statusCode: r.statusCode, headers: {}, body: { text: async () => r.body ?? '' } };
  }),
  // Stubs so the module-level composed dispatcher constructs without a network.
  Agent: class {
    compose() {
      return this;
    }
  },
  interceptors: { redirect: () => ({}) },
}));

const { fetchAndStoreFeed } = await import('./feed-fetch.js');
const { db } = await import('../db/index.js');
const { feeds } = await import('../db/schema.js');
const { loginAs, resetDb, seedFeed, seedSubscription, seedUser } = await import('../../test/helpers.js');
const { buildApp } = await import('../app.js');

beforeEach(async () => {
  await resetDb();
  responses.clear();
});

const reload = async (id: string) => (await db.select().from(feeds).where(eq(feeds.id, id)))[0]!;

test('records a fetch failure on the feed row', async () => {
  const feed = await seedFeed({ faviconUrl: 'https://x.example/favicon.ico' });

  await fetchAndStoreFeed(feed);

  const row = await reload(feed.id);
  expect(row.lastError).toContain('EAI_AGAIN');
  expect(row.failureCount).toBe(1);
});

test('a 304 after a transient failure clears the stale error', async () => {
  const feed = await seedFeed({
    etag: '"abc"',
    lastError: 'getaddrinfo EAI_AGAIN example',
    failureCount: 3,
  });
  responses.set(feed.feedUrl, { statusCode: 304 });

  await fetchAndStoreFeed(feed);

  const row = await reload(feed.id);
  expect(row.lastError).toBeNull();
  expect(row.failureCount).toBe(0);
  expect(row.lastFetchedAt).not.toBeNull();
  expect(row.lastSuccessAt).not.toBeNull();
  expect(row.retryAt).toBeNull();
});

// #29: transient failures retry within minutes.

const minutesUntil = (d: Date | null) => d && Math.round((d.getTime() - Date.now()) / 60_000);

test('a transient failure schedules a retry in 2 minutes, then 10, then none', async () => {
  const feed = await seedFeed();

  await fetchAndStoreFeed(feed); // DNS failure, the first in a row
  expect(minutesUntil((await reload(feed.id)).retryAt)).toBe(2);

  await fetchAndStoreFeed(await reload(feed.id));
  expect(minutesUntil((await reload(feed.id)).retryAt)).toBe(10);

  await fetchAndStoreFeed(await reload(feed.id));
  const row = await reload(feed.id);
  expect(row.retryAt).toBeNull(); // back to the normal interval
  expect(row.failureCount).toBe(3);
  expect(row.lastSuccessAt).toBeNull();
});

test('POST /feeds/:id/refresh fetches that one feed and returns its new state', async () => {
  const app = await buildApp();
  try {
    const user = await seedUser();
    const feed = await seedFeed({ lastError: 'getaddrinfo EAI_AGAIN example', failureCount: 2 });
    const sub = await seedSubscription(user.id, feed.id);
    const cookie = await loginAs(user);
    responses.set(feed.feedUrl, { statusCode: 304 });

    const res = await app.inject({ method: 'POST', url: `/api/feeds/${sub.id}/refresh`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subscriptionId: sub.id, lastError: null });
    expect(res.json().lastSuccessAt).not.toBeNull();

    // Another user's subscription is not found.
    const other = await loginAs(await seedUser());
    const denied = await app.inject({ method: 'POST', url: `/api/feeds/${sub.id}/refresh`, headers: { cookie: other } });
    expect(denied.statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

test('a lasting failure (404) gets no early retry', async () => {
  const feed = await seedFeed();
  responses.set(feed.feedUrl, { statusCode: 404 });

  await fetchAndStoreFeed(feed);

  const row = await reload(feed.id);
  expect(row.lastError).toBe('HTTP 404');
  expect(row.retryAt).toBeNull();
});
