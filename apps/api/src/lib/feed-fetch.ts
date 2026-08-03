import type { IncomingHttpHeaders } from 'node:http';
import type { FeedCandidate } from '@rss/shared';
import { eq, sql } from 'drizzle-orm';
import { parse } from 'node-html-parser';
import Parser from 'rss-parser';
import { Agent, interceptors, request } from 'undici';
import { db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { extractText, SANITIZER_VERSION, sanitizeArticleHtml } from './sanitize.js';
import { discoverWebSubLinks, unsubscribeFromHub } from './websub.js';

export type FeedRow = typeof feeds.$inferSelect;
type NewArticleInsert = typeof articles.$inferInsert;

// Single shared parser instance (used here and, indirectly, by the worker).
const parser = new Parser({ timeout: 15_000 });
type ParsedFeed = Awaited<ReturnType<typeof parser.parseString>>;

const USER_AGENT = 'rss-reader/0.1 (+https://github.com/your/rss-reader)';

// undici's request() does not follow redirects on its own; the redirect
// interceptor adds that. A homepage often 301s to its canonical host, and
// feed URLs frequently redirect, so following them is required for discovery.
const dispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }));

// Content types that indicate a URL is already a feed, not an HTML page.
const FEED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/json',
  'application/feed+json',
];

// <link rel="alternate" type="..."> values we treat as feed links.
const FEED_LINK_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/json',
  'application/feed+json',
];

// Common feed locations probed when a homepage advertises no <link> tags.
const FALLBACK_PATHS = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed/'];

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Low-level GET used by every fetch below so the user-agent, redirect handling,
 * and body read are consistent. undici's request() does NOT follow redirects
 * unless maxRedirections is passed.
 */
async function httpGet(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string; finalUrl: string }> {
  const res = await request(url, {
    headers: { 'user-agent': USER_AGENT, ...extraHeaders },
    dispatcher,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: await res.body.text(),
    // undici request() does not expose the post-redirect URL; keep the
    // requested URL for href resolution.
    finalUrl: url,
  };
}

export type FetchFeedResult =
  | { status: 'not-modified' }
  | {
      status: 'ok';
      parsed: ParsedFeed;
      etag?: string;
      lastModified?: string;
      /** WebSub discovery (SPEC-021): advertised hub + canonical topic. */
      hubUrl: string | null;
      topicUrl: string;
    };

/** Parse a feed document with the shared rss-parser instance (SPEC-021:
 *  pushed WebSub content goes through the exact same parser as polls). */
export async function parseFeedString(xml: string): Promise<ParsedFeed> {
  return parser.parseString(xml);
}

/**
 * Conditional GET + parse of a feed URL. No database access. Throws on HTTP
 * >= 400 (matching the worker's previous error text) and lets network errors
 * propagate.
 */
export async function fetchAndParseFeed(
  feedUrl: string,
  opts: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchFeedResult> {
  const extra: Record<string, string> = {};
  if (opts.etag) extra['if-none-match'] = opts.etag;
  if (opts.lastModified) extra['if-modified-since'] = opts.lastModified;

  const res = await httpGet(feedUrl, extra);
  if (res.statusCode === 304) return { status: 'not-modified' };
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);

  const parsed = await parser.parseString(res.body);
  return {
    status: 'ok',
    parsed,
    etag: firstHeader(res.headers['etag']),
    lastModified: firstHeader(res.headers['last-modified']),
    ...discoverWebSubLinks(res.headers['link'], res.body, feedUrl),
  };
}

/** Absolute http(s) URL, or null. Feed-controlled input is never trusted raw. */
function toHttpUrl(value: string | undefined | null, baseUrl: string | null): string | null {
  if (!value) return null;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Canonical form of a feed URL for storage and lookup. Feeds are globally
 * deduplicated by exact string, so trivial variants of the same URL (trailing
 * slash, host case, fragment, default port) must collapse to one form or the
 * same podcast ends up as two feed rows. Scheme is left alone (http is not
 * upgraded) and the query string is preserved: both can be load-bearing.
 * Non-parseable or non-http(s) input is returned trimmed but untouched; the
 * fetch layer will surface the real error.
 */
export function normalizeFeedUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.href;
  } catch {
    return trimmed;
  }
}

