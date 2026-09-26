import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

// Control readability extraction and count its calls.
const extractMock = vi.hoisted(() => vi.fn<(url: string) => Promise<string | null>>());
vi.mock('../lib/readability.js', () => ({ extractReadableHtml: extractMock }));

const { buildApp } = await import('../app.js');
const { loginAs, resetDb, seedArticle, seedFeed, seedSubscription, seedUser, seedArticleState } =
  await import('../../test/helpers.js');

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
  extractMock.mockReset();
});

async function subscribedArticle(over: Record<string, unknown> = {}) {
  const user = await seedUser();
  const feed = await seedFeed({ title: 'Feed T' });
  await seedSubscription(user.id, feed.id);
  const article = await seedArticle(feed.id, {
    title: 'Title',
    url: 'https://site.example/post',
    contentHtml: '<p>body</p>',
    ...over,
  });
  return { user, feed, article, cookie: await loginAs(user) };
}

test('detail returns the full shape with feed context and default state', async () => {
  const { article, feed, cookie } = await subscribedArticle();
  const res = await app.inject({ method: 'GET', url: `/api/articles/${article.id}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.id).toBe(article.id);
  expect(body.feed.id).toBe(feed.id);
  expect(body.read).toBe(false);
  expect(body.starred).toBe(false);
});

test('detail reflects an existing state row', async () => {
  const { user, article, cookie } = await subscribedArticle();
  await seedArticleState(user.id, article.id, { read: true, starred: true });
  const res = await app.inject({ method: 'GET', url: `/api/articles/${article.id}`, headers: { cookie } });
  expect(res.json()).toMatchObject({ read: true, starred: true });
});

test('random uuid and non-subscribed article both 404 identically', async () => {
  const { cookie } = await subscribedArticle();
  const random = await app.inject({
    method: 'GET',
    url: '/api/articles/00000000-0000-0000-0000-000000000000',
    headers: { cookie },
  });
  // An article in a feed this user does not follow.
  const otherFeed = await seedFeed();
  const otherArticle = await seedArticle(otherFeed.id, {});
  const foreign = await app.inject({ method: 'GET', url: `/api/articles/${otherArticle.id}`, headers: { cookie } });

  expect(random.statusCode).toBe(404);
  expect(foreign.statusCode).toBe(404);
  expect(random.json()).toEqual(foreign.json());
});

test('malformed id returns 404, not 500', async () => {
  const { cookie } = await subscribedArticle();
  const res = await app.inject({ method: 'GET', url: '/api/articles/not-a-uuid', headers: { cookie } });
  expect(res.statusCode).toBe(404);
});

test('readable extracts once, caches, and refresh re-extracts', async () => {
  const { article, cookie } = await subscribedArticle();
  extractMock.mockResolvedValue('<p>clean</p>');

  const first = await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  expect(first.statusCode).toBe(200);
  expect(first.json().readableHtml).toBe('<p>clean</p>');
  expect(extractMock).toHaveBeenCalledTimes(1);

  await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  expect(extractMock).toHaveBeenCalledTimes(1); // cache hit, no re-extract

  await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable?refresh=true`, headers: { cookie } });
  expect(extractMock).toHaveBeenCalledTimes(2); // refresh forces it
});

test('failed extraction is a 200 with null html and stops retrying', async () => {
  const { article, cookie } = await subscribedArticle();
  extractMock.mockResolvedValue(null);

  const res = await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  expect(res.json().readableHtml).toBeNull();
  expect(res.json().readableFetchedAt).toBeTruthy();

  await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  expect(extractMock).toHaveBeenCalledTimes(1); // failed attempt is cached; no auto-retry
});

