import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import type * as FeedFetch from '../lib/feed-fetch.js';

// Keep the importer off the network: every feed "fetch" is a no-op here.
const fetchAndStoreFeed = vi.hoisted(() => vi.fn(async (_feed?: { id: string }) => {}));
vi.mock('../lib/feed-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FeedFetch>();
  return { ...actual, fetchAndStoreFeed };
});

const { buildApp } = await import('../app.js');
const { db } = await import('../db/index.js');
const { feeds, folders, subscriptions } = await import('../db/schema.js');
const { loginAs, resetDb, seedFeed, seedFolder, seedSubscription, seedUser } = await import(
  '../../test/helpers.js'
);

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
  fetchAndStoreFeed.mockClear();
});

const importOpml = (cookie: string, opml: string) =>
  app.inject({ method: 'POST', url: '/api/opml/import', headers: { cookie }, payload: { opml } });

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>t</title></head><body>${body}</body></opml>`;

test('imports a nested file, creating folders and subscriptions in the right places', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);

  const res = await importOpml(
    cookie,
    wrap(
      '<outline text="Tech">' +
        '<outline text="Inner"><outline text="Deep" xmlUrl="https://a.example/deep" /></outline>' +
        '<outline text="Flat" xmlUrl="https://a.example/flat" />' +
        '</outline>' +
        '<outline text="Loose" xmlUrl="https://a.example/loose" />',
    ),
  );
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ foldersCreated: 2, feedsAdded: 3, skipped: 0 });

  const folderRows = await db.select().from(folders).where(eq(folders.userId, user.id));
  const tech = folderRows.find((f) => f.name === 'Tech')!;
  const inner = folderRows.find((f) => f.name === 'Inner')!;
  expect(tech.parentId).toBeNull();
  expect(inner.parentId).toBe(tech.id); // one level of nesting preserved

  const subRows = await db
    .select({ folderId: subscriptions.folderId, feedUrl: feeds.feedUrl })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(eq(subscriptions.userId, user.id));
  const byUrl = Object.fromEntries(subRows.map((s) => [s.feedUrl, s.folderId]));
  expect(byUrl['https://a.example/deep']).toBe(inner.id);
  expect(byUrl['https://a.example/flat']).toBe(tech.id);
  expect(byUrl['https://a.example/loose']).toBeNull();
});

test('already-subscribed feeds count as skipped and create no duplicates', async () => {
  const user = await seedUser();
  const feed = await seedFeed({ feedUrl: 'https://a.example/known' });
  await seedSubscription(user.id, feed.id);
  const cookie = await loginAs(user);

  const res = await importOpml(
    cookie,
    wrap('<outline text="Known" xmlUrl="https://a.example/known" />'),
  );
  expect(res.json()).toMatchObject({ skipped: 1, feedsAdded: 0 });
  expect(fetchAndStoreFeed).not.toHaveBeenCalled(); // existing feed: no refetch

  const feedRows = await db.select().from(feeds).where(eq(feeds.feedUrl, 'https://a.example/known'));
  expect(feedRows).toHaveLength(1);
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  expect(subRows).toHaveLength(1);
});

test('an existing folder of the same name is reused, not duplicated', async () => {
  const user = await seedUser();
  await seedFolder(user.id, { name: 'Tech' });
  const cookie = await loginAs(user);

  // Different case, to prove the match is case-insensitive.
  await importOpml(cookie, wrap('<outline text="tech"><outline text="F" xmlUrl="https://a/1" /></outline>'));

  const folderRows = await db.select().from(folders).where(eq(folders.userId, user.id));
  expect(folderRows).toHaveLength(1);
});

test('one failing feed is recorded without aborting the rest', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);
  // Fail only the first feed fetch.
  fetchAndStoreFeed.mockImplementationOnce(async () => {
    throw new Error('boom');
  });

  const res = await importOpml(
    cookie,
    wrap(
      '<outline text="Bad" xmlUrl="https://a.example/bad" />' +
        '<outline text="Good" xmlUrl="https://a.example/good" />',
    ),
  );
  const body = res.json();
  expect(body.failed).toHaveLength(1);
  expect(body.failed[0].reason).toContain('boom');
  expect(body.feedsAdded).toBe(1); // the other one still imported
});

test('a new feed whose first fetch fails (no throw) is rejected, not imported', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);
  // The fetch does not throw, but marks the feed errored (a parking page / moved
  // feed): the importer must not keep it.
  fetchAndStoreFeed.mockImplementationOnce(async (feed) => {
    await db.update(feeds).set({ lastError: 'not a feed' }).where(eq(feeds.id, feed!.id));
  });

  const res = await importOpml(cookie, wrap('<outline text="Dead" xmlUrl="https://a.example/dead.xml" />'));
  const body = res.json();
  expect(body.feedsAdded).toBe(0);
  expect(body.failed).toHaveLength(1);
  expect(body.failed[0].reason).toContain('not a feed');
  // Orphan feed row dropped; no subscription created.
  expect(
    await db.select().from(feeds).where(eq(feeds.feedUrl, 'https://a.example/dead.xml')),
  ).toHaveLength(0);
  expect(
    await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)),
  ).toHaveLength(0);
});

test('an outline with no xmlUrl and no children is reported as failed', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);
  const res = await importOpml(
    cookie,
    wrap('<outline text="Bare" htmlUrl="https://a.example/site" />'),
  );
  expect(res.json().failed).toEqual([
    { title: 'Bare', xmlUrl: null, reason: 'Outline has no xmlUrl' },
  ]);
});

test('malformed OPML returns 400 invalid_opml, never a 500', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);
  for (const bad of ['<opml><body><outline', '<html><body></body></html>']) {
    const res = await importOpml(cookie, bad);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_opml');
  }
});

test('an oversize document is rejected with 413 before parsing', async () => {
  const user = await seedUser();
  const cookie = await loginAs(user);

  // Just over OPML_MAX_BYTES (5 MB) but inside the route bodyLimit, so the
  // handler's explicit guard is what rejects it.
  const justOver = `<opml><body>${'x'.repeat(5 * 1024 * 1024)}</body></opml>`;
  const res = await importOpml(cookie, justOver);
  expect(res.statusCode).toBe(413);
  expect(res.json().error).toBe('opml_too_large');

  // Far over: Fastify's route bodyLimit rejects it before the handler runs.
  const huge = 'y'.repeat(7 * 1024 * 1024);
  const res2 = await importOpml(cookie, huge);
  expect(res2.statusCode).toBe(413);
});

test('export produces OPML with the right headers and nesting', async () => {
  const user = await seedUser();
  const parent = await seedFolder(user.id, { name: 'Tech' });
  const child = await seedFolder(user.id, { name: 'Inner', parentId: parent.id });
  const f1 = await seedFeed({ feedUrl: 'https://a.example/1', title: 'One', siteUrl: 'https://a.example' });
  const f2 = await seedFeed({ feedUrl: 'https://a.example/2', title: 'Two' });
  const f3 = await seedFeed({ feedUrl: 'https://a.example/3', title: 'Three' });
  await seedSubscription(user.id, f1.id, { folderId: parent.id });
  await seedSubscription(user.id, f2.id, { folderId: child.id });
  await seedSubscription(user.id, f3.id);
  const cookie = await loginAs(user);

  const res = await app.inject({ method: 'GET', url: '/api/opml/export', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/x-opml');
  expect(res.headers['content-disposition']).toContain('reader-subscriptions.opml');
  expect(res.body).toContain('xmlUrl="https://a.example/1"');
  expect(res.body).toContain('htmlUrl="https://a.example"');
  expect(res.body).toContain('title="Inner"');
});

test('round trip: export one user set and import it into a fresh user', async () => {
  const first = await seedUser();
  const parent = await seedFolder(first.id, { name: 'Tech' });
  const child = await seedFolder(first.id, { name: 'Inner', parentId: parent.id });
  const f1 = await seedFeed({ feedUrl: 'https://a.example/1', title: 'One' });
  const f2 = await seedFeed({ feedUrl: 'https://a.example/2', title: 'Two' });
  const f3 = await seedFeed({ feedUrl: 'https://a.example/3', title: 'Three' });
  await seedSubscription(first.id, f1.id, { folderId: parent.id });
  await seedSubscription(first.id, f2.id, { folderId: child.id });
  await seedSubscription(first.id, f3.id);

  const exported = await app.inject({
    method: 'GET',
    url: '/api/opml/export',
    headers: { cookie: await loginAs(first) },
  });

  const second = await seedUser();
  const res = await importOpml(await loginAs(second), exported.body);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ foldersCreated: 2, feedsAdded: 3 });

  // The second user's tree matches the first user's.
  const shape = async (userId: string) => {
    const fs = await db.select().from(folders).where(eq(folders.userId, userId));
    const byId = new Map(fs.map((f) => [f.id, f.name]));
    const subs = await db
      .select({ folderId: subscriptions.folderId, feedUrl: feeds.feedUrl })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(eq(subscriptions.userId, userId));
    return {
      folders: fs.map((f) => `${f.parentId ? `${byId.get(f.parentId)}/` : ''}${f.name}`).sort(),
      subs: subs
        .map((s) => `${s.folderId ? byId.get(s.folderId) : 'root'}:${s.feedUrl}`)
        .sort(),
    };
  };
  expect(await shape(second.id)).toEqual(await shape(first.id));
});
