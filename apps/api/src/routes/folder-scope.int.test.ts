import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import {
  loginAs,
  resetDb,
  seedArticle,
  seedFeed,
  seedFolder,
  seedSubscription,
  seedUser,
} from '../../test/helpers.js';

// #25: a folder covers its child folders, for the badge, the list, and
// mark-all-read alike.

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
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie } }).then((r) => r.json());

async function setup() {
  const user = await seedUser();
  const parent = await seedFolder(user.id, { name: 'Tech' });
  const child = await seedFolder(user.id, { name: 'CSS', parentId: parent.id });
  const other = await seedFolder(user.id, { name: 'News' });
  const inParent = await seedFeed();
  const inChild = await seedFeed();
  const inChildHose = await seedFeed();
  const inOther = await seedFeed();
  await seedSubscription(user.id, inParent.id, { folderId: parent.id });
  await seedSubscription(user.id, inChild.id, { folderId: child.id });
  await seedSubscription(user.id, inChildHose.id, { folderId: child.id, attention: 'firehose' });
  await seedSubscription(user.id, inOther.id, { folderId: other.id });
  await seedArticle(inParent.id, { title: 'p1' });
  await seedArticle(inChild.id, { title: 'c1' });
  await seedArticle(inChild.id, { title: 'c2' });
  await seedArticle(inChildHose.id, { title: 'h1' });
  await seedArticle(inOther.id, { title: 'o1' });
  return { parent, child, other, cookie: await loginAs(user) };
}

const folderCount = (c: { folders: { folderId: string; unreadCount: number }[] }, id: string) =>
  c.folders.find((f) => f.folderId === id)?.unreadCount ?? 0;

test("a parent folder's count includes its child folders; firehose never counts", async () => {
  const { parent, child, other, cookie } = await setup();
  const c = await get(cookie, '/counts');
  expect(folderCount(c, parent.id)).toBe(3); // p1 + c1 + c2
  expect(folderCount(c, child.id)).toBe(2);
  expect(folderCount(c, other.id)).toBe(1);
});

test("a parent folder's list shows its child folders' articles", async () => {
  const { parent, child, cookie } = await setup();
  const titles = (r: { items: { title: string }[] }) => r.items.map((a) => a.title).sort();
  expect(titles(await get(cookie, `/articles?folderId=${parent.id}`))).toEqual(['c1', 'c2', 'h1', 'p1']);
  expect(titles(await get(cookie, `/articles?folderId=${child.id}`))).toEqual(['c1', 'c2', 'h1']);
});

test('mark all read on a parent folder also clears its child folders', async () => {
  const { parent, child, other, cookie } = await setup();
  await app.inject({
    method: 'POST',
    url: '/api/articles/mark-read',
    headers: { cookie },
    payload: { folderId: parent.id },
  });
  const c = await get(cookie, '/counts');
  expect(folderCount(c, parent.id)).toBe(0);
  expect(folderCount(c, child.id)).toBe(0);
  expect(folderCount(c, other.id)).toBe(1);
});

test("another user's folder id reaches nothing", async () => {
  const { parent } = await setup();
  const stranger = await loginAs(await seedUser());
  expect((await get(stranger, `/articles?folderId=${parent.id}`)).items).toEqual([]);
});
