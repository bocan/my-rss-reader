import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { articles, articleStates, feeds, profiles, users } from '../db/schema.js';
import { buildOpml, type OpmlFeedNode, type OpmlFolderNode } from '../lib/opml.js';
import { buildUserFeedTree } from '../lib/opml-tree.js';
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
  visibility: string;
  blogrollEnabled: boolean;
  displayName: string;
}

/** The profile behind /u/:slug for an active user, regardless of what it
 *  exposes; each route checks the gate it cares about (shares vs blogroll). */
async function loadProfileForSlug(slug: string): Promise<PublicProfile | null> {
  const [row] = await db
    .select({
      userId: profiles.userId,
      slug: profiles.slug,
      title: profiles.title,
      bio: profiles.bio,
      visibility: profiles.visibility,
      blogrollEnabled: profiles.blogrollEnabled,
      displayName: users.displayName,
    })
    .from(profiles)
    .innerJoin(users, and(eq(users.id, profiles.userId), isNull(users.disabledAt)))
    .where(eq(profiles.slug, slug))
    .limit(1);
  return row ?? null;
}

/** The profile behind /u/:slug, only when shares are public. */
async function loadPublicProfile(slug: string): Promise<PublicProfile | null> {
  const row = await loadProfileForSlug(slug);
  return row && row.visibility === 'public' ? row : null;
}

/** The profile behind /u/:slug/blogroll, only when the blogroll is on. */
async function loadBlogrollProfile(slug: string): Promise<PublicProfile | null> {
  const row = await loadProfileForSlug(slug);
  return row && row.blogrollEnabled ? row : null;
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
  <p>Subscribe: <a href="${esc(pageUrl)}/feed.xml">Atom</a> · <a href="${esc(pageUrl)}/feed.json">JSON Feed</a>${profile.blogrollEnabled ? ` · <a href="${esc(pageUrl)}/blogroll">Blogroll</a>` : ''} · powered by Reader</p>
</footer>
</div>`;

    const head = `<link rel="alternate" type="application/atom+xml" title="${esc(pageTitle(profile))}" href="${esc(pageUrl)}/feed.xml">
<link rel="alternate" type="application/feed+json" title="${esc(pageTitle(profile))}" href="${esc(pageUrl)}/feed.json">`;

    return cache(reply)
      .type('text/html; charset=utf-8')
      .send(layout({ title: pageTitle(profile), head, body }));
  });

  // --- Blogroll (SPEC-020) ------------------------------------------------
  // Gated by profiles.blogrollEnabled, independent of shares visibility.

  app.get<{ Params: { slug: string } }>('/u/:slug/blogroll', async (request, reply) => {
    const profile = await loadBlogrollProfile(request.params.slug);
    if (!profile) return reply.code(404).send(notFound);
    const tree = await buildUserFeedTree(profile.userId, { blogrollOnly: true });
    const base = publicBase(request);
    const pageUrl = `${base}/u/${profile.slug}`;
    const rollTitle = `${profile.title ?? profile.displayName}'s blogroll`;

    const feedItem = (feed: OpmlFeedNode): string => `<li>
  ${feed.faviconUrl ? `<img src="${esc(feed.faviconUrl)}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer"> ` : ''}<a href="${esc(feed.htmlUrl ?? feed.xmlUrl)}" rel="noopener noreferrer">${esc(feed.title)}</a>
  <a class="feedlink" href="${esc(feed.xmlUrl)}">feed</a>
</li>`;

    const folderSection = (folder: OpmlFolderNode, level: number): string => {
      const h = level === 0 ? 'h2' : 'h3';
      return `<section>
<${h}>${esc(folder.title)}</${h}>
${folder.folders.map((f) => folderSection(f, level + 1)).join('\n')}
${folder.feeds.length > 0 ? `<ul>\n${folder.feeds.map(feedItem).join('\n')}\n</ul>` : ''}
</section>`;
    };

    const body = `<header>
  <h1>${esc(rollTitle)}</h1>
  <p>The feeds ${esc(profile.displayName)} reads.</p>
${profile.bio ? `  <p>${escMultiline(profile.bio)}</p>\n` : ''}</header>
${tree.folders.map((f) => folderSection(f, 0)).join('\n')}
${tree.feeds.length > 0 ? `<ul>\n${tree.feeds.map(feedItem).join('\n')}\n</ul>` : ''}
${tree.folders.length === 0 && tree.feeds.length === 0 ? '<p>Nothing here yet.</p>' : ''}
<footer>
  <p><a href="${esc(pageUrl)}/blogroll.opml">Download OPML</a> (import it into any feed reader)${profile.visibility === 'public' ? ` · <a href="${esc(pageUrl)}">Shared items</a>` : ''} · powered by Reader</p>
</footer>`;

    const head = `<link rel="blogroll" type="text/x-opml" title="${esc(rollTitle)}" href="${esc(pageUrl)}/blogroll.opml">
<style>li{margin:0.3rem 0}li img{vertical-align:-2px;border-radius:3px}.feedlink{font-family:ui-monospace,monospace;font-size:0.75rem;margin-left:0.35rem}</style>`;

    return cache(reply)
      .type('text/html; charset=utf-8')
      .send(layout({ title: rollTitle, head, body }));
  });

  app.get<{ Params: { slug: string } }>('/u/:slug/blogroll.opml', async (request, reply) => {
    const profile = await loadBlogrollProfile(request.params.slug);
    if (!profile) return reply.code(404).send(notFound);
    const tree = await buildUserFeedTree(profile.userId, { blogrollOnly: true });
    const rollTitle = `${profile.title ?? profile.displayName}'s blogroll`;
    return cache(reply)
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'inline')
      .send(buildOpml(tree, rollTitle));
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