test('readable with a null url stamps the attempt (200) without extracting', async () => {
  const { article, cookie } = await subscribedArticle({ url: null });
  const res = await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  // Degrades gracefully: no extraction, but the attempt is stamped and cached so
  // the Simplified view shows the "could not extract" fallback instead of hanging.
  expect(res.statusCode).toBe(200);
  expect(res.json().readableHtml).toBeNull();
  expect(res.json().readableFetchedAt).toBeTruthy();
  expect(extractMock).not.toHaveBeenCalled();

  // Cached: a second call does not re-attempt.
  extractMock.mockClear();
  const again = await app.inject({ method: 'GET', url: `/api/articles/${article.id}/readable`, headers: { cookie } });
  expect(again.statusCode).toBe(200);
  expect(extractMock).not.toHaveBeenCalled();
});

// SPEC-024: a star or a share takes the readable copy at once.
const snapshotOf = async (id: string) => {
  const { db } = await import('../db/index.js');
  const { articles } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  return (await db.select().from(articles).where(eq(articles.id, id)))[0]!;
};
const patchState = (id: string, cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/articles/${id}/state`, headers: { cookie }, payload });

test('a star captures the snapshot once, in the background; a repeat star does not refetch', async () => {
  const { article, cookie } = await subscribedArticle();
  let release: (html: string) => void = () => {};
  extractMock.mockImplementation(() => new Promise((r) => (release = r)));

  // The reply comes while the extraction is still running.
  const res = await patchState(article.id, cookie, { starred: true });
  expect(res.statusCode).toBe(204);
  await vi.waitFor(() => expect(extractMock).toHaveBeenCalledTimes(1));
  expect((await snapshotOf(article.id)).readableFetchedAt).toBeNull();

  release('<p>kept safe</p>');
  await vi.waitFor(async () => expect((await snapshotOf(article.id)).readableHtml).toBe('<p>kept safe</p>'));

  await patchState(article.id, cookie, { starred: false });
  await patchState(article.id, cookie, { starred: true });
  await new Promise((r) => setTimeout(r, 50));
  expect(extractMock).toHaveBeenCalledTimes(1);
});

test('a share captures too; a read or an unstar does not', async () => {
  const { article, cookie } = await subscribedArticle();
  extractMock.mockResolvedValue('<p>shared copy</p>');

  await patchState(article.id, cookie, { read: true });
  await patchState(article.id, cookie, { starred: false });
  await new Promise((r) => setTimeout(r, 50));
  expect(extractMock).not.toHaveBeenCalled();

  await patchState(article.id, cookie, { shared: true });
  await vi.waitFor(async () => expect((await snapshotOf(article.id)).readableHtml).toBe('<p>shared copy</p>'));
});

test('a failed capture on star stamps the attempt, as the view does', async () => {
  const { article, cookie } = await subscribedArticle();
  extractMock.mockResolvedValue(null);
  await patchState(article.id, cookie, { starred: true });
  await vi.waitFor(async () => expect((await snapshotOf(article.id)).readableFetchedAt).not.toBeNull());
  expect((await snapshotOf(article.id)).readableHtml).toBeNull();
});

test('readable ?refresh=true on a dead page keeps the stored copy', async () => {
  const { article, cookie } = await subscribedArticle({
    readableHtml: '<p>taken while alive</p>',
    readableFetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
  extractMock.mockResolvedValue(null);
  const res = await app.inject({
    method: 'GET',
    url: `/api/articles/${article.id}/readable?refresh=true`,
    headers: { cookie },
  });
  expect(res.json().readableHtml).toBe('<p>taken while alive</p>');
  expect(extractMock).toHaveBeenCalledTimes(1);
});

test('readable enforces subscription scope (404, no extract)', async () => {
  const { cookie } = await subscribedArticle();
  const otherFeed = await seedFeed();
  const otherArticle = await seedArticle(otherFeed.id, { url: 'https://x.example/p' });
  const res = await app.inject({ method: 'GET', url: `/api/articles/${otherArticle.id}/readable`, headers: { cookie } });
  expect(res.statusCode).toBe(404);
  expect(extractMock).not.toHaveBeenCalled();
});
