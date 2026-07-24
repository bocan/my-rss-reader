import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { folders, subscriptions } from '../db/schema.js';
import {
  loginAs,
  resetDb,
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

const patchFolder = (cookie: string, id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/folders/${id}`, headers: { cookie }, payload: body });
const patchFeed = (cookie: string, id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/feeds/${id}`, headers: { cookie }, payload: body });

/** Positions of a user's folders in one parent scope, in order. */
async function folderScope(userId: string, parentId: string | null) {
  const rows = await db
    .select({ id: folders.id, position: folders.position, parentId: folders.parentId })
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.position));
  return rows.filter((r) => r.parentId === parentId);
}

async function subsInFolder(userId: string, folderId: string | null) {
  const rows = await db
    .select({ id: subscriptions.id, position: subscriptions.position, folderId: subscriptions.folderId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(asc(subscriptions.position));
  return rows.filter((r) => r.folderId === folderId);
}

test('renames a folder', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id, { name: 'Old' });
  const cookie = await loginAs(user);

  const res = await patchFolder(cookie, folder.id, { name: 'New' });
  expect(res.statusCode).toBe(200);
  expect(res.json().name).toBe('New');
});

test('reparents a folder under a root folder', async () => {
  const user = await seedUser();
  const parent = await seedFolder(user.id, { name: 'Parent' });
  const child = await seedFolder(user.id, { name: 'Child' });
  const cookie = await loginAs(user);

  const res = await patchFolder(cookie, child.id, { parentId: parent.id });
  expect(res.statusCode).toBe(200);
  expect(res.json().parentId).toBe(parent.id);
});

test('rejects self-parenting, deep nesting, and nesting a folder that has children', async () => {
  const user = await seedUser();
  const root = await seedFolder(user.id, { name: 'Root' });
  const nested = await seedFolder(user.id, { name: 'Nested', parentId: root.id });
  const hasChild = await seedFolder(user.id, { name: 'HasChild' });
  await seedFolder(user.id, { name: 'ItsChild', parentId: hasChild.id });
  const loose = await seedFolder(user.id, { name: 'Loose' });
  const cookie = await loginAs(user);

  // 1. own parent
  expect((await patchFolder(cookie, root.id, { parentId: root.id })).statusCode).toBe(400);
  // 2. parent is already nested -> would be depth 2
  expect((await patchFolder(cookie, loose.id, { parentId: nested.id })).statusCode).toBe(400);
  // 3. moving a folder that itself has children
  expect((await patchFolder(cookie, hasChild.id, { parentId: root.id })).statusCode).toBe(400);

  const bodies = await Promise.all([
    patchFolder(cookie, root.id, { parentId: root.id }).then((r) => r.json()),
  ]);
  expect(bodies[0].error).toBe('invalid_parent');
});

test('rejects a parent folder belonging to another user and leaves it untouched', async () => {
  const userA = await seedUser();
  const userB = await seedUser();
  const mine = await seedFolder(userA.id, { name: 'Mine' });
  const theirs = await seedFolder(userB.id, { name: 'Theirs' });
  const cookie = await loginAs(userA);

  const res = await patchFolder(cookie, mine.id, { parentId: theirs.id });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('invalid_parent');

  // B's folder is untouched.
  const [after] = await db.select().from(folders).where(eq(folders.id, theirs.id));
  expect(after!.parentId).toBeNull();
  expect(after!.userId).toBe(userB.id);
});

test("patching another user's folder is a 404", async () => {
  const userA = await seedUser();
  const userB = await seedUser();
  const theirs = await seedFolder(userB.id, { name: 'Theirs' });
  const cookie = await loginAs(userA);

  expect((await patchFolder(cookie, theirs.id, { name: 'Hacked' })).statusCode).toBe(404);
  const [after] = await db.select().from(folders).where(eq(folders.id, theirs.id));
  expect(after!.name).toBe('Theirs');
});

test('reordering folders yields gap-free 0..n-1 with the moved row at the index', async () => {
  const user = await seedUser();
  const a = await seedFolder(user.id, { name: 'A', position: 0 });
  const b = await seedFolder(user.id, { name: 'B', position: 1 });
  const c = await seedFolder(user.id, { name: 'C', position: 2 });
  const cookie = await loginAs(user);

  // Move C to the front.
  expect((await patchFolder(cookie, c.id, { position: 0 })).statusCode).toBe(200);

  const scope = await folderScope(user.id, null);
  expect(scope.map((f) => f.id)).toEqual([c.id, a.id, b.id]);
  expect(scope.map((f) => f.position)).toEqual([0, 1, 2]); // gap-free
});

