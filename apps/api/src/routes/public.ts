import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { articles, articleStates, feeds, profiles, users } from '../db/schema.js';
import { esc, escMultiline, layout } from '../lib/public-html.js';
import { buildShareAtom, buildShareJsonFeed, type ShareFeedItem } from '../lib/share-feeds.js';
import { publicBase } from './profile.js';

/** Public page size: the latest N shared items, no pagination (SPEC-019). */
const SHARE_PAGE_ITEMS = 100;

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

interface PublicProfile {
  userId: string;
  slug: string;
  title: string | null;
  bio: string | null;
  displayName: string;
}

/** The profile behind /u/:slug, only when it is public and its user active. */
async function loadPublicProfile(slug: string): Promise<PublicProfile | null> {
  const [row] = await db
    .select({
      userId: profiles.userId,
      slug: profiles.slug,
      title: profiles.title,
      bio: profiles.bio,
      displayName: users.displayName,
    })
    .from(profiles)
    .innerJoin(users, and(eq(users.id, profiles.userId), isNull(users.disabledAt)))
    .where(and(eq(profiles.slug, slug), eq(profiles.visibility, 'public')))
    .limit(1);
  return row ?? null;
}

async function loadSharedItems(userId: string): Promise<ShareFeedItem[]> {
  const rows = await db
    .select({
      articleId: articles.id,
      title: articles.title,
      url: articles.url,
      summary: articles.summary,
      note: articleStates.shareNote,
      sharedAt: articleStates.sharedAt,
      feedTitle: feeds.title,
      feedSiteUrl: feeds.siteUrl,
    })
    .from(articleStates)
    .innerJoin(articles, eq(articles.id, articleStates.articleId))
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(eq(articleStates.userId, userId), eq(articleStates.shared, true)))
    .orderBy(sql`${articleStates.sharedAt} desc, ${articles.id} desc`)
    .limit(SHARE_PAGE_ITEMS);
  return rows.map((r) => ({ ...r, sharedAt: r.sharedAt! }));
}

function pageTitle(profile: PublicProfile): string {
  return profile.title ?? `${profile.displayName}'s shared items`;
}

const notFound = { error: 'NotFound', message: 'Not found', statusCode: 404 } as const;

function cache(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'public, max-age=300');
}

/**
 * The unauthenticated public surface (SPEC-019): a user's share page and its
 * Atom / JSON Feed twins. Registered at the ROOT scope (not under /api), so
 * the routes win over the SPA fallback by being explicit matches.
 */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>('/u/:slug', async (request, reply) => {
    const profile = await loadPublicProfile(request.params.slug);
    if (!profile) return reply.code(404).send(notFound);
    const items = await loadSharedItems(profile.userId);
    const base = publicBase(request);
    const pageUrl = `${base}/u/${profile.slug}`;

    const entries = items
      .map((item) => {
        const link = item.url ?? item.feedSiteUrl;
        const title = esc(item.title ?? 'Untitled');
        return `<article class="h-entry">
${item.note ? `  <p class="note p-content">${escMultiline(item.note)}</p>\n` : ''}  <h2>${
          link
            ? `<a class="u-url" href="${esc(link)}" rel="noopener noreferrer">${title}</a>`
            : title
        }</h2>
  <p class="meta">${item.feedTitle ? `${esc(item.feedTitle)} · ` : ''}<time class="dt-published" datetime="${item.sharedAt.toISOString()}">${dateFmt.format(item.sharedAt)}</time></p>
</article>`;
      })
      .join('\n');

    const body = `<div class="h-feed">
<header>
  <h1 class="p-name">${esc(pageTitle(profile))}</h1>
  <p>Links shared by ${esc(profile.displayName)}.</p>
${profile.bio ? `  <p>${escMultiline(profile.bio)}</p>\n` : ''}</header>
${entries || '<p class="meta">Nothing shared yet.</p>'}
<footer>
  <p>Subscribe: <a href="${esc(pageUrl)}/feed.xml">Atom</a> · <a href="${esc(pageUrl)}/feed.json">JSON Feed</a> · powered by Reader</p>
</footer>
</div>`;

    const head = `<link rel="alternate" type="application/atom+xml" title="${esc(pageTitle(profile))}" href="${esc(pageUrl)}/feed.xml">
<link rel="alternate" type="application/feed+json" title="${esc(pageTitle(profile))}" href="${esc(pageUrl)}/feed.json">`;

    return cache(reply)
      .type('text/html; charset=utf-8')
      .send(layout({ title: pageTitle(profile), head, body }));
  });

  app.get<{ Params: { slug: string } }>('/u/:slug/feed.xml', async (request, reply) => {
    const profile = await loadPublicProfile(request.params.slug);
    if (!profile) return reply.code(404).send(notFound);
    const items = await loadSharedItems(profile.userId);
    return cache(reply)
      .type('application/atom+xml; charset=utf-8')
      .send(
        buildShareAtom({
          base: publicBase(request),
          slug: profile.slug,
          userId: profile.userId,
          displayName: profile.displayName,
          pageTitle: pageTitle(profile),
          items,
        }),
      );
  });

  app.get<{ Params: { slug: string } }>('/u/:slug/feed.json', async (request, reply) => {
    const profile = await loadPublicProfile(request.params.slug);
    if (!profile) return reply.code(404).send(notFound);
    const items = await loadSharedItems(profile.userId);
    return cache(reply)
      .type('application/feed+json; charset=utf-8')
      .send(
        buildShareJsonFeed({
          base: publicBase(request),
          slug: profile.slug,
          userId: profile.userId,
          displayName: profile.displayName,
          pageTitle: pageTitle(profile),
          items,
        }),
      );
  });
}
