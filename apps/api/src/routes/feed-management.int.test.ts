import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { appSettings, feeds } from '../db/schema.js';
import { findDueFeeds } from '../worker/poll.js';
import {
  loginAs,
  resetDb,
  seedArticle,
  seedFeed,
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

const patchFeed = (cookie: string, id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/feeds/${id}`, headers: { cookie }, payload: body });
const getFeeds = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });

test('PATCH sets article-view, hide-from-all, and the shared feed interval', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  const sub = await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const res = await patchFeed(cookie, sub.id, {
    articleView: 'web',
    hideFromAll: true,
    fetchIntervalSec: 1800,
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ articleView: 'web', hideFromAll: true, fetchIntervalSec: 1800 });

  // The interval lives on the shared feed row.
  const [row] = await db.select().from(feeds).where(eq(feeds.id, feed.id));
  expect(row!.fetchIntervalSec).toBe(1800);

  const list = (await getFeeds(cookie)).json().items[0];
  expect(list).toMatchObject({ articleView: 'web', hideFromAll: true, fetchIntervalSec: 1800 });
});

test('hidden feeds drop out of All items but stay reachable directly', async () => {
  const user = await seedUser();
  const shown = await seedFeed();
  const hidden = await seedFeed();
  const subShown = await seedSubscription(user.id, shown.id);
  const subHidden = await seedSubscription(user.id, hidden.id);
  await seedArticle(shown.id, { title: 'shown-1' });
  await seedArticle(hidden.id, { title: 'hidden-1' });
  await seedArticle(hidden.id, { title: 'hidden-2' });
  const cookie = await loginAs(user);

  // Before hiding: All items sees all three unread; total is 3.
  const allBefore = await app.inject({ method: 'GET', url: '/api/articles', headers: { cookie } });
  expect(allBefore.json().items).toHaveLength(3);
  expect((await app.inject({ method: 'GET', url: '/api/counts', headers: { cookie } })).json().total).toBe(3);

  await patchFeed(cookie, subHidden.id, { hideFromAll: true });

  // All items now excludes the hidden feed's two articles.
  const allAfter = await app.inject({ method: 'GET', url: '/api/articles', headers: { cookie } });
  const titles = allAfter.json().items.map((a: { title: string }) => a.title);
  expect(titles).toEqual(['shown-1']);

  // The hidden feed is still reachable by its own scope, with its own count.
  const direct = await app.inject({
    method: 'GET',
    url: `/api/articles?feedId=${hidden.id}`,
    headers: { cookie },
  });
  expect(direct.json().items).toHaveLength(2);

  const counts = (await app.inject({ method: 'GET', url: '/api/counts', headers: { cookie } })).json();
  expect(counts.total).toBe(1); // only the shown feed
  expect(counts.feeds.find((f: { feedId: string }) => f.feedId === hidden.id).unreadCount).toBe(2);

  // A subscription with no articles avoids an unused-var lint on subShown.
  expect(subShown.feedId).toBe(shown.id);
});

test('the poller honors coalesce(feed override, app default)', async () => {
  // App default 10 min; a feed with no override, last fetched 20 min ago -> due.
  await db
    .insert(appSettings)
    .values({ id: 1, defaultPollIntervalSec: 600 })
    .onConflictDoUpdate({ target: appSettings.id, set: { defaultPollIntervalSec: 600 } });

  const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
  const inheriting = await seedFeed({ fetchIntervalSec: null, lastFetchedAt: twentyMinAgo });
  // A feed overriding to 60 min, last fetched 20 min ago -> NOT due.
  const overridden = await seedFeed({ fetchIntervalSec: 3600, lastFetchedAt: twentyMinAgo });

  const due = await findDueFeeds();
  const dueIds = due.map((f) => f.id);
  expect(dueIds).toContain(inheriting.id);
  expect(dueIds).not.toContain(overridden.id);
});

test('admin default poll interval round-trips', async () => {
  const cookie = await loginAs(await seedUser({ role: 'admin' }));
  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: { cookie },
    payload: { defaultPollIntervalSec: 1200 },
  });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().defaultPollIntervalSec).toBe(1200);
  const got = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } });
  expect(got.json().defaultPollIntervalSec).toBe(1200);
});
