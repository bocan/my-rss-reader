import { MAX_SAVED_SEARCHES } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { feeds, savedSearches } from '../db/schema.js';
import { loginAs, resetDb, seedFeed, seedFolder, seedSubscription, seedUser } from '../../test/helpers.js';

// SPEC-025: saved searches, scoped to their owner.

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

const call = (method: InjectOptions['method'], url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) });

async function me() {
  const user = await seedUser();
  return { user, cookie: await loginAs(user) };
}
const list = async (cookie: string) => (await call('GET', '/api/searches', cookie)).json().items;

test('the routes need a session', async () => {
  expect((await call('GET', '/api/searches')).statusCode).toBe(401);
  expect((await call('POST', '/api/searches', undefined, { name: 'n', q: 'q' })).statusCode).toBe(401);
});

test('create and list, in order, with the scope kept', async () => {
  const { user, cookie } = await me();
  const folder = await seedFolder(user.id, { name: 'Tech' });
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);

  const a = await call('POST', '/api/searches', cookie, { name: ' Postgres ', q: 'postgres', folderId: folder.id, unread: true });
  expect(a.statusCode).toBe(201);
  expect(a.json()).toMatchObject({ name: 'Postgres', q: 'postgres', folderId: folder.id, feedId: null, starred: false, unread: true, position: 0 });
  const b = await call('POST', '/api/searches', cookie, { name: 'Wasm', q: 'wasm', feedId: feed.id, starred: true });
  expect(b.json()).toMatchObject({ feedId: feed.id, starred: true, unread: null, position: 1 });

  expect((await list(cookie)).map((s: { name: string }) => s.name)).toEqual(['Postgres', 'Wasm']);
});

test('a foreign folder or an unfollowed feed is refused', async () => {
  const { cookie } = await me();
  const other = await seedUser();
  const theirFolder = await seedFolder(other.id);
  const feed = await seedFeed();

  for (const scope of [{ folderId: theirFolder.id }, { feedId: feed.id }]) {
    const res = await call('POST', '/api/searches', cookie, { name: 'n', q: 'q', ...scope });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_scope');
  }
  expect(await list(cookie)).toEqual([]);
});

test(`a user may save up to ${MAX_SAVED_SEARCHES} searches`, async () => {
  const { user, cookie } = await me();
  await db.insert(savedSearches).values(
    Array.from({ length: MAX_SAVED_SEARCHES }, (_, i) => ({ userId: user.id, name: `s${i}`, q: 'q', position: i })),
  );
  const res = await call('POST', '/api/searches', cookie, { name: 'one more', q: 'q' });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('too_many_searches');
});

test('rename, and a move renumbers the list', async () => {
  const { cookie } = await me();
  for (const name of ['a', 'b', 'c']) await call('POST', '/api/searches', cookie, { name, q: name });
  const [a, , c] = await list(cookie);

  const renamed = await call('PATCH', `/api/searches/${a.id}`, cookie, { name: 'Alpha' });
  expect(renamed.json().name).toBe('Alpha');

  await call('PATCH', `/api/searches/${c.id}`, cookie, { position: 0 });
  const after = await list(cookie);
  expect(after.map((s: { name: string }) => s.name)).toEqual(['c', 'Alpha', 'b']);
  expect(after.map((s: { position: number }) => s.position)).toEqual([0, 1, 2]);
});

test("another user's search is not found, to read, change or delete", async () => {
  const { cookie } = await me();
  const other = await me();
  const theirs = (await call('POST', '/api/searches', other.cookie, { name: 'theirs', q: 'q' })).json();

  expect(await list(cookie)).toEqual([]);
  expect((await call('PATCH', `/api/searches/${theirs.id}`, cookie, { name: 'mine now' })).statusCode).toBe(404);
  expect((await call('DELETE', `/api/searches/${theirs.id}`, cookie)).statusCode).toBe(404);
  expect((await call('DELETE', '/api/searches/not-a-uuid', cookie)).statusCode).toBe(404);
  expect(await list(other.cookie)).toHaveLength(1);
});

test('delete removes it', async () => {
  const { cookie } = await me();
  const s = (await call('POST', '/api/searches', cookie, { name: 'n', q: 'q' })).json();
  expect((await call('DELETE', `/api/searches/${s.id}`, cookie)).statusCode).toBe(204);
  expect(await list(cookie)).toEqual([]);
});

test('a deleted feed takes its searches with it; a deleted folder widens them', async () => {
  const { user, cookie } = await me();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const folder = (await call('POST', '/api/folders', cookie, { name: 'Tech' })).json();
  await call('POST', '/api/searches', cookie, { name: 'in feed', q: 'q', feedId: feed.id });
  await call('POST', '/api/searches', cookie, { name: 'in folder', q: 'q', folderId: folder.id });

  await db.delete(feeds).where(eq(feeds.id, feed.id));
  expect((await call('DELETE', `/api/folders/${folder.id}`, cookie)).statusCode).toBe(204);

  const left = await list(cookie);
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ name: 'in folder', folderId: null });
});
