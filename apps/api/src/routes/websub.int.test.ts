import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { findDueFeeds, findLeasesDueForRenewal } from '../worker/poll.js';
import { resetDb, seedFeed } from '../../test/helpers.js';

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

const SECRET = 'test-secret';
const TOKEN = 'cafedeadbeef';
const TOPIC = 'https://blog.example/feed.xml';

async function seedWebsubFeed(overrides: Record<string, unknown> = {}) {
  return seedFeed({
    feedUrl: TOPIC,
    websubHubUrl: 'https://hub.example/',
    websubTopicUrl: TOPIC,
    websubSecret: SECRET,
    websubCallbackToken: TOKEN,
    websubState: 'pending',
    ...overrides,
  });
}

const feedRow = async (id: string) =>
  (await db.select().from(feeds).where(eq(feeds.id, id)))[0]!;

const verify = (params: Record<string, string>) =>
  app.inject({
    method: 'GET',
    url: `/api/websub/callback/${TOKEN}?${new URLSearchParams(params).toString()}`,
  });

const PUSH_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Pushed</title>
<link>https://blog.example</link>
<item><guid>p1</guid><title>Pushed One</title><link>https://blog.example/1</link></item>
<item><guid>p2</guid><title>Pushed Two</title><link>https://blog.example/2</link></item>
</channel></rss>`;

const push = (body: string, headers: Record<string, string> = {}, token = TOKEN) =>
  app.inject({
    method: 'POST',
    url: `/api/websub/callback/${token}`,
    headers: { 'content-type': 'application/rss+xml', ...headers },
    payload: body,
  });

const signed = (body: string) =>
  `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body, 'utf8')).digest('hex')}`;

describe('subscription verification (GET)', () => {
  test('echoes the challenge and activates the lease on a valid subscribe', async () => {
    const feed = await seedWebsubFeed();
    const res = await verify({
      'hub.mode': 'subscribe',
      'hub.topic': TOPIC,
      'hub.challenge': 'ch4113ng3',
      'hub.lease_seconds': '604800',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ch4113ng3');
    expect(res.headers['content-type']).toContain('text/plain');

    const row = await feedRow(feed.id);
    expect(row.websubState).toBe('active');
    const lease = row.websubLeaseExpiresAt!.getTime() - Date.now();
    expect(lease).toBeGreaterThan(604_000 * 1000);
    expect(lease).toBeLessThan(605_000 * 1000);
  });

  test('rejects a topic mismatch and unknown tokens with 404', async () => {
    const feed = await seedWebsubFeed();
    const bad = await verify({
      'hub.mode': 'subscribe',
      'hub.topic': 'https://evil.example/other',
      'hub.challenge': 'x',
    });
    expect(bad.statusCode).toBe(404);
    expect((await feedRow(feed.id)).websubState).toBe('pending');

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/websub/callback/nope?hub.mode=subscribe&hub.topic=x&hub.challenge=y',
    });
    expect(unknown.statusCode).toBe(404);
  });

  test('a missing challenge is a 400', async () => {
    await seedWebsubFeed();
    const res = await verify({ 'hub.mode': 'subscribe', 'hub.topic': TOPIC });
    expect(res.statusCode).toBe(400);
  });

  test('denied marks the feed denied and clears the lease', async () => {
    const feed = await seedWebsubFeed({ websubLeaseExpiresAt: new Date() });
    const res = await verify({ 'hub.mode': 'denied', 'hub.topic': TOPIC });
    expect(res.statusCode).toBe(200);
    const row = await feedRow(feed.id);
    expect(row.websubState).toBe('denied');
    expect(row.websubLeaseExpiresAt).toBeNull();
  });

  test('unsubscribe verification succeeds only when we want out', async () => {
    await seedWebsubFeed({ websubState: 'inactive' });
    const agree = await verify({ 'hub.mode': 'unsubscribe', 'hub.topic': TOPIC, 'hub.challenge': 'bye' });
    expect(agree.statusCode).toBe(200);
    expect(agree.body).toBe('bye');

    await resetDb();
    await seedWebsubFeed({ websubState: 'active' });
    const refuse = await verify({ 'hub.mode': 'unsubscribe', 'hub.topic': TOPIC, 'hub.challenge': 'bye' });
    expect(refuse.statusCode).toBe(404);
  });
});

describe('content distribution (POST)', () => {
  test('a correctly signed push inserts articles exactly once', async () => {
    const feed = await seedWebsubFeed({ websubState: 'active' });
    const res = await push(PUSH_XML, { 'x-hub-signature': signed(PUSH_XML) });
    expect(res.statusCode).toBe(200);

    const stored = await db.select().from(articles).where(eq(articles.feedId, feed.id));
    expect(stored.map((a) => a.title).sort()).toEqual(['Pushed One', 'Pushed Two']);

    // Redelivery deduplicates on (feedId, guid).
    await push(PUSH_XML, { 'x-hub-signature': signed(PUSH_XML) });
    expect((await db.select().from(articles).where(eq(articles.feedId, feed.id))).length).toBe(2);

    const row = await feedRow(feed.id);
    expect(row.lastFetchedAt).not.toBeNull();
    expect(row.failureCount).toBe(0);
  });

  test('a missing or invalid signature is acknowledged but ignored', async () => {
    const feed = await seedWebsubFeed({ websubState: 'active' });
    const cases: Record<string, string>[] = [{}, { 'x-hub-signature': 'sha256=' + '0'.repeat(64) }];
    for (const headers of cases) {
      const res = await push(PUSH_XML, headers);
      expect(res.statusCode).toBe(200);
    }
    expect((await db.select().from(articles).where(eq(articles.feedId, feed.id))).length).toBe(0);
  });

  test('an unknown token gets 410 Gone', async () => {
    const res = await push(PUSH_XML, { 'x-hub-signature': signed(PUSH_XML) }, 'gone-token');
    expect(res.statusCode).toBe(410);
  });

  test('an unparseable signed body schedules an immediate poll', async () => {
    const feed = await seedWebsubFeed({
      websubState: 'active',
      lastFetchedAt: new Date(),
    });
    const body = 'this is not a feed document';
    const res = await push(body, { 'x-hub-signature': signed(body) });
    expect(res.statusCode).toBe(200);
    expect((await feedRow(feed.id)).lastFetchedAt).toBeNull();
  });
});

describe('worker scheduling', () => {
  test('an active lease floors polling at 6 hours; a lapsed one does not', async () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const normal = await seedFeed({ fetchIntervalSec: 900, lastFetchedAt: thirtyMinAgo });
    const pushed = await seedFeed({
      fetchIntervalSec: 900,
      lastFetchedAt: thirtyMinAgo,
      websubState: 'active',
      websubLeaseExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const lapsed = await seedFeed({
      fetchIntervalSec: 900,
      lastFetchedAt: thirtyMinAgo,
      websubState: 'active',
      websubLeaseExpiresAt: new Date(Date.now() - 1000),
    });

    const due = (await findDueFeeds()).map((f) => f.id);
    expect(due).toContain(normal.id);
    expect(due).toContain(lapsed.id);
    expect(due).not.toContain(pushed.id);
  });

  test('renewal selects active leases expiring within the window', async () => {
    const soon = await seedFeed({
      websubState: 'active',
      websubLeaseExpiresAt: new Date(Date.now() + 6 * 3600 * 1000),
    });
    const comfortable = await seedFeed({
      websubState: 'active',
      websubLeaseExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    const pending = await seedFeed({ websubState: 'pending' });

    const due = (await findLeasesDueForRenewal()).map((f) => f.id);
    expect(due).toContain(soon.id);
    expect(due).not.toContain(comfortable.id);
    expect(due).not.toContain(pending.id);
  });
});
