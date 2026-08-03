import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { XMLParser } from 'fast-xml-parser';
import { Agent, interceptors, request } from 'undici';
import { db } from '../db/index.js';
import { feeds } from '../db/schema.js';
import { env } from '../env.js';

/**
 * W3C WebSub, subscriber side (SPEC-021): hub discovery, subscribe/renew
 * requests, and content-push signature verification. The callback routes live
 * in routes/websub.ts; the worker drives subscription and renewal.
 */

export type FeedRow = typeof feeds.$inferSelect;

/** Lease we ask hubs for (they may shorten it). */
export const LEASE_SECONDS_REQUESTED = 604_800; // 7 days
/** How lazily a feed with an active push subscription is still polled. */
export const WEBSUB_ACTIVE_POLL_FLOOR_SEC = 21_600; // 6 hours
/** Renew leases that expire within this window (checked every worker tick). */
export const RENEW_WINDOW_SEC = 12 * 3600;

const dispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }));

// --- Discovery ------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface RelLink {
  rel: string[];
  href: string;
}

/** Parse HTTP Link headers: `<url>; rel="hub", <url>; rel="self"`. */
function parseLinkHeader(value: string | string[] | undefined): RelLink[] {
  const headers = toArray(value);
  const links: RelLink[] = [];
  for (const header of headers) {
    // Split on commas that separate link-values (never inside <...>).
    for (const part of header.split(/,(?![^<]*>)/)) {
      const href = /<([^>]*)>/.exec(part)?.[1];
      const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(part)?.[1];
      if (href && rel) links.push({ href, rel: rel.toLowerCase().split(/\s+/) });
    }
  }
  return links;
}

/** atom:link-ish nodes from a parsed feed document (Atom or RSS). */
function xmlRelLinks(xmlBody: string): RelLink[] {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(xmlBody) as Record<string, unknown>;
  } catch {
    return [];
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  const nodes = [
    ...toArray(feed?.link),
    ...toArray(channel?.['atom:link']),
    ...toArray(channel?.link),
  ];
  const links: RelLink[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const attrs = node as { '@_rel'?: string; '@_href'?: string };
    if (!attrs['@_rel'] || !attrs['@_href']) continue;
    links.push({ href: attrs['@_href'], rel: attrs['@_rel'].toLowerCase().split(/\s+/) });
  }
  return links;
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Extract rel=hub / rel=self from HTTP Link headers and the feed XML.
 * Header wins on conflict; topicUrl falls back to the feed URL when the feed
 * declares no rel=self (the common case for RSS).
 */
export function discoverWebSubLinks(
  linkHeader: string | string[] | undefined,
  xmlBody: string,
  feedUrl: string,
): { hubUrl: string | null; topicUrl: string } {
  const links = [...parseLinkHeader(linkHeader), ...xmlRelLinks(xmlBody)];
  const first = (rel: string) => links.find((l) => l.rel.includes(rel))?.href;
  return {
    hubUrl: resolve(first('hub'), feedUrl),
    topicUrl: resolve(first('self'), feedUrl) ?? feedUrl,
  };
}

// --- Signatures -----------------------------------------------------------

const SIGNATURE_METHODS = new Set(['sha1', 'sha256', 'sha384', 'sha512']);

/**
 * Verify an X-Hub-Signature header (`method=hex`) against the raw body.
 * Never throws; any malformed input is simply "not valid".
 */
export function verifySignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
): boolean {
  if (!header) return false;
  const eqAt = header.indexOf('=');
  if (eqAt === -1) return false;
  const method = header.slice(0, eqAt).trim().toLowerCase();
  const provided = header.slice(eqAt + 1).trim();
  if (!SIGNATURE_METHODS.has(method) || !/^[0-9a-f]+$/i.test(provided)) return false;
  const expected = createHmac(method, secret).update(rawBody).digest('hex');
  const a = Buffer.from(provided.toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Subscribing ----------------------------------------------------------

/** Our callback URL for a feed's token. Null when PUBLIC_URL is unset. */
export function callbackUrl(token: string): string | null {
  if (!env.PUBLIC_URL) return null;
  return `${env.PUBLIC_URL.replace(/\/+$/, '')}/api/websub/callback/${token}`;
}

async function postToHub(hubUrl: string, form: Record<string, string>): Promise<number> {
  const res = await request(hubUrl, {
    method: 'POST',
    dispatcher,
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  await res.body.dump();
  return res.statusCode;
}

/**
 * Send (or renew) a subscribe request for a feed that advertises a hub.
 * Generates and persists the secret/callback token on first use. A first-time
 * subscribe moves inactive -> pending; a failed POST drops back to inactive
 * so the next poll retries. Renewals keep state 'active' (the verification
 * updates the lease). Never throws.
 */
export async function subscribeToHub(feed: FeedRow): Promise<void> {
  if (!env.PUBLIC_URL || !feed.websubHubUrl || !feed.websubTopicUrl) return;

  let { websubSecret: secret, websubCallbackToken: token } = feed;
  if (!secret || !token) {
    secret = secret ?? randomBytes(24).toString('hex');
    token = token ?? randomBytes(16).toString('hex');
    await db
      .update(feeds)
      .set({ websubSecret: secret, websubCallbackToken: token })
      .where(eq(feeds.id, feed.id));
  }

  const wasInactive = feed.websubState === 'inactive';
  if (wasInactive) {
    await db.update(feeds).set({ websubState: 'pending' }).where(eq(feeds.id, feed.id));
  }

  try {
    const status = await postToHub(feed.websubHubUrl, {
      'hub.mode': 'subscribe',
      'hub.topic': feed.websubTopicUrl,
      'hub.callback': callbackUrl(token)!,
      'hub.lease_seconds': String(LEASE_SECONDS_REQUESTED),
      'hub.secret': secret,
    });
    if (status < 200 || status >= 300) throw new Error(`hub answered HTTP ${status}`);
  } catch (err) {
    // Roll a failed first attempt back so the next poll retries.
    if (wasInactive) {
      await db.update(feeds).set({ websubState: 'inactive' }).where(eq(feeds.id, feed.id));
    }
    console.warn(
      `[websub] subscribe failed for ${feed.feedUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Best-effort unsubscribe, used when a feed stops advertising a hub. */
export async function unsubscribeFromHub(feed: FeedRow): Promise<void> {
  if (!env.PUBLIC_URL || !feed.websubHubUrl || !feed.websubTopicUrl || !feed.websubCallbackToken)
    return;
  try {
    await postToHub(feed.websubHubUrl, {
      'hub.mode': 'unsubscribe',
      'hub.topic': feed.websubTopicUrl,
      'hub.callback': callbackUrl(feed.websubCallbackToken)!,
    });
  } catch {
    // The lease will simply expire; the callback answers 404/410 meanwhile.
  }
}
