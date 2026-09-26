import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

interface RespSpec {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}
const responses = vi.hoisted(() => new Map<string, RespSpec>());
const requestMock = vi.hoisted(() => ({ count: 0 }));

vi.mock('undici', () => ({
  request: vi.fn(async (url: string) => {
    requestMock.count++;
    const r = responses.get(url);
    if (!r) throw new Error(`no mock for ${url}`);
    return {
      statusCode: r.statusCode ?? 200,
      headers: r.headers ?? { 'content-type': 'text/html' },
      body: { text: async () => r.body ?? '', dump: async () => {} },
    };
  }),
  Agent: class {
    compose() {
      return this;
    }
  },
  interceptors: { redirect: () => ({}) },
}));

const { buildApp } = await import('../app.js');
const { loginAs, resetDb, seedUser } = await import('../../test/helpers.js');

const RSS = (title: string, items = 2) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>` +
  `<link>https://site.example</link><description>d</description>` +
  Array.from(
    { length: items },
    (_, i) => `<item><title>Item ${i}</title><link>https://site.example/${i}</link><guid>g${i}</guid></item>`,
  ).join('') +
  `</channel></rss>`;

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  responses.clear();
  requestMock.count = 0;
  cookie = await loginAs(await seedUser());
});

test('subscribe to a direct feed populates metadata and stores articles', async () => {
  const feedUrl = 'https://site.example/rss.xml';
  responses.set(feedUrl, { headers: { 'content-type': 'application/rss+xml' }, body: RSS('My Feed', 3) });
  responses.set('https://site.example', { headers: { 'content-type': 'text/html' }, body: '<html></html>' });

  const res = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: feedUrl } });
  expect(res.statusCode).toBe(201);
  expect(res.json().feed.title).toBe('My Feed');
  expect(res.json().feed.faviconUrl).toBeTruthy();

  const list = await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });
  expect(list.json().items).toHaveLength(1);
  expect(list.json().items[0].unreadCount).toBe(3); // three stored articles, all unread
});

test('homepage with multiple feeds returns 409 with candidates and writes nothing', async () => {
  const home = 'https://blog.example/';
  responses.set(home, {
    headers: { 'content-type': 'text/html' },
    body:
      '<html><head>' +
      '<link rel="alternate" type="application/rss+xml" href="/rss.xml">' +
      '<link rel="alternate" type="application/atom+xml" href="/atom.xml">' +
      '</head></html>',
  });

  const res = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: home } });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('ambiguous_feed');
  expect(res.json().candidates).toHaveLength(2);

  const list = await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });
  expect(list.json().items).toHaveLength(0); // nothing subscribed
});

test('homepage with no discoverable feed returns 422', async () => {
  const home = 'https://empty.example/';
  responses.set(home, { headers: { 'content-type': 'text/html' }, body: '<html><body>nope</body></html>' });
  const res = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: home } });
  expect(res.statusCode).toBe(422);
  expect(res.json().error).toBe('no_feed_found');
});

test('re-subscribing to an existing feed dedups and does not refetch', async () => {
  const feedUrl = 'https://site.example/rss.xml';
  responses.set(feedUrl, { headers: { 'content-type': 'application/rss+xml' }, body: RSS('My Feed') });
  responses.set('https://site.example', { headers: { 'content-type': 'text/html' }, body: '<html></html>' });

  const first = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: feedUrl } });
  expect(first.statusCode).toBe(201);
  const fetchesAfterFirst = requestMock.count;
  expect(fetchesAfterFirst).toBeGreaterThan(0);

  // A different user re-subscribes to the same feed URL.
  const cookie2 = await loginAs(await seedUser());
  const second = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie: cookie2 }, payload: { url: feedUrl } });
  expect(second.statusCode).toBe(201);
  expect(requestMock.count).toBe(fetchesAfterFirst); // fast path: no new network fetch
});