/**
 * Pick a thumbnail for the card/magazine views (SPEC-010): the first usable
 * <img> in the item's HTML (body first, then the summary, since summary-only
 * feeds like xkcd put the image there), else an image enclosure or
 * media:content. og:image is deliberately skipped: it would need a per-article
 * page fetch, which must not be added to the poll loop.
 *
 * Summary HTML is only ever parsed to read an attribute; nothing from it is
 * stored or rendered, and the URL is validated as http(s) below.
 */
export function extractImageUrl(
  htmlSources: (string | null | undefined)[],
  item: Record<string, unknown>,
  baseUrl: string | null,
): string | null {
  for (const html of htmlSources) {
    if (!html) continue;
    for (const img of parse(html).querySelectorAll('img')) {
      // Skip spacers/tracking pixels the sanitizer left behind.
      const width = Number(img.getAttribute('width') ?? '0');
      const height = Number(img.getAttribute('height') ?? '0');
      if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) continue;
      const resolved = toHttpUrl(img.getAttribute('src'), baseUrl);
      if (resolved) return resolved;
    }
  }

  const enclosure = item.enclosure as { url?: string; type?: string } | undefined;
  if (enclosure?.url && (enclosure.type ?? '').startsWith('image')) {
    const resolved = toHttpUrl(enclosure.url, baseUrl);
    if (resolved) return resolved;
  }

  for (const key of ['media:content', 'media:thumbnail']) {
    const media = item[key] as { $?: { url?: string } } | undefined;
    const resolved = toHttpUrl(media?.$?.url, baseUrl);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * The item's playable enclosure (podcast audio, video), if any. Only declared
 * audio/* and video/* types are kept: image enclosures feed the thumbnail
 * picker above, and anything else (pdf, torrent) has no in-app player.
 */
export function extractEnclosure(
  item: Record<string, unknown>,
  baseUrl: string | null,
): { url: string; type: string } | null {
  const enclosure = item.enclosure as { url?: string; type?: string } | undefined;
  if (!enclosure?.url) return null;
  const type = (enclosure.type ?? '').trim().toLowerCase();
  if (!type.startsWith('audio/') && !type.startsWith('video/')) return null;
  const url = toHttpUrl(enclosure.url, baseUrl);
  return url ? { url, type } : null;
}

/** Pure mapping of parsed feed items to sanitized article insert rows. */
/**
 * rss-parser returns nested OBJECTS for xhtml/html Atom fields (e.g.
 * `<title type="xhtml">`) and for RSS nodes carrying attributes (e.g. a
 * `<guid isPermaLink>` or an Atom `<author>`). An object landing in a text
 * column breaks the whole insert batch (this is why some valid Atom feeds
 * imported with zero articles), so flatten any value to plain text. `$` holds
 * the XML attributes and is skipped.
 */
function flattenXmlText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenXmlText).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== '$')
      .map(([, v]) => flattenXmlText(v))
      .join(' ');
  }
  return '';
}

