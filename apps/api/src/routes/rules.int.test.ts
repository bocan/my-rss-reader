import { MAX_FILTER_RULES } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { articleStates, filterRules } from '../db/schema.js';
import { loginAs, resetDb, seedArticle, seedFeed, seedSubscription, seedUser } from '../../test/helpers.js';

// SPEC-025: filter rule routes, scoped to their owner.

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
const rule = { field: 'title', phrase: 'sponsored', action: 'markRead' } as const;

test('the routes need a session', async () => {
  expect((await call('GET', '/api/rules')).statusCode).toBe(401);
});

test('create, list, change and delete', async () => {
  const { user, cookie } = await me();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);

  const created = await call('POST', '/api/rules', cookie, { ...rule, phrase: ' sponsored ', feedId: feed.id });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({ ...rule, feedId: feed.id, enabled: true });
  const id = created.json().id;

  const off = await call('PATCH', `/api/rules/${id}`, cookie, { enabled: false, feedId: null, action: 'star' });
  expect(off.json()).toMatchObject({ enabled: false, feedId: null, action: 'star', phrase: 'sponsored' });
  expect((await call('GET', '/api/rules', cookie)).json().items).toHaveLength(1);

  expect((await call('DELETE', `/api/rules/${id}`, cookie)).statusCode).toBe(204);
  expect((await call('GET', '/api/rules', cookie)).json().items).toEqual([]);
});

test('bad input is a 400: unknown field or action, a 1-character phrase, an unfollowed feed', async () => {
  const { cookie } = await me();
  const feed = await seedFeed();
  for (const body of [
    { ...rule, field: 'url' },
    { ...rule, action: 'delete' },
    { ...rule, phrase: 'x' },
    { ...rule, feedId: feed.id },
  ]) {
    expect((await call('POST', '/api/rules', cookie, body)).statusCode).toBe(400);
  }
  expect((await call('POST', '/api/rules', cookie, { ...rule, feedId: feed.id })).json().error).toBe('invalid_scope');
});

test(`a user may have up to ${MAX_FILTER_RULES} rules`, async () => {
  const { user, cookie } = await me();
  await db.insert(filterRules).values(Array.from({ length: MAX_FILTER_RULES }, () => ({ userId: user.id, ...rule })));
  const res = await call('POST', '/api/rules', cookie, rule);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('too_many_rules');
});

test("another user's rule is not found, to change, delete or run", async () => {
  const { cookie } = await me();
  const other = await me();
  const theirs = (await call('POST', '/api/rules', other.cookie, rule)).json();
  expect((await call('GET', '/api/rules', cookie)).json().items).toEqual([]);
  expect((await call('PATCH', `/api/rules/${theirs.id}`, cookie, { enabled: false })).statusCode).toBe(404);
  expect((await call('POST', `/api/rules/${theirs.id}/apply`, cookie)).statusCode).toBe(404);
  expect((await call('DELETE', `/api/rules/${theirs.id}`, cookie)).statusCode).toBe(404);
});

test('"Run on existing articles" says how many matched, and a second run changes nothing', async () => {
  const { user, cookie } = await me();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { title: 'Sponsored: a laptop' });
  await seedArticle(feed.id, { title: 'A real post' });
  const { id } = (await call('POST', '/api/rules', cookie, rule)).json();

  const first = await call('POST', `/api/rules/${id}/apply`, cookie);
  expect(first.json()).toEqual({ matched: 1 });
  expect((await call('POST', `/api/rules/${id}/apply`, cookie)).json()).toEqual({ matched: 1 });
  const states = await db.select().from(articleStates).where(eq(articleStates.userId, user.id));
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({ read: true, starred: false });
});

test('a rule does not run on existing articles until asked, even when re-enabled', async () => {
  const { user, cookie } = await me();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { title: 'Sponsored' });
  const { id } = (await call('POST', '/api/rules', cookie, rule)).json();
  await call('PATCH', `/api/rules/${id}`, cookie, { enabled: false });
  await call('PATCH', `/api/rules/${id}`, cookie, { enabled: true });
  expect(await db.select().from(articleStates)).toEqual([]);
});