test('GET /feeds/discover returns candidates and writes nothing', async () => {
  const home = 'https://blog.example/';
  responses.set(home, {
    headers: { 'content-type': 'text/html' },
    body: '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>',
  });
  const res = await app.inject({
    method: 'GET',
    url: `/api/feeds/discover?url=${encodeURIComponent(home)}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().candidates).toHaveLength(1);

  const list = await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });
  expect(list.json().items).toHaveLength(0);
});

// SPEC-023: a social profile URL subscribes to its feed.
test('subscribe to a Bluesky profile URL stores its /rss feed', async () => {
  const profile = 'https://bsky.app/profile/somebody.bsky.social';
  responses.set(`${profile}/rss`, {
    headers: { 'content-type': 'application/rss+xml' },
    body:
      '<?xml version="1.0"?><rss version="2.0"><channel><title>@somebody.bsky.social - Somebody</title>' +
      `<link>${profile}</link><description>d</description>` +
      `<item><link>${profile}/post/3k1</link><guid>at://did:plc:x/app.bsky.feed.post/3k1</guid>` +
      '<description>Hello from Bluesky</description></item></channel></rss>',
  });
  responses.set(profile, { headers: { 'content-type': 'text/html' }, body: '<html></html>' });

  const res = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: profile } });
  expect(res.statusCode).toBe(201);
  expect(res.json().feed).toMatchObject({
    feedUrl: `${profile}/rss`,
    title: '@somebody.bsky.social - Somebody',
  });

  const list = await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });
  expect(list.json().items).toHaveLength(1);
  expect(list.json().items[0].unreadCount).toBe(1);
});

test('GET /feeds/discover on a Mastodon profile offers <profile>.rss', async () => {
  responses.set('https://hachyderm.io/@someone.rss', {
    headers: { 'content-type': 'application/rss+xml' },
    body: RSS('Someone'),
  });
  const res = await app.inject({
    method: 'GET',
    url: `/api/feeds/discover?url=${encodeURIComponent('https://hachyderm.io/@someone')}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().candidates).toEqual([{ feedUrl: 'https://hachyderm.io/@someone.rss', title: 'Someone' }]);
  expect(requestMock.count).toBe(1); // the probe only, never the profile page
});

// SPEC-025: the articles that come with a subscription pass the user's rules.
test('subscribing to a known feed runs the user\'s rules over its stored articles', async () => {
  const { db } = await import('../db/index.js');
  const { articleStates, filterRules } = await import('../db/schema.js');
  const { seedArticle, seedFeed } = await import('../../test/helpers.js');
  const feed = await seedFeed({ feedUrl: 'https://known.example/rss', title: 'Known' });
  const ad = await seedArticle(feed.id, { title: 'Sponsored: a thing' });
  await seedArticle(feed.id, { title: 'A real post' });
  const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
  await db.insert(filterRules).values({ userId: me.id, field: 'title', phrase: 'sponsored', action: 'markRead' });

  const res = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: feed.feedUrl } });
  expect(res.statusCode).toBe(201);
  expect(requestMock.count).toBe(0); // the fast path: nothing fetched
  const states = await db.select().from(articleStates);
  expect(states).toEqual([expect.objectContaining({ articleId: ad.id, read: true, starred: false })]);
});

test('unsubscribe removes only the caller subscription', async () => {
  const feedUrl = 'https://site.example/rss.xml';
  responses.set(feedUrl, { headers: { 'content-type': 'application/rss+xml' }, body: RSS('My Feed') });
  responses.set('https://site.example', { headers: { 'content-type': 'text/html' }, body: '<html></html>' });

  const sub = await app.inject({ method: 'POST', url: '/api/feeds', headers: { cookie }, payload: { url: feedUrl } });
  const subscriptionId = sub.json().subscription.id;

  const del = await app.inject({ method: 'DELETE', url: `/api/feeds/${subscriptionId}`, headers: { cookie } });
  expect(del.statusCode).toBe(204);
  const list = await app.inject({ method: 'GET', url: '/api/feeds', headers: { cookie } });
  expect(list.json().items).toHaveLength(0);
});
