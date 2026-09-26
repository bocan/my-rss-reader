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

// #16: unsubscribe keeps your own starred and shared items, and can be undone.

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

const get = (cookie: string, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie } });
const unsubscribe = (cookie: string, subscriptionId: string) =>
  app.inject({ method: 'DELETE', url: `/api/feeds/${subscriptionId}`, headers: { cookie } });
const restore = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/feeds/restore', headers: { cookie }, payload: body });
const titles = (res: { json: () => { items: { title: string }[] } }) =>
  res.json().items.map((a) => a.title);

async function setup() {
  const user = await seedUser();
  const feed = await seedFeed({ title: 'Feed X' });
  const sub = await seedSubscription(user.id, feed.id);
  const starred = await seedArticle(feed.id, { title: 'starred' });
  const shared = await seedArticle(feed.id, { title: 'shared' });
  await seedArticle(feed.id, { title: 'plain' });
  await seedArticleState(user.id, starred.id, { starred: true, starredAt: new Date() });
  await seedArticleState(user.id, shared.id, { shared: true, sharedAt: new Date() });
  return { user, feed, sub, starred, shared, cookie: await loginAs(user) };
}

test('Starred and Shared keep their items after an unsubscribe', async () => {
  const { sub, cookie } = await setup();
  expect((await unsubscribe(cookie, sub.id)).statusCode).toBe(204);

  expect(titles(await get(cookie, '/articles?starred=true'))).toEqual(['starred']);
  expect(titles(await get(cookie, '/articles?shared=true'))).toEqual(['shared']);
  // Everything else from the feed is gone from the lists.
  expect(titles(await get(cookie, '/articles'))).toEqual([]);
});

test('a starred or shared item still opens after an unsubscribe; others 404', async () => {
  const { sub, cookie, starred, shared, feed } = await setup();
  const plain = await seedArticle(feed.id, { title: 'plain-2' });
  await unsubscribe(cookie, sub.id);

  expect((await get(cookie, `/articles/${starred.id}`)).statusCode).toBe(200);
  expect((await get(cookie, `/articles/${shared.id}`)).statusCode).toBe(200);
  expect((await get(cookie, `/articles/${plain.id}`)).statusCode).toBe(404);
});

test("another user's stars do not open an article for you", async () => {
  const { starred } = await setup();
  const other = await seedUser();
  const cookie = await loginAs(other);

  expect((await get(cookie, `/articles/${starred.id}`)).statusCode).toBe(404);
  expect(titles(await get(cookie, '/articles?starred=true'))).toEqual([]);
});

test('a feed or folder narrowing on Starred still needs a subscription', async () => {
  const { sub, cookie, feed } = await setup();
  await unsubscribe(cookie, sub.id);

  expect(titles(await get(cookie, `/articles?starred=true&feedId=${feed.id}`))).toEqual([]);
});

test('restore brings back the folder, title, place, and settings', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id);
  const a = await seedFeed();
  const b = await seedFeed();
  const c = await seedFeed();
  await seedSubscription(user.id, a.id, { folderId: folder.id, position: 0 });
  const subB = await seedSubscription(user.id, b.id, {
    folderId: folder.id,
    position: 1,
    customTitle: 'My B',
    viewMode: 'cards',
    articleView: 'web',
    hideFromAll: true,
    inBlogroll: false,
    attention: 'precious',
  });
  await seedSubscription(user.id, c.id, { folderId: folder.id, position: 2 });
  const article = await seedArticle(b.id, { title: 'read-before' });
  await seedArticleState(user.id, article.id, { read: true, readAt: new Date() });
  const cookie = await loginAs(user);

  await unsubscribe(cookie, subB.id);
  const res = await restore(cookie, {
    feedId: b.id,
    folderId: folder.id,
    title: 'My B',
    position: 1,
    viewMode: 'cards',
    articleView: 'web',
    hideFromAll: true,
    inBlogroll: false,
    attention: 'precious',
  });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({
    feedId: b.id,
    folderId: folder.id,
    customTitle: 'My B',
    viewMode: 'cards',
    articleView: 'web',
    hideFromAll: true,
    inBlogroll: false,
    attention: 'precious',
    unreadCount: 0, // read state was never lost
  });

  const order = (await get(cookie, '/feeds')).json().items.map((s: { feedId: string }) => s.feedId);
  expect(order).toEqual([a.id, b.id, c.id]);
});

test('restore puts a feed at the root when its folder is gone', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  const cookie = await loginAs(user);

  const res = await restore(cookie, {
    feedId: feed.id,
    folderId: '00000000-0000-4000-8000-000000000000',
    title: null,
    position: 0,
    viewMode: null,
    articleView: null,
    hideFromAll: false,
    inBlogroll: true,
    attention: 'normal',
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().folderId).toBeNull();
});

test('restore refuses a double subscribe and an unknown feed', async () => {
  const { feed, cookie } = await setup();
  const body = {
    feedId: feed.id,
    folderId: null,
    title: null,
    position: 0,
    viewMode: null,
    articleView: null,
    hideFromAll: false,
    inBlogroll: true,
    attention: 'normal',
  };
  expect((await restore(cookie, body)).statusCode).toBe(409);
  expect(
    (await restore(cookie, { ...body, feedId: '00000000-0000-4000-8000-000000000000' })).statusCode,
  ).toBe(404);
});
