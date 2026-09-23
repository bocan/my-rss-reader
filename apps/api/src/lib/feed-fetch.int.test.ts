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
const { resetDb, seedFeed } = await import('../../test/helpers.js');

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
});
