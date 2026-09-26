import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import {
  loginAs,
  resetDb,
  seedArticle,
  seedArticleState,
  seedFeed,
  seedSubscription,
  seedUser,
} from '../../test/helpers.js';

// #30: GET /articles/new-count, for the "N new articles" bar.

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

const newCount = (cookie: string, params: Record<string, string>) =>
  app
    .inject({
      method: 'GET',
      url: `/api/articles/new-count?${new URLSearchParams(params).toString()}`,
      headers: { cookie },
    })
    .then((r) => ({ status: r.statusCode, body: r.json() }));

test('counts only articles fetched after the list loaded, in the same scope', async () => {
  const user = await seedUser();
  const mine = await seedFeed();
  const other = await seedFeed();
  await seedSubscription(user.id, mine.id);
  await seedSubscription(user.id, other.id);
  const cookie = await loginAs(user);

  const loaded = new Date(Date.now() - 60_000);
  await seedArticle(mine.id, { fetchedAt: new Date(loaded.getTime() - 60_000) }); // on the list
  // Fetched after the list loaded. An old publish date does not matter.
  await seedArticle(mine.id, { fetchedAt: new Date(), publishedAt: new Date('2020-01-01') });
  await seedArticle(other.id, { fetchedAt: new Date() });
  const since = loaded.toISOString();

  expect((await newCount(cookie, { since })).body).toEqual({ count: 2 });
  expect((await newCount(cookie, { since, feedId: mine.id })).body).toEqual({ count: 1 });
});

test('respects unread only, and needs a valid since', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);
  const since = new Date(Date.now() - 60_000).toISOString();
  const read = await seedArticle(feed.id, { fetchedAt: new Date() });
  await seedArticleState(user.id, read.id, { read: true });
  await seedArticle(feed.id, { fetchedAt: new Date() });

  expect((await newCount(cookie, { since, unread: 'true' })).body).toEqual({ count: 1 });
  expect((await newCount(cookie, { since: 'yesterday' })).status).toBe(400);
});

test('a user with no subscriptions has nothing new', async () => {
  const cookie = await loginAs(await seedUser());
  const since = new Date().toISOString();
  expect((await newCount(cookie, { since })).body).toEqual({ count: 0 });
});
