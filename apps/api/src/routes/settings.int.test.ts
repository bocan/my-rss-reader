import { DEFAULT_SETTINGS } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { folders, subscriptions, userSettings } from '../db/schema.js';
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

const getSettings = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
const putSettings = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: body });

test('GET returns defaults when no row exists (never 404)', async () => {
  const cookie = await loginAs(await seedUser());
  const res = await getSettings(cookie);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual(DEFAULT_SETTINGS);
});

test('PUT lazily creates the row, then upserts on the next call', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);

  const first = await putSettings(cookie, { theme: 'midnight' });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({ ...DEFAULT_SETTINGS, theme: 'midnight' });

  const [row1] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));
  expect(row1).toBeTruthy();
  const firstUpdatedAt = row1!.updatedAt.getTime();

  await new Promise((r) => setTimeout(r, 5));
  const second = await putSettings(cookie, { defaultViewMode: 'magazine' });
  // Partial update leaves the earlier field intact.
  expect(second.json()).toMatchObject({ theme: 'midnight', defaultViewMode: 'magazine' });

  const [row2] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));
  expect(row2!.updatedAt.getTime()).toBeGreaterThan(firstUpdatedAt); // bumped
});

test('markReadOnOpen defaults on and persists when turned off (#24)', async () => {
  const cookie = await loginAs(await seedUser());
  expect((await getSettings(cookie)).json().markReadOnOpen).toBe(true);

  expect((await putSettings(cookie, { markReadOnOpen: false })).json().markReadOnOpen).toBe(false);
  expect((await getSettings(cookie)).json().markReadOnOpen).toBe(false);
  expect((await putSettings(cookie, { markReadOnOpen: 'no' })).statusCode).toBe(400);
});

test('reading size and width default to medium and normal, and persist (#41)', async () => {
  const cookie = await loginAs(await seedUser());
  expect((await getSettings(cookie)).json()).toMatchObject({
    readingSize: 'medium',
    readingWidth: 'normal',
  });

  await putSettings(cookie, { readingSize: 'large', readingWidth: 'narrow' });
  expect((await getSettings(cookie)).json()).toMatchObject({
    readingSize: 'large',
    readingWidth: 'narrow',
  });
  expect((await putSettings(cookie, { readingSize: 'huge' })).statusCode).toBe(400);
  expect((await putSettings(cookie, { readingWidth: 'full' })).statusCode).toBe(400);
});

test('an empty PUT body is a no-op that still returns the settings', async () => {
  const cookie = await loginAs(await seedUser());
  await putSettings(cookie, { theme: 'daylight' });
  const res = await putSettings(cookie, {});
  expect(res.statusCode).toBe(200);
  expect(res.json().theme).toBe('daylight');
});

test('invalid values are rejected with 400', async () => {
  const cookie = await loginAs(await seedUser());
  expect((await putSettings(cookie, { theme: 'sepia' })).statusCode).toBe(400);
  expect((await putSettings(cookie, { defaultViewMode: 'grid' })).statusCode).toBe(400);
  expect((await putSettings(cookie, { markReadOnScroll: 'yes' })).statusCode).toBe(400);
});

test("a user cannot read or write another user's settings", async () => {
  const a = await seedUser();
  const b = await seedUser();
  await putSettings(await loginAs(a), { theme: 'midnight' });
  await putSettings(await loginAs(b), { theme: 'daylight' });

  // Each sees only their own, scoped by session; there is no id in the path.
  expect((await getSettings(await loginAs(a))).json().theme).toBe('midnight');
  expect((await getSettings(await loginAs(b))).json().theme).toBe('daylight');

  const rows = await db.select().from(userSettings);
  expect(rows).toHaveLength(2);
});

test('PATCH /feeds/:id sets and clears the per-feed view override', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  const sub = await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const set = await app.inject({
    method: 'PATCH',
    url: `/api/feeds/${sub.id}`,
    headers: { cookie },
    payload: { viewMode: 'magazine' },
  });
  expect(set.statusCode).toBe(200);
  expect(set.json().viewMode).toBe('magazine');

  const cleared = await app.inject({
    method: 'PATCH',
    url: `/api/feeds/${sub.id}`,
    headers: { cookie },
    payload: { viewMode: null },
  });
  expect(cleared.json().viewMode).toBeNull(); // reverts to inheriting the default

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
  expect(row!.viewMode).toBeNull();
});

test('sort order: a user default, and a saved order per feed and per folder (#31)', async () => {
  const user = await seedUser();
  const sub = await seedSubscription(user.id, (await seedFeed()).id);
  const folder = await seedFolder(user.id);
  const cookie = await loginAs(user);
  const patch = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url, headers: { cookie }, payload });

  expect((await getSettings(cookie)).json().defaultSortOrder).toBe('newest');
  expect((await putSettings(cookie, { defaultSortOrder: 'oldest' })).json().defaultSortOrder).toBe('oldest');
  expect((await putSettings(cookie, { defaultSortOrder: 'random' })).statusCode).toBe(400);

  expect((await patch(`/api/feeds/${sub.id}`, { sortOrder: 'oldest' })).json().sortOrder).toBe('oldest');
  expect((await patch(`/api/feeds/${sub.id}`, { sortOrder: null })).json().sortOrder).toBeNull();
  expect((await patch(`/api/folders/${folder.id}`, { sortOrder: 'oldest' })).json().sortOrder).toBe('oldest');
  expect((await patch(`/api/folders/${folder.id}`, { sortOrder: 'sideways' })).statusCode).toBe(400);
});

test('PATCH /feeds rejects an out-of-enum viewMode', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  const sub = await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/feeds/${sub.id}`,
    headers: { cookie },
    payload: { viewMode: 'grid' },
  });
  expect(res.statusCode).toBe(400);
});

test('POST /settings/reset-views clears the caller\'s feed and folder views only', async () => {
  const me = await seedUser();
  const other = await seedUser();
  const feed = await seedFeed();
  const mySub = await seedSubscription(me.id, feed.id, { viewMode: 'list' });
  const otherSub = await seedSubscription(other.id, feed.id, { viewMode: 'list' });
  const myFolder = await seedFolder(me.id, { viewMode: 'magazine' });
  const otherFolder = await seedFolder(other.id, { viewMode: 'magazine' });
  const cookie = await loginAs(me);

  const res = await app.inject({ method: 'POST', url: '/api/settings/reset-views', headers: { cookie } });
  expect(res.statusCode).toBe(204);

  const view = async (table: typeof subscriptions | typeof folders, id: string) =>
    (await db.select({ v: table.viewMode }).from(table).where(eq(table.id, id)))[0]!.v;
  expect(await view(subscriptions, mySub.id)).toBeNull();
  expect(await view(folders, myFolder.id)).toBeNull();
  expect(await view(subscriptions, otherSub.id)).toBe('list');
  expect(await view(folders, otherFolder.id)).toBe('magazine');
});
