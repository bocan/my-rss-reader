import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const getJson = (cookie: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { cookie } }).then((r) => r.json());

/**
 * One user, three tiers: a firehose feed (articles 1d and 20d old, both
 * unread), a normal feed (one 20d unread article, in a folder), and a
 * precious feed (one 1d unread article, hidden from All Items to prove tier
 * scopes still see hidden feeds).
 */
async function seedTiers() {
  const user = await seedUser();
  const cookie = await loginAs(user);

  const firehose = await seedFeed({ title: 'Firehose' });
  await seedSubscription(user.id, firehose.id, { attention: 'firehose' });
  const fhFresh = await seedArticle(firehose.id, { title: 'FH fresh', publishedAt: daysAgo(1) });
  const fhStale = await seedArticle(firehose.id, { title: 'FH stale', publishedAt: daysAgo(20) });

  const folder = await seedFolder(user.id, { name: 'News' });
  const normal = await seedFeed({ title: 'Normal' });
  await seedSubscription(user.id, normal.id, { folderId: folder.id });
  const normalOld = await seedArticle(normal.id, { title: 'N old', publishedAt: daysAgo(20) });

  const precious = await seedFeed({ title: 'Precious' });
  await seedSubscription(user.id, precious.id, { attention: 'precious', hideFromAll: true });
  const preciousFresh = await seedArticle(precious.id, {
    title: 'P fresh',
    publishedAt: daysAgo(1),
  });

  return { user, cookie, firehose, normal, precious, folder, fhFresh, fhStale, normalOld, preciousFresh };
}

describe('attention tiers', () => {
  test('attention round-trips through PATCH and rejects unknown tiers', async () => {
    const user = await seedUser();
    const feed = await seedFeed();
    const sub = await seedSubscription(user.id, feed.id);
    const cookie = await loginAs(user);

    const updated = await app
      .inject({
        method: 'PATCH',
        url: `/api/feeds/${sub.id}`,
        headers: { cookie },
        payload: { attention: 'firehose' },
      })
      .then((r) => r.json());
    expect(updated.attention).toBe('firehose');

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/feeds/${sub.id}`,
      headers: { cookie },
      payload: { attention: 'obsessive' },
    });
    expect(bad.statusCode).toBe(400);
  });

  test('counts: firehose items expire, and firehose never rolls up', async () => {
    const { cookie, firehose, normal, precious, folder } = await seedTiers();
    const counts = await getJson(cookie, '/api/counts');
    const byFeed = new Map(
      counts.feeds.map((f: { feedId: string; unreadCount: number }) => [f.feedId, f.unreadCount]),
    );

    expect(byFeed.get(firehose.id)).toBe(1); // 20d item expired, 1d counted
    expect(byFeed.get(normal.id)).toBe(1); // age is irrelevant off-firehose
    expect(byFeed.get(precious.id)).toBe(1);

    // total: normal (1) + nothing from firehose (tier) or precious (hidden).
    expect(counts.total).toBe(1);
    // The folder holds only the normal feed; firehose feeds would be excluded.
    expect(counts.folders).toEqual([{ folderId: folder.id, unreadCount: 1 }]);
  });

  test('unread lists drop expired firehose items; plain lists show them as read', async () => {
    const { cookie, firehose, fhFresh, fhStale } = await seedTiers();

    const unread = await getJson(cookie, `/api/articles?feedId=${firehose.id}&unread=true`);
    const unreadIds = unread.items.map((a: { id: string }) => a.id);
    expect(unreadIds).toContain(fhFresh.id);
    expect(unreadIds).not.toContain(fhStale.id);

    const plain = await getJson(cookie, `/api/articles?feedId=${firehose.id}`);
    const stale = plain.items.find((a: { id: string }) => a.id === fhStale.id);
    const fresh = plain.items.find((a: { id: string }) => a.id === fhFresh.id);
    expect(stale.read).toBe(true); // presented read, no state row written
    expect(fresh.read).toBe(false);
  });

  test('a 20-day-old article on a normal feed is untouched by the window', async () => {
    const { cookie, normal, normalOld } = await seedTiers();
    const unread = await getJson(cookie, `/api/articles?feedId=${normal.id}&unread=true`);
    expect(unread.items.map((a: { id: string }) => a.id)).toContain(normalOld.id);
  });

  test('the precious scope lists only precious feeds, including hidden ones', async () => {
    const { cookie, preciousFresh } = await seedTiers();
    const res = await getJson(cookie, '/api/articles?attention=precious');
    expect(res.items.map((a: { id: string }) => a.id)).toEqual([preciousFresh.id]);

    // ...while All items excludes the hidden precious feed but keeps firehose
    // articles in the list (tiers shape counts, not the firehose list).
    const all = await getJson(cookie, '/api/articles');
    const titles = all.items.map((a: { title: string }) => a.title);
    expect(titles).toContain('FH fresh');
    expect(titles).toContain('FH stale');
    expect(titles).not.toContain('P fresh');
  });

  test('marking an unexpired firehose item read still decrements its count', async () => {
    const { user, cookie, firehose, fhFresh } = await seedTiers();
    await seedArticleState(user.id, fhFresh.id, { read: true, readAt: new Date() });
    const counts = await getJson(cookie, '/api/counts');
    const fh = counts.feeds.find((f: { feedId: string }) => f.feedId === firehose.id);
    expect(fh.unreadCount).toBe(0);
  });
});