test('deleting a folder promotes its subscriptions and child folders, without deleting them', async () => {
  const user = await seedUser();
  const parent = await seedFolder(user.id, { name: 'Parent' });
  const doomed = await seedFolder(user.id, { name: 'Doomed', parentId: parent.id });
  const child = await seedFolder(user.id, { name: 'Child', parentId: doomed.id });
  const feed = await seedFeed();
  const sub = await seedSubscription(user.id, feed.id, { folderId: doomed.id });
  const cookie = await loginAs(user);

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/folders/${doomed.id}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(204);

  // The folder is gone...
  const gone = await db.select().from(folders).where(eq(folders.id, doomed.id));
  expect(gone).toHaveLength(0);

  // ...but its child folder and subscription survive, promoted to its parent.
  const [survivingChild] = await db.select().from(folders).where(eq(folders.id, child.id));
  expect(survivingChild).toBeTruthy();
  expect(survivingChild!.parentId).toBe(parent.id);

  const [survivingSub] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(survivingSub).toBeTruthy();
  expect(survivingSub!.folderId).toBe(parent.id);

  // Promoted rows have no colliding positions in their new scope.
  const scope = await folderScope(user.id, parent.id);
  expect(new Set(scope.map((f) => f.position)).size).toBe(scope.length);
});

test('deleting a root folder moves its contents to root', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id, { name: 'Top' });
  const feed = await seedFeed();
  const sub = await seedSubscription(user.id, feed.id, { folderId: folder.id });
  const cookie = await loginAs(user);

  await app.inject({ method: 'DELETE', url: `/api/folders/${folder.id}`, headers: { cookie } });

  const [after] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(after!.folderId).toBeNull();
});

test('moves a subscription into a folder, back to root, and renames it', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id, { name: 'Tech' });
  const feed = await seedFeed({ title: 'Feed Title' });
  const sub = await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const moved = await patchFeed(cookie, sub.id, { folderId: folder.id });
  expect(moved.statusCode).toBe(200);
  expect(moved.json().folderId).toBe(folder.id);
  // Response is shaped like a GET /feeds item.
  expect(moved.json()).toMatchObject({
    subscriptionId: sub.id,
    feedId: feed.id,
    title: 'Feed Title',
  });
  expect(moved.json()).toHaveProperty('position');
  expect(moved.json()).toHaveProperty('faviconUrl');
  expect(moved.json()).toHaveProperty('unreadCount');

  const back = await patchFeed(cookie, sub.id, { folderId: null });
  expect(back.json().folderId).toBeNull();

  const renamed = await patchFeed(cookie, sub.id, { title: 'My Name' });
  expect(renamed.json().customTitle).toBe('My Name');

  const cleared = await patchFeed(cookie, sub.id, { title: null });
  expect(cleared.json().customTitle).toBeNull();
});

test('rejects moving a subscription into another user folder', async () => {
  const userA = await seedUser();
  const userB = await seedUser();
  const theirs = await seedFolder(userB.id, { name: 'Theirs' });
  const feed = await seedFeed();
  const sub = await seedSubscription(userA.id, feed.id);
  const cookie = await loginAs(userA);

  const res = await patchFeed(cookie, sub.id, { folderId: theirs.id });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('invalid_folder');

  const [after] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(after!.folderId).toBeNull(); // unchanged
});

test('reordering subscriptions renormalizes both the old and new scope', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id, { name: 'Dest' });
  const f1 = await seedFeed();
  const f2 = await seedFeed();
  const f3 = await seedFeed();
  const s1 = await seedSubscription(user.id, f1.id, { position: 0 });
  const s2 = await seedSubscription(user.id, f2.id, { position: 1 });
  const s3 = await seedSubscription(user.id, f3.id, { position: 2 });
  const cookie = await loginAs(user);

  // Move the middle one into a folder at index 0.
  expect((await patchFeed(cookie, s2.id, { folderId: folder.id, position: 0 })).statusCode).toBe(200);

  const root = await subsInFolder(user.id, null);
  expect(root.map((s) => s.id)).toEqual([s1.id, s3.id]);
  expect(root.map((s) => s.position)).toEqual([0, 1]); // old scope closed its gap

  const dest = await subsInFolder(user.id, folder.id);
  expect(dest.map((s) => s.id)).toEqual([s2.id]);
  expect(dest[0]!.position).toBe(0);
});

test("patching another user's subscription is a 404", async () => {
  const userA = await seedUser();
  const userB = await seedUser();
  const feed = await seedFeed();
  const theirs = await seedSubscription(userB.id, feed.id);
  const cookie = await loginAs(userA);

  expect((await patchFeed(cookie, theirs.id, { title: 'Hacked' })).statusCode).toBe(404);
  const [after] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, theirs.id), eq(subscriptions.userId, userB.id)));
  expect(after!.customTitle).toBeNull();
});

test('GET /feeds includes position and is ordered by it', async () => {
  const user = await seedUser();
  const f1 = await seedFeed();
  const f2 = await seedFeed();
  await seedSubscription(user.id, f1.id, { position: 1 });
  await seedSubscription(user.id, f2.id, { position: 0 });
  const cookie = await loginAs(user);

  const items = (await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } })).json()
    .items;
  expect(items[0]).toHaveProperty('position');
  expect(items.map((i: { position: number }) => i.position)).toEqual([0, 1]);
});
