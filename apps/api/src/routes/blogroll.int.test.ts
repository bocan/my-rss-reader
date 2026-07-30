import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import {
  loginAs,
  resetDb,
  seedFeed,
  seedFolder,
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

/** A user with a folderful of feeds and the blogroll switched on. */
async function seedBlogroller() {
  const user = await seedUser({ displayName: 'Roller' });
  await seedProfile(user.id, { slug: 'roller', blogrollEnabled: true });
  const tech = await seedFolder(user.id, { name: 'Tech & Friends' });
  const emptyFolder = await seedFolder(user.id, { name: 'Secret Empty Folder' });

  const inFolder = await seedFeed({
    title: '<script>Evil</script> Blog',
    siteUrl: 'https://evil.example',
  });
  const atRoot = await seedFeed({ title: 'Root Feed', siteUrl: 'https://root.example' });
  const excluded = await seedFeed({ title: 'Private Guilty Pleasure' });

  await seedSubscription(user.id, inFolder.id, { folderId: tech.id });
  await seedSubscription(user.id, atRoot.id);
  await seedSubscription(user.id, excluded.id, { inBlogroll: false });
  return { user, tech, emptyFolder, inFolder, atRoot, excluded };
}

describe('public blogroll', () => {
  test('404 for unknown slugs and disabled blogrolls', async () => {
    const user = await seedUser();
    await seedProfile(user.id, { slug: 'quiet', visibility: 'public' }); // shares on, blogroll off
    for (const url of ['/u/quiet/blogroll', '/u/quiet/blogroll.opml', '/u/nobody/blogroll']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  test('renders grouped, escaped HTML without excluded feeds or empty folders', async () => {
    await seedBlogroller();
    const res = await app.inject({ method: 'GET', url: '/u/roller/blogroll' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('public, max-age=300');

    const html = res.body;
    expect(html).toContain('Roller&#39;s blogroll');
    expect(html).toContain('Tech &amp; Friends');
    expect(html).not.toContain('<script>Evil</script>');
    expect(html).toContain('&lt;script&gt;Evil&lt;/script&gt; Blog');
    expect(html).toContain('Root Feed');
    expect(html).not.toContain('Private Guilty Pleasure'); // inBlogroll = false
    expect(html).not.toContain('Secret Empty Folder'); // pruned
    expect(html).toContain('rel="blogroll" type="text/x-opml"');
    expect(html).toContain('/u/roller/blogroll.opml');
    // Shares are off, so no cross-link to the share page.
    expect(html).not.toContain('Shared items</a>');
  });

  test('cross-links appear when both surfaces are on', async () => {
    const { user } = await seedBlogroller();
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie: await loginAs(user) },
      payload: { visibility: 'public' },
    });

    const roll = await app.inject({ method: 'GET', url: '/u/roller/blogroll' });
    expect(roll.body).toContain('Shared items</a>');
    const shares = await app.inject({ method: 'GET', url: '/u/roller' });
    expect(shares.body).toContain('Blogroll</a>');
  });

  test('the OPML twin filters identically, serves inline, and round-trips', async () => {
    const { excluded } = await seedBlogroller();
    const res = await app.inject({ method: 'GET', url: '/u/roller/blogroll.opml' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/x-opml');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.body).toContain('Tech &amp; Friends');
    expect(res.body).not.toContain(excluded.feedUrl);

    // Round-trip: a second account imports the public OPML. The feeds already
    // exist in this instance, so no network fetch is involved.
    const importer = await seedUser();
    const imported = await app
      .inject({
        method: 'POST',
        url: '/api/opml/import',
        headers: { cookie: await loginAs(importer) },
        payload: { opml: res.body },
      })
      .then((r) => r.json());
    expect(imported.feedsAdded).toBe(2);
    expect(imported.foldersCreated).toBe(1);
    expect(imported.failed).toEqual([]);
  });

  test('the authenticated export still includes everything', async () => {
    const { user, excluded } = await seedBlogroller();
    const res = await app.inject({
      method: 'GET',
      url: '/api/opml/export',
      headers: { cookie: await loginAs(user) },
    });
    expect(res.body).toContain(excluded.feedUrl); // export ignores inBlogroll
    expect(res.body).toContain('Secret Empty Folder'); // and keeps empty folders
  });

  test('inBlogroll round-trips through PATCH /api/feeds/:id', async () => {
    const user = await seedUser();
    const feed = await seedFeed();
    const sub = await seedSubscription(user.id, feed.id);
    const cookie = await loginAs(user);

    const updated = await app
      .inject({
        method: 'PATCH',
        url: `/api/feeds/${sub.id}`,
        headers: { cookie },
        payload: { inBlogroll: false },
      })
      .then((r) => r.json());
    expect(updated.inBlogroll).toBe(false);

    const list = await app
      .inject({ method: 'GET', url: '/api/feeds', headers: { cookie } })
      .then((r) => r.json());
    expect(list.items[0].inBlogroll).toBe(false);
  });

  test('blogrollEnabled rides the profile API with its URL', async () => {
    const user = await seedUser();
    const cookie = await loginAs(user);
    const profile = await app
      .inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { cookie },
        payload: { slug: 'me-roll', blogrollEnabled: true },
      })
      .then((r) => r.json());
    expect(profile.blogrollEnabled).toBe(true);
    expect(profile.blogrollUrl).toMatch(/\/u\/me-roll\/blogroll$/);
    expect(profile.shareUrl).toBeNull(); // shares still off
  });
});
