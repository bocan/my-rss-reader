import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { articleStates } from '../db/schema.js';
import {
  loginAs,
  resetDb,
  seedArticle,
  seedArticleState,
  seedFeed,
  seedProfile,
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

const patchState = (cookie: string, articleId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/api/articles/${articleId}/state`,
    headers: { cookie },
    payload: body,
  });

const stateRow = async (userId: string, articleId: string) =>
  (
    await db
      .select()
      .from(articleStates)
      .where(and(eq(articleStates.userId, userId), eq(articleStates.articleId, articleId)))
  )[0];

/** A user subscribed to one feed with one article; returns everything. */
async function seedReader() {
  const user = await seedUser();
  const feed = await seedFeed({ title: 'The Blog', siteUrl: 'https://blog.example' });
  await seedSubscription(user.id, feed.id);
  const article = await seedArticle(feed.id, {
    title: 'Hello World',
    url: 'https://blog.example/hello',
  });
  const cookie = await loginAs(user);
  return { user, feed, article, cookie };
}

describe('shared article state', () => {
  test('sharing stamps sharedAt; unsharing clears it and the note', async () => {
    const { user, article, cookie } = await seedReader();

    expect((await patchState(cookie, article.id, { shared: true, shareNote: 'gold' })).statusCode).toBe(204);
    let row = await stateRow(user.id, article.id);
    expect(row!.shared).toBe(true);
    expect(row!.sharedAt).not.toBeNull();
    expect(row!.shareNote).toBe('gold');

    expect((await patchState(cookie, article.id, { shared: false })).statusCode).toBe(204);
    row = await stateRow(user.id, article.id);
    expect(row!.shared).toBe(false);
    expect(row!.sharedAt).toBeNull();
    expect(row!.shareNote).toBeNull();
  });

  test('a note-only PATCH leaves read/starred/shared untouched', async () => {
    const { user, article, cookie } = await seedReader();
    await patchState(cookie, article.id, { read: true, starred: true, shared: true });
    await patchState(cookie, article.id, { shareNote: 'updated note' });
    const row = await stateRow(user.id, article.id);
    expect(row).toMatchObject({ read: true, starred: true, shared: true, shareNote: 'updated note' });
  });

  test('shared state and note ride the article detail', async () => {
    const { article, cookie } = await seedReader();
    await patchState(cookie, article.id, { shared: true, shareNote: 'note here' });
    const detail = await app
      .inject({ method: 'GET', url: `/api/articles/${article.id}`, headers: { cookie } })
      .then((r) => r.json());
    expect(detail).toMatchObject({ shared: true, shareNote: 'note here' });
  });

  test('GET /api/articles?shared=true lists only shared items', async () => {
    const { user, feed, article, cookie } = await seedReader();
    const other = await seedArticle(feed.id, { title: 'Not shared' });
    await seedArticleState(user.id, article.id, { shared: true, sharedAt: new Date() });

    const list = await app
      .inject({ method: 'GET', url: '/api/articles?shared=true', headers: { cookie } })
      .then((r) => r.json());
    expect(list.items.map((a: { id: string }) => a.id)).toEqual([article.id]);
    expect(list.items.map((a: { id: string }) => a.id)).not.toContain(other.id);
  });
});

describe('profile', () => {
  test('GET suggests a slug from the username before any row exists', async () => {
    const user = await seedUser({ username: 'Chris_F42' });
    const cookie = await loginAs(user);
    const profile = await app
      .inject({ method: 'GET', url: '/api/profile', headers: { cookie } })
      .then((r) => r.json());
    expect(profile).toMatchObject({ slug: 'chris-f42', visibility: 'off', shareUrl: null });
  });

  test('PUT creates then updates; public visibility yields a shareUrl', async () => {
    const user = await seedUser();
    const cookie = await loginAs(user);

    const created = await app
      .inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { cookie },
        payload: { slug: 'chris', visibility: 'instance', bio: 'hi' },
      })
      .then((r) => r.json());
    expect(created).toMatchObject({ slug: 'chris', visibility: 'instance', bio: 'hi', shareUrl: null });

    const updated = await app
      .inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { cookie },
        payload: { visibility: 'public' },
      })
      .then((r) => r.json());
    expect(updated.visibility).toBe('public');
    expect(updated.shareUrl).toMatch(/\/u\/chris$/);
    expect(updated.bio).toBe('hi'); // untouched fields survive
  });

  test('a taken slug is a 409 slug_taken', async () => {
    const a = await seedUser();
    await seedProfile(a.id, { slug: 'taken' });
    const b = await seedUser();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie: await loginAs(b) },
      payload: { slug: 'taken' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('slug_taken');
  });

  test('an invalid slug is a 400', async () => {
    const user = await seedUser();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie: await loginAs(user) },
      payload: { slug: 'Not Valid!' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('profile routes require auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/shares/community' })).statusCode).toBe(401);
  });
});

/** A user with a public profile and one hostile-string shared article. */
async function seedPublicSharer(visibility = 'public') {
  const user = await seedUser({ displayName: 'Sharer' });
  await seedProfile(user.id, { slug: 'sharer', visibility, title: 'Good Links' });
  const feed = await seedFeed({ title: 'Feed & Co', siteUrl: 'https://site.example' });
  await seedSubscription(user.id, feed.id);
  const article = await seedArticle(feed.id, {
    title: '<script>alert(1)</script> post',
    url: 'https://site.example/p?a=1&b=2',
  });
  await seedArticleState(user.id, article.id, {
    shared: true,
    sharedAt: new Date('2026-07-30T10:00:00Z'),
    shareNote: 'A "note" with <angles> & lines',
  });
  return { user, feed, article };
}

describe('public share pages', () => {
  test('404 for unknown slugs and non-public visibilities', async () => {
    await seedPublicSharer('off');
    const offPage = await app.inject({ method: 'GET', url: '/u/sharer' });
    expect(offPage.statusCode).toBe(404);

    const user = await seedUser();
    await seedProfile(user.id, { slug: 'instance-only', visibility: 'instance' });
    for (const url of ['/u/instance-only', '/u/instance-only/feed.xml', '/u/instance-only/feed.json', '/u/nobody']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  test('a disabled user\'s public page vanishes', async () => {
    const { user } = await seedPublicSharer();
    await db.execute(sql`update users set disabled_at = now() where id = ${user.id}::uuid`);
    expect((await app.inject({ method: 'GET', url: '/u/sharer' })).statusCode).toBe(404);
  });

  test('the HTML page renders escaped content with microformats and caching', async () => {
    await seedPublicSharer();
    const res = await app.inject({ method: 'GET', url: '/u/sharer' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('public, max-age=300');

    const html = res.body;
    expect(html).toContain('Good Links'); // profile title wins
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; post');
    expect(html).toContain('A &quot;note&quot; with &lt;angles&gt; &amp; lines');
    expect(html).toContain('class="h-feed"');
    expect(html).toContain('class="h-entry"');
    expect(html).toContain('rel="alternate" type="application/atom+xml"');
    expect(html).toContain('rel="alternate" type="application/feed+json"');
  });

  test('the Atom and JSON feeds serve the same items', async () => {
    const { article } = await seedPublicSharer();

    const atom = await app.inject({ method: 'GET', url: '/u/sharer/feed.xml' });
    expect(atom.statusCode).toBe(200);
    expect(atom.headers['content-type']).toContain('application/atom+xml');
    expect(atom.body).toContain(`urn:reader:share:`);
    expect(atom.body).not.toContain('<script>');

    const json = await app.inject({ method: 'GET', url: '/u/sharer/feed.json' });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toContain('application/feed+json');
    const parsed = JSON.parse(json.body);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].id).toBe(article.id);
    expect(parsed.items[0].content_text).toBe('A "note" with <angles> & lines');
  });

  test('the page caps at the 100 newest shared items', async () => {
    const user = await seedUser();
    await seedProfile(user.id, { slug: 'prolific', visibility: 'public' });
    const feed = await seedFeed();
    await seedSubscription(user.id, feed.id);
    for (let i = 0; i < 105; i++) {
      const a = await seedArticle(feed.id, { title: `Post ${i}` });
      await seedArticleState(user.id, a.id, {
        shared: true,
        sharedAt: new Date(Date.now() - i * 60_000),
      });
    }
    const parsed = JSON.parse(
      (await app.inject({ method: 'GET', url: '/u/prolific/feed.json' })).body,
    );
    expect(parsed.items).toHaveLength(100);
    expect(parsed.items[0].title).toBe('Post 0'); // newest first
  });
});

describe('community', () => {
  test('excludes the caller, off profiles, and disabled users; flags subscriptions', async () => {
    const caller = await seedUser();
    const cookie = await loginAs(caller);

    // Visible sharer whose feed the caller also follows.
    const alice = await seedUser({ displayName: 'Alice' });
    await seedProfile(alice.id, { slug: 'alice', visibility: 'instance' });
    const sharedFeed = await seedFeed({ title: 'Shared Feed' });
    await seedSubscription(alice.id, sharedFeed.id);
    await seedSubscription(caller.id, sharedFeed.id);
    const a1 = await seedArticle(sharedFeed.id, { title: 'From Alice' });
    await seedArticleState(alice.id, a1.id, { shared: true, sharedAt: new Date(), shareNote: 'read this' });

    // Visible sharer on a feed the caller does not follow.
    const bob = await seedUser({ displayName: 'Bob' });
    await seedProfile(bob.id, { slug: 'bob', visibility: 'public' });
    const bobFeed = await seedFeed({ title: 'Bob Feed' });
    await seedSubscription(bob.id, bobFeed.id);
    const b1 = await seedArticle(bobFeed.id, { title: 'From Bob' });
    await seedArticleState(bob.id, b1.id, { shared: true, sharedAt: new Date(Date.now() - 1000) });

    // Should NOT appear: the caller's own share, an off profile, a disabled user.
    const own = await seedArticle(sharedFeed.id, { title: 'Own share' });
    await seedArticleState(caller.id, own.id, { shared: true, sharedAt: new Date() });
    const carol = await seedUser();
    await seedProfile(carol.id, { slug: 'carol', visibility: 'off' });
    const c1 = await seedArticle(sharedFeed.id, { title: 'From Carol' });
    await seedArticleState(carol.id, c1.id, { shared: true, sharedAt: new Date() });
    const dave = await seedUser({ disabledAt: new Date() });
    await seedProfile(dave.id, { slug: 'dave', visibility: 'public' });
    const d1 = await seedArticle(sharedFeed.id, { title: 'From Dave' });
    await seedArticleState(dave.id, d1.id, { shared: true, sharedAt: new Date() });

    const res = await app
      .inject({ method: 'GET', url: '/api/shares/community', headers: { cookie } })
      .then((r) => r.json());

    const titles = res.items.map((i: { article: { title: string } }) => i.article.title);
    expect(titles).toContain('From Alice');
    expect(titles).toContain('From Bob');
    expect(titles).not.toContain('Own share');
    expect(titles).not.toContain('From Carol');
    expect(titles).not.toContain('From Dave');

    const alicesShare = res.items.find(
      (i: { user: { slug: string } }) => i.user.slug === 'alice',
    );
    expect(alicesShare).toMatchObject({ note: 'read this', subscribed: true });
    const bobsShare = res.items.find((i: { user: { slug: string } }) => i.user.slug === 'bob');
    expect(bobsShare.subscribed).toBe(false);
  });

  test('paginates by cursor, newest first, without duplicates', async () => {
    const caller = await seedUser();
    const cookie = await loginAs(caller);
    const sharer = await seedUser();
    await seedProfile(sharer.id, { slug: 'many', visibility: 'instance' });
    const feed = await seedFeed();
    await seedSubscription(sharer.id, feed.id);
    for (let i = 0; i < 5; i++) {
      const a = await seedArticle(feed.id, { title: `Item ${i}` });
      await seedArticleState(sharer.id, a.id, {
        shared: true,
        sharedAt: new Date(Date.now() - i * 60_000),
      });
    }

    const page1 = await app
      .inject({ method: 'GET', url: '/api/shares/community?limit=2', headers: { cookie } })
      .then((r) => r.json());
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await app
      .inject({
        method: 'GET',
        url: `/api/shares/community?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
        headers: { cookie },
      })
      .then((r) => r.json());
    const seen = [...page1.items, ...page2.items].map(
      (i: { article: { title: string } }) => i.article.title,
    );
    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual(['Item 0', 'Item 1', 'Item 2', 'Item 3']);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/shares/community?cursor=garbage',
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(400);
  });
});
