import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { feeds } from '../db/schema.js';
import { feedArticleRows, parseFeedString, storeNewArticles } from '../lib/feed-fetch.js';
import { verifySignature } from '../lib/websub.js';

/**
 * WebSub callback endpoints (SPEC-021). Unauthenticated by necessity (hubs
 * cannot log in); the unguessable token in the path is the capability, and
 * pushed content is additionally authenticated by HMAC signature.
 */

// Hub verification / denial request (W3C WebSub 5.2, 5.3).
const verifyQuerySchema = z.object({
  'hub.mode': z.enum(['subscribe', 'unsubscribe', 'denied']),
  'hub.topic': z.string().optional(),
  'hub.challenge': z.string().optional(),
  'hub.lease_seconds': z.coerce.number().int().positive().optional(),
});

async function feedByToken(token: string) {
  const [row] = await db
    .select()
    .from(feeds)
    .where(eq(feeds.websubCallbackToken, token))
    .limit(1);
  return row ?? null;
}

export async function websubRoutes(app: FastifyInstance): Promise<void> {
  // Raw bodies for signature verification, scoped to this plugin only.
  app.addContentTypeParser(
    ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'application/rdf+xml'],
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // Subscription verification (GET with hub.* query params). Big hubs can
  // burst; keep these off the global per-IP rate-limit budget.
  app.get<{ Params: { token: string } }>(
    '/websub/callback/:token',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const query = verifyQuerySchema.parse(request.query);
      const feed = await feedByToken(request.params.token);
      if (!feed) return reply.code(404).send();

      const mode = query['hub.mode'];
      if (mode === 'denied') {
        // Terminal until the advertised hub/topic changes (fetch resets it).
        await db
          .update(feeds)
          .set({ websubState: 'denied', websubLeaseExpiresAt: null })
          .where(eq(feeds.id, feed.id));
        return reply.code(200).send();
      }

      const challenge = query['hub.challenge'];
      if (!challenge) return reply.code(400).send();
      // The topic echo-check stops a hub binding our callback to a topic we
      // never asked for.
      if (query['hub.topic'] !== feed.websubTopicUrl) return reply.code(404).send();

      if (mode === 'subscribe') {
        if (feed.websubState !== 'pending' && feed.websubState !== 'active') {
          return reply.code(404).send();
        }
        const leaseSeconds = query['hub.lease_seconds'] ?? 0;
        await db
          .update(feeds)
          .set({
            websubState: 'active',
            websubLeaseExpiresAt: leaseSeconds
              ? new Date(Date.now() + leaseSeconds * 1000)
              : null,
          })
          .where(eq(feeds.id, feed.id));
        return reply.code(200).type('text/plain').send(challenge);
      }

      // mode === 'unsubscribe': agree only when we actually want out.
      if (feed.websubState !== 'inactive') return reply.code(404).send();
      return reply.code(200).type('text/plain').send(challenge);
    },
  );

  // Content distribution (W3C WebSub 7): the hub POSTs the feed document.
  app.post<{ Params: { token: string } }>(
    '/websub/callback/:token',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const feed = await feedByToken(request.params.token);
      // 410 tells the hub the subscription is gone for good (deleted feed).
      if (!feed) return reply.code(410).send();

      const body = request.body;
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
      const signature = request.headers['x-hub-signature'];
      const valid =
        feed.websubSecret !== null &&
        verifySignature(feed.websubSecret, Array.isArray(signature) ? signature[0] : signature, raw);
      if (!valid) {
        // Per spec 7.1: still 2xx (so the hub does not retry) but ignore.
        request.log.warn({ feedId: feed.id }, 'websub push with missing/invalid signature ignored');
        return reply.code(200).send();
      }

      try {
        const parsed = await parseFeedString(raw.toString('utf8'));
        await storeNewArticles(feed.id, feedArticleRows(feed.id, parsed));
        await db
          .update(feeds)
          .set({ lastFetchedAt: new Date(), lastError: null, failureCount: 0 })
          .where(eq(feeds.id, feed.id));
      } catch {
        // Thin or mangled ping: schedule an immediate poll instead (null
        // lastFetchedAt makes findDueFeeds pick the feed up next tick).
        await db.update(feeds).set({ lastFetchedAt: null }).where(eq(feeds.id, feed.id));
      }
      return reply.code(200).send();
    },
  );
}
