import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { articleStates } from '../db/schema.js';
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

const markRead = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/articles/mark-read', headers: { cookie }, payload: body });
const counts = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/counts', headers: { cookie } }).then((r) => r.json());
const feedUnread = (c: { feeds: { feedId: string; unreadCount: number }[] }, id: string) =>
  c.feeds.find((f) => f.feedId === id)?.unreadCount ?? 0;

test('mark-read by feed marks only that feed and drops its count to zero', async () => {
  const user = await seedUser();
  const f1 = await seedFeed();
  const f2 = await seedFeed();
  await seedSubscription(user.id, f1.id);
  await seedSubscription(user.id, f2.id);
  for (let i = 0; i < 3; i++) await seedArticle(f1.id, {});
  for (let i = 0; i < 2; i++) await seedArticle(f2.id, {});
  const cookie = await loginAs(user);

  const before = await counts(cookie);
  expect(before.total).toBe(5);

  const res = await markRead(cookie, { feedId: f1.id });
  expect(res.statusCode).toBe(204);

  const after = await counts(cookie);
  expect(feedUnread(after, f1.id)).toBe(0);
  expect(feedUnread(after, f2.id)).toBe(2); // untouched
  expect(after.total).toBe(2);
});

test('mark-read by folder marks every feed in that folder, feedId beats folderId', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id);
  const fa = await seedFeed();
  const fb = await seedFeed();
  const outside = await seedFeed();
  await seedSubscription(user.id, fa.id, { folderId: folder.id });
  await seedSubscription(user.id, fb.id, { folderId: folder.id });
  await seedSubscription(user.id, outside.id);
  await seedArticle(fa.id, {});
  await seedArticle(fb.id, {});
  await seedArticle(outside.id, {});
  const cookie = await loginAs(user);

  await markRead(cookie, { folderId: folder.id });
  let c = await counts(cookie);
  expect(feedUnread(c, fa.id)).toBe(0);
  expect(feedUnread(c, fb.id)).toBe(0);
  expect(feedUnread(c, outside.id)).toBe(1);
  expect(feedUnread(c, fa.id) + feedUnread(c, fb.id)).toBe(0);

  // feedId wins over folderId when both are sent (marks only that one feed).
  await seedArticle(fa.id, {}); // fa now has 1 unread again
  await markRead(cookie, { feedId: outside.id, folderId: folder.id });
  c = await counts(cookie);
  expect(feedUnread(c, outside.id)).toBe(0); // feedId target marked
  expect(feedUnread(c, fa.id)).toBe(1); // folder ignored because feedId present
});

test('mark-read with no scope marks everything', async () => {
  const user = await seedUser();
  const f1 = await seedFeed();
  const f2 = await seedFeed();
  await seedSubscription(user.id, f1.id);
  await seedSubscription(user.id, f2.id);
  await seedArticle(f1.id, {});
  await seedArticle(f2.id, {});
  const cookie = await loginAs(user);

  await markRead(cookie, {});
  expect((await counts(cookie)).total).toBe(0);
});

test('before cutoff marks only older items, undated via fetchedAt', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  await seedArticle(feed.id, { publishedAt: new Date('2026-01-01') }); // old -> marked
  await seedArticle(feed.id, { publishedAt: new Date('2026-06-01') }); // new -> kept
  await seedArticle(feed.id, { publishedAt: null, fetchedAt: new Date('2026-01-02') }); // undated old -> marked
  const cookie = await loginAs(user);

  await markRead(cookie, { before: '2026-03-01T00:00:00.000Z' });
  expect((await counts(cookie)).total).toBe(1); // only the June article remains unread
});

test('mark-read is idempotent and preserves starred/read_at', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const article = await seedArticle(feed.id, {});
  await seedArticleState(user.id, article.id, { starred: true }); // starred, unread
  const cookie = await loginAs(user);

  await markRead(cookie, { feedId: feed.id });
  const [row1] = await db
    .select()
    .from(articleStates)
    .where(and(eq(articleStates.userId, user.id), eq(articleStates.articleId, article.id)));
  expect(row1!.read).toBe(true);
  expect(row1!.starred).toBe(true); // star preserved through the bulk mark
  const firstReadAt = row1!.readAt;

  await markRead(cookie, { feedId: feed.id }); // re-run
  const [row2] = await db
    .select()
    .from(articleStates)
    .where(and(eq(articleStates.userId, user.id), eq(articleStates.articleId, article.id)));
  expect(row2!.readAt?.getTime()).toBe(firstReadAt?.getTime()); // unchanged, idempotent
});

test('mark-read on an empty scope returns 204 and changes nothing', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id);
  const cookie = await loginAs(user);
  const res = await markRead(cookie, { folderId: folder.id }); // folder has no feeds
  expect(res.statusCode).toBe(204);
  expect((await counts(cookie)).total).toBe(0);
});

test('PATCH state toggles one half without touching the other, idempotently', async () => {
  const user = await seedUser();
  const feed = await seedFeed();
  await seedSubscription(user.id, feed.id);
  const article = await seedArticle(feed.id, {});
  const cookie = await loginAs(user);

  const patch = (body: Record<string, boolean>) =>
    app.inject({ method: 'PATCH', url: `/api/articles/${article.id}/state`, headers: { cookie }, payload: body });

  await patch({ starred: true });
  await patch({ read: true }); // must not clear starred
  const [row] = await db
    .select()
    .from(articleStates)
    .where(and(eq(articleStates.userId, user.id), eq(articleStates.articleId, article.id)));
  expect(row).toMatchObject({ read: true, starred: true });

  await patch({ read: true }); // idempotent, no throw
  expect((await patch({ read: false })).statusCode).toBe(204);
});

test('counts: /feeds and /counts agree and no-state-row counts as unread', async () => {
  const user = await seedUser();
  const folder = await seedFolder(user.id);
  const f1 = await seedFeed();
  const f2 = await seedFeed();
  await seedSubscription(user.id, f1.id, { folderId: folder.id });
  await seedSubscription(user.id, f2.id);
  // f1: 2 unread (no state row) + 1 read = 2 unread. f2: 1 unread.
  await seedArticle(f1.id, {});
  await seedArticle(f1.id, {});
  const read = await seedArticle(f1.id, {});
  await seedArticleState(user.id, read.id, { read: true });
  await seedArticle(f2.id, {});
  const cookie = await loginAs(user);

  const c = await counts(cookie);
  expect(feedUnread(c, f1.id)).toBe(2);
  expect(feedUnread(c, f2.id)).toBe(1);
  expect(c.folders.find((f: { folderId: string }) => f.folderId === folder.id)?.unreadCount).toBe(2);
  expect(c.total).toBe(3);

  const feeds = (await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } })).json().items;
  for (const item of feeds) {
    expect(item.unreadCount).toBe(feedUnread(c, item.feedId)); // the two endpoints agree
  }
});
