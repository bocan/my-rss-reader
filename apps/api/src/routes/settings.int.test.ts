import { DEFAULT_SETTINGS } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { subscriptions, userSettings } from '../db/schema.js';
import { loginAs, resetDb, seedFeed, seedSubscription, seedUser } from '../../test/helpers.js';

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