/** Display text: a string as-is (trimmed) or a flattened XML node; null if empty. */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const s = flattenXmlText(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** An id/URL: preserved verbatim when already a string, else flattened. */
function asId(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  return asText(value);
}

/** Author name, preferring dc:creator, then an Atom author object's `name`. */
function authorText(item: { creator?: unknown; author?: unknown }): string | null {
  if (typeof item.creator === 'string') return item.creator.trim() || null;
  const a = item.author;
  if (a && typeof a === 'object' && 'name' in a) return asText((a as { name?: unknown }).name);
  return asText(a);
}

export function feedArticleRows(feedId: string, parsed: ParsedFeed): NewArticleInsert[] {
  return parsed.items
    .map((item): NewArticleInsert | null => {
      const guid = asId(item.guid) ?? asId(item.link) ?? asId(item.id);
      if (!guid) return null;
      const rawContent = item['content:encoded'] ?? item.content ?? null;
      const raw = typeof rawContent === 'string' ? rawContent : asText(rawContent);
      const baseUrl = asId(item.link) ?? parsed.link ?? null;
      const cleanHtml = raw ? sanitizeArticleHtml(raw, baseUrl) : null;
      // Search text: prefer the body, fall back to the summary so summary-only
      // feeds stay searchable (SPEC-006). searchVector regenerates on write.
      const summaryText = asText(item.contentSnippet ?? item.summary);
      const contentText = cleanHtml
        ? extractText(cleanHtml)
        : summaryText
          ? extractText(summaryText)
          : null;
      const enclosure = extractEnclosure(item as Record<string, unknown>, baseUrl);
      return {
        feedId,
        guid,
        url: asId(item.link),
        title: asText(item.title),
        author: authorText(item),
        contentHtml: cleanHtml,
        contentText,
        imageUrl: extractImageUrl(
          [cleanHtml, typeof item.summary === 'string' ? item.summary : null],
          item as Record<string, unknown>,
          baseUrl,
        ),
        enclosureUrl: enclosure?.url ?? null,
        enclosureType: enclosure?.type ?? null,
        summary: summaryText,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        sanitizedAt: new Date(),
        sanitizerVersion: SANITIZER_VERSION,
      };
    })
    .filter((r): r is NewArticleInsert => r !== null);
}

/**
 * Resolve a site's favicon URL from its HTML (if provided), else fall back to
 * the origin's /favicon.ico. Returns null only when siteUrl is unparseable.
 */
export function resolveFavicon(siteUrl: string, html?: string): string | null {
  try {
    new URL(siteUrl);
  } catch {
    return null;
  }

  if (html) {
    const root = parse(html);
    const links = root.querySelectorAll('link');
    const relTokens = (el: (typeof links)[number]) =>
      (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    // Priority: rel containing "icon" (covers "icon" and "shortcut icon"),
    // then apple-touch-icon.
    const pick =
      links.find((l) => relTokens(l).includes('icon')) ??
      links.find((l) => relTokens(l).includes('apple-touch-icon'));
    const href = pick?.getAttribute('href');
    if (href) {
      try {
        return new URL(href, siteUrl).href;
      } catch {
        // fall through to /favicon.ico
      }
    }
  }

  try {
    return new URL('/favicon.ico', siteUrl).href;
  } catch {
    return null;
  }
}

async function parsesAsFeed(body: string): Promise<ParsedFeed | null> {
  try {
    return await parser.parseString(body);
  } catch {
    return null;
  }
}

/**
 * Discover feed candidates for a URL that may be a direct feed or an HTML
 * homepage. Never throws: an unreachable host yields an empty array.
 */
export async function discoverFeedCandidates(url: string): Promise<FeedCandidate[]> {
  let res: Awaited<ReturnType<typeof httpGet>>;
  try {
    res = await httpGet(url);
  } catch {
    return [];
  }

  // Direct feed: matching content-type, or the body parses as a feed.
  const contentType = (firstHeader(res.headers['content-type']) ?? '').toLowerCase();
  const isFeedContentType = FEED_CONTENT_TYPES.some((t) => contentType.includes(t));
  const directParsed = await parsesAsFeed(res.body);
  if (directParsed) return [{ feedUrl: url, title: directParsed.title ?? null }];
  if (isFeedContentType) return [{ feedUrl: url, title: null }];

  // HTML page: collect <link rel="alternate" type="feed-ish">.
  const root = parse(res.body);
  const candidates: FeedCandidate[] = [];
  for (const link of root.querySelectorAll('link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate')) continue;
    const type = (link.getAttribute('type') ?? '').toLowerCase();
    if (!FEED_LINK_TYPES.includes(type)) continue;
    const href = link.getAttribute('href');
    if (!href) continue;
    try {
      candidates.push({ feedUrl: new URL(href, url).href, title: link.getAttribute('title') ?? null });
    } catch {
      // skip unresolvable href
    }
  }

  // Fallback: probe common feed paths against the origin.
  if (candidates.length === 0) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = url;
    }
    const probes = await Promise.all(
      FALLBACK_PATHS.map(async (path): Promise<FeedCandidate | null> => {
        try {
          const probeUrl = new URL(path, origin).href;
          const probe = await httpGet(probeUrl);
          if (probe.statusCode >= 400) return null;
          const parsed = await parsesAsFeed(probe.body);
          return parsed ? { feedUrl: probeUrl, title: parsed.title ?? null } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const p of probes) if (p) candidates.push(p);
  }

  // Dedup by feedUrl.
  const seen = new Set<string>();
  return candidates.filter((c) => (seen.has(c.feedUrl) ? false : (seen.add(c.feedUrl), true)));
}

/**
 * The single article-insert path, shared by polling and WebSub pushes
 * (SPEC-021). Known articles are left alone, with one exception: an
 * enclosure is backfilled onto rows ingested before enclosure support
 * existed, as long as the item is still in the feed. The setWhere keeps this
 * a no-op write on every ordinary poll.
 */
export async function storeNewArticles(
  // The feed id seam exists for SPEC-025's per-user filter rules hook.
  _feedId: string,
  rows: NewArticleInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(articles)
    .values(rows)
    .onConflictDoUpdate({
      target: [articles.feedId, articles.guid],
      set: {
        enclosureUrl: sql`excluded.enclosure_url`,
        enclosureType: sql`excluded.enclosure_type`,
      },
      setWhere: sql`${articles.enclosureUrl} is null and excluded.enclosure_url is not null`,
    });
}

/**
 * Fetch a feed and persist its metadata, favicon, and articles. Errors are
 * recorded on the row (lastError / failureCount), never thrown, so a feed that
 * is momentarily down still yields a usable row.
 */
export async function fetchAndStoreFeed(feed: FeedRow): Promise<void> {
  try {
    const result = await fetchAndParseFeed(feed.feedUrl, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });

    if (result.status === 'not-modified') {
      await db.update(feeds).set({ lastFetchedAt: new Date() }).where(eq(feeds.id, feed.id));
      return;
    }

    const parsed = result.parsed;
    const siteUrl = parsed.link ?? feed.siteUrl ?? null;

    // Resolve the favicon only on first success (when not already set), so
    // steady-state polling makes no extra request.
    let faviconUrl: string | null | undefined;
    if (!feed.faviconUrl && siteUrl) {
      let html: string | undefined;
      try {
        html = (await httpGet(siteUrl)).body;
      } catch {
        html = undefined;
      }
      faviconUrl = resolveFavicon(siteUrl, html);
    }

    // WebSub bookkeeping (SPEC-021): persist the discovered hub/topic. Any
    // change resets the state machine (which also un-sticks 'denied'); a feed
    // that stops advertising a hub gets a best-effort unsubscribe. The worker
    // sends the subscribe request (see pollFeed), keeping interactive
    // subscribes fast.
    const websubChanges: Partial<typeof feeds.$inferInsert> = {};
    const topicUrl = result.hubUrl ? result.topicUrl : null;
    if (result.hubUrl !== feed.websubHubUrl || topicUrl !== feed.websubTopicUrl) {
      if (!result.hubUrl && feed.websubHubUrl) void unsubscribeFromHub(feed);
      websubChanges.websubHubUrl = result.hubUrl;
      websubChanges.websubTopicUrl = topicUrl;
      websubChanges.websubState = 'inactive';
      websubChanges.websubLeaseExpiresAt = null;
    }

    await db
      .update(feeds)
      .set({
        title: parsed.title ?? feed.title,
        siteUrl,
        description: parsed.description ?? feed.description,
        etag: result.etag ?? feed.etag,
        lastModified: result.lastModified ?? feed.lastModified,
        lastFetchedAt: new Date(),
        lastError: null,
        failureCount: 0,
        updatedAt: new Date(),
        ...(faviconUrl !== undefined ? { faviconUrl } : {}),
        ...websubChanges,
      })
      .where(eq(feeds.id, feed.id));

    await storeNewArticles(feed.id, feedArticleRows(feed.id, parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(feeds)
      .set({
        lastFetchedAt: new Date(),
        lastError: message,
        failureCount: sql`${feeds.failureCount} + 1`,
      })
      .where(eq(feeds.id, feed.id));
  }
}
