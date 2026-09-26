import {
  changeFeedUrlSchema,
  createFolderSchema,
  discoverFeedsQuerySchema,
  restoreSubscriptionSchema,
  subscribeSchema,
  updateFolderSchema,
  updateSubscriptionSchema,
} from '@rss/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { feeds, folders, subscriptions } from '../db/schema.js';
import { discoverFeedCandidates, fetchAndStoreFeed, normalizeFeedUrl } from '../lib/feed-fetch.js';
import { applyRulesToNewSubscription } from '../lib/rules.js';
import {
  placeFolder,
  placeSubscription,
  renormalizeFolderScope,
  renormalizeSubscriptionScope,
} from '../lib/ordering.js';
import { getUnreadCountsByFeed } from '../lib/unread-counts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: 'NotFound', message: 'Not found', statusCode: 404 } as const;

/** The GET /feeds columns for one subscription (without its unread count). */
const subscriptionColumns = {
  subscriptionId: subscriptions.id,
  feedId: feeds.id,
  title: feeds.title,
  customTitle: subscriptions.customTitle,
  feedUrl: feeds.feedUrl,
  siteUrl: feeds.siteUrl,
  faviconUrl: feeds.faviconUrl,
  folderId: subscriptions.folderId,
  position: subscriptions.position,
  viewMode: subscriptions.viewMode,
  sortOrder: subscriptions.sortOrder,
  articleView: subscriptions.articleView,
  hideFromAll: subscriptions.hideFromAll,
  inBlogroll: subscriptions.inBlogroll,
  attention: subscriptions.attention,
  fetchIntervalSec: feeds.fetchIntervalSec,
  websubState: feeds.websubState,
  websubLeaseExpiresAt: feeds.websubLeaseExpiresAt,
  lastFetchedAt: feeds.lastFetchedAt,
  lastError: feeds.lastError,
  // #29: how long a broken feed has been broken.
  lastSuccessAt: feeds.lastSuccessAt,
};

/** The GET /feeds row shape for one subscription, including its unread count. */
async function subscriptionRow(subscriptionId: string, userId: string) {
  const [row] = await db
    .select(subscriptionColumns)
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (!row) return null;
  const counts = await getUnreadCountsByFeed(userId);
  return { ...row, unreadCount: counts.find((c) => c.feedId === row.feedId)?.unreadCount ?? 0 };
}

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  // Everything here requires a signed-in user.
  const auth = { preHandler: app.requireAuth };

  // List the current user's subscriptions with feed metadata.
  app.get('/feeds', auth, async (request) => {
    const rows = await db
      .select(subscriptionColumns)
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(eq(subscriptions.userId, request.user!.id))
      .orderBy(asc(subscriptions.position), asc(subscriptions.createdAt));

    // Merge per-feed unread counts (same helper GET /counts uses, so they agree).
    const counts = await getUnreadCountsByFeed(request.user!.id);
    const countByFeed = new Map(counts.map((c) => [c.feedId, c.unreadCount]));
    return {
      items: rows.map((r) => ({ ...r, unreadCount: countByFeed.get(r.feedId) ?? 0 })),
    };
  });

  // Force-fetch all of the caller's feeds right now, bypassing per-feed poll
  // intervals (the "Fetch now" button). Bounded concurrency; returns when done
  // so the client can refresh its views and see errors/new articles immediately.
  app.post('/feeds/refresh', auth, async (request) => {
    const userId = request.user!.id;
    const subs = await db
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    const feedIds = [...new Set(subs.map((s) => s.feedId))];
    if (feedIds.length === 0) return { refreshed: 0 };

    const feedRows = await db.select().from(feeds).where(inArray(feeds.id, feedIds));
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < feedRows.length) {
        const feed = feedRows[index++];
        if (feed) await fetchAndStoreFeed(feed); // records errors on the row, never throws
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, feedRows.length) }, worker));
    return { refreshed: feedRows.length };
  });

  // Fetch one of the caller's feeds right now ("Retry now", #29). Returns the
  // subscription row afterwards, with the new error or none.
  app.post('/feeds/:id/refresh', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);
    const [row] = await db
      .select({ feed: feeds })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!row) return reply.code(404).send(notFound);
    await fetchAndStoreFeed(row.feed); // records errors on the row, never throws
    return (await subscriptionRow(id, userId))!;
  });

  // Discover feed candidates for a URL (feed or homepage). Writes nothing.
  app.get('/feeds/discover', auth, async (request) => {
    const { url } = discoverFeedsQuerySchema.parse(request.query);
    const candidates = await discoverFeedCandidates(url);
    return { candidates };
  });

  // Subscribe to a feed or homepage URL. Resolves the real feed, fetches it once
  // synchronously so metadata + initial articles are populated on return, and
  // deduplicates the global feed row across users.
  app.post('/feeds', auth, async (request, reply) => {
    const input = subscribeSchema.parse(request.body);
    const userId = request.user!.id;
    // Canonical form so slash/case variants of a known feed match its row.
    const inputUrl = normalizeFeedUrl(input.url);

    // Fast path: an existing feed for the pasted URL. Skip discovery + fetch.
    let feedRow = (
      await db.select().from(feeds).where(eq(feeds.feedUrl, inputUrl)).limit(1)
    )[0];

    if (!feedRow) {
      const candidates = await discoverFeedCandidates(inputUrl);
      if (candidates.length === 0) {
        return reply.code(422).send({
          error: 'no_feed_found',
          message: 'No feed found at that URL.',
          statusCode: 422,
        });
      }
      if (candidates.length > 1) {
        // Superset of ApiError so the field survives the client error wrapper.
        return reply.code(409).send({
          error: 'ambiguous_feed',
          message: 'Multiple feeds found; choose one.',
          statusCode: 409,
          candidates,
        });
      }

      const feedUrl = normalizeFeedUrl(candidates[0]!.feedUrl);
      // The resolved URL may already exist (homepage pasted, feed already known).
      const existing = (
        await db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl)).limit(1)
      )[0];
      if (existing) {
        feedRow = existing;
      } else {
        const [inserted] = await db
          .insert(feeds)
          .values({ feedUrl })
          .onConflictDoUpdate({ target: feeds.feedUrl, set: { updatedAt: new Date() } })
          .returning();
        await fetchAndStoreFeed(inserted!);
        feedRow = (await db.select().from(feeds).where(eq(feeds.id, inserted!.id)).limit(1))[0]!;
      }
    }

    const [subscription] = await db
      .insert(subscriptions)
      .values({
        userId,
        feedId: feedRow.id,
        folderId: input.folderId ?? null,
        customTitle: input.title ?? null,
      })
      .onConflictDoNothing({ target: [subscriptions.userId, subscriptions.feedId] })
      .returning();
    // The feed's articles were stored before this user subscribed, so their
    // filter rules have not seen them yet (SPEC-025).
    if (subscription) await applyRulesToNewSubscription(userId, feedRow.id);

    return reply.code(201).send({ subscription: subscription ?? null, feed: feedRow });
  });

  // Move / rename / reorder a subscription. :id is the subscription id.
  // Returns the enriched row (same shape as a GET /feeds item) so the client can
  // splice it straight into its cache.
  app.patch('/feeds/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateSubscriptionSchema.parse(request.body);
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);

    const [current] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!current) return reply.code(404).send(notFound);

    // The poll interval is on the shared feed, so it changes the feed for every
    // subscriber. Only an admin may set it (#38). The first account is always
    // an admin, so a single-user install keeps full control.
    if (input.fetchIntervalSec !== undefined && request.user!.role !== 'admin') {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Only an administrator can change how often a feed is polled',
        statusCode: 403,
      });
    }

    // Validate the destination folder before any write. null moves to root.
    if (input.folderId != null) {
      const [target] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.userId, userId)))
        .limit(1);
      if (!target) {
        return reply
          .code(400)
          .send({ error: 'invalid_folder', message: 'Unknown folder', statusCode: 400 });
      }
    }

    const oldFolderId = current.folderId;
    const newFolderId = input.folderId !== undefined ? input.folderId : oldFolderId;

    await db.transaction(async (tx) => {
      const changes: Partial<typeof subscriptions.$inferInsert> = {};
      if (input.title !== undefined) changes.customTitle = input.title;
      if (input.folderId !== undefined) changes.folderId = input.folderId;
      if (input.viewMode !== undefined) changes.viewMode = input.viewMode;
      if (input.sortOrder !== undefined) changes.sortOrder = input.sortOrder;
      if (input.articleView !== undefined) changes.articleView = input.articleView;
      if (input.hideFromAll !== undefined) changes.hideFromAll = input.hideFromAll;
      if (input.inBlogroll !== undefined) changes.inBlogroll = input.inBlogroll;
      if (input.attention !== undefined) changes.attention = input.attention;
      if (Object.keys(changes).length > 0) {
        await tx.update(subscriptions).set(changes).where(eq(subscriptions.id, id));
      }
      // The poll interval lives on the shared feed, so this affects everyone
      // subscribed to it (admins only, checked above).
      if (input.fetchIntervalSec !== undefined) {
        await tx
          .update(feeds)
          .set({ fetchIntervalSec: input.fetchIntervalSec })
          .where(eq(feeds.id, current.feedId));
      }
      // Renormalize the scope it left, then place it in its destination. Only on
      // a move: with no position, placeSubscription appends, so a rename would
      // send the feed to the bottom of a manually ordered folder (#27).
      if (newFolderId !== oldFolderId) {
        await renormalizeSubscriptionScope(tx, userId, oldFolderId);
      }
      if (newFolderId !== oldFolderId || input.position !== undefined) {
        await placeSubscription(tx, userId, id, newFolderId, input.position);
      }
    });

    return (await subscriptionRow(id, userId))!;
  });

  // Re-point a subscription at a feed hosted at a new URL (e.g. a feed that
  // moved). Feeds are global/deduplicated, so this finds-or-creates the target
  // feed, validates it by fetching, moves the subscription, and drops the old
  // feed when it is left with no subscribers. Never mutates a shared feed's URL.
  app.patch<{ Params: { id: string } }>('/feeds/:id/url', auth, async (request, reply) => {
    const { id } = request.params;
    const feedUrl = normalizeFeedUrl(changeFeedUrlSchema.parse(request.body).feedUrl);
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);

    const [sub] = await db
      .select({ feedId: subscriptions.feedId, currentUrl: feeds.feedUrl })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!sub) return reply.code(404).send(notFound);
    if (sub.currentUrl === feedUrl) return (await subscriptionRow(id, userId))!; // no-op

    // Resolve the target feed, creating and validating it when new.
    let [target] = await db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl)).limit(1);
    if (!target) {
      const [created] = await db
        .insert(feeds)
        .values({ feedUrl })
        .onConflictDoUpdate({ target: feeds.feedUrl, set: { updatedAt: new Date() } })
        .returning();
      await fetchAndStoreFeed(created!);
      [target] = await db.select().from(feeds).where(eq(feeds.id, created!.id)).limit(1);
      if (target!.lastError) {
        // Not a valid/reachable feed: drop the orphan row we just made and reject.
        const [used] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.feedId, target!.id))
          .limit(1);
        if (!used) await db.delete(feeds).where(eq(feeds.id, target!.id));
        return reply.code(422).send({
          error: 'invalid_feed',
          message: `Could not fetch a valid feed at that URL: ${target!.lastError}`,
          statusCode: 422,
        });
      }
    } else if (target.lastFetchedAt === null) {
      await fetchAndStoreFeed(target);
    }

    if (target!.id === sub.feedId) return (await subscriptionRow(id, userId))!;

    // Guard the (userId, feedId) unique index.
    const [dupe] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, target!.id)))
      .limit(1);
    if (dupe) {
      return reply.code(409).send({
        error: 'already_subscribed',
        message: 'You are already subscribed to the feed at that URL',
        statusCode: 409,
      });
    }

    const oldFeedId = sub.feedId;
    await db.update(subscriptions).set({ feedId: target!.id }).where(eq(subscriptions.id, id));

    // Drop the previous feed if this was its last subscriber.
    const [stillUsed] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, oldFeedId))
      .limit(1);
    if (!stillUsed) await db.delete(feeds).where(eq(feeds.id, oldFeedId));

    return (await subscriptionRow(id, userId))!;
  });

  // Unsubscribe (removes only this user's subscription, not the shared feed).
  app.delete('/feeds/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, request.user!.id)));
    return reply.code(204).send();
  });

  // Undo an unsubscribe (#16). The feed row outlives its subscribers, so this
  // subscribes again by feed id with the old settings, and puts the feed back
  // in its place. A folder deleted in the meantime falls back to the root.
  // Returns the GET /feeds row shape.
  app.post('/feeds/restore', auth, async (request, reply) => {
    const input = restoreSubscriptionSchema.parse(request.body);
    const userId = request.user!.id;

    const [feed] = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(eq(feeds.id, input.feedId))
      .limit(1);
    if (!feed) return reply.code(404).send(notFound);

    let folderId = input.folderId;
    if (folderId) {
      const [folder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
        .limit(1);
      if (!folder) folderId = null;
    }

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(subscriptions)
        .values({
          userId,
          feedId: input.feedId,
          folderId,
          customTitle: input.title,
          viewMode: input.viewMode,
          sortOrder: input.sortOrder,
          articleView: input.articleView,
          hideFromAll: input.hideFromAll,
          inBlogroll: input.inBlogroll,
          attention: input.attention,
        })
        .onConflictDoNothing({ target: [subscriptions.userId, subscriptions.feedId] })
        .returning({ id: subscriptions.id });
      if (!row) return null;
      await placeSubscription(tx, userId, row.id, folderId, input.position);
      return row.id;
    });
    if (!id) {
      return reply.code(409).send({
        error: 'already_subscribed',
        message: 'You are already subscribed to that feed',
        statusCode: 409,
      });
    }

    return reply.code(201).send((await subscriptionRow(id, userId))!);
  });

  // --- Folders ---

  app.get('/folders', auth, async (request) => {
    const rows = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, request.user!.id))
      .orderBy(asc(folders.position), asc(folders.createdAt));
    return { items: rows };
  });

  app.post('/folders', auth, async (request, reply) => {
    const input = createFolderSchema.parse(request.body);
    const userId = request.user!.id;
    const parentId = input.parentId ?? null;
    // The same one-level rule as PATCH (#28): the parent must be the user's own
    // root folder.
    if (parentId !== null) {
      const [parent] = await db
        .select({ parentId: folders.parentId })
        .from(folders)
        .where(and(eq(folders.id, parentId), eq(folders.userId, userId)))
        .limit(1);
      const message = !parent
        ? 'Unknown parent folder'
        : parent.parentId !== null
          ? 'Folders can only nest one level deep'
          : null;
      if (message) {
        return reply.code(400).send({ error: 'invalid_parent', message, statusCode: 400 });
      }
    }
    const folder = await db.transaction(async (tx) => {
      const [row] = await tx.insert(folders).values({ userId, name: input.name, parentId }).returning();
      // Last in its scope, not tied at 0 with the first folder (manual order, #27).
      await placeFolder(tx, userId, row!.id, parentId);
      const [placed] = await tx.select().from(folders).where(eq(folders.id, row!.id)).limit(1);
      return placed!;
    });
    return reply.code(201).send(folder);
  });

  // Rename / reparent / reorder a folder. Nesting is capped at one level: a
  // folder may sit under a root folder, never under an already-nested one.
  // (If deeper nesting is ever wanted, this check and the client's drop
  // eligibility must both switch to a real ancestor walk.)
  app.patch('/folders/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateFolderSchema.parse(request.body);
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);

    const [current] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .limit(1);
    if (!current) return reply.code(404).send(notFound);

    const invalidParent = (message: string) =>
      reply.code(400).send({ error: 'invalid_parent', message, statusCode: 400 });

    // All validation before any write.
    if (input.parentId != null) {
      if (input.parentId === id) return invalidParent('A folder cannot be its own parent');

      const [parent] = await db
        .select({ id: folders.id, parentId: folders.parentId })
        .from(folders)
        .where(and(eq(folders.id, input.parentId), eq(folders.userId, userId)))
        .limit(1);
      if (!parent) return invalidParent('Unknown parent folder');
      if (parent.parentId !== null) return invalidParent('Folders can only nest one level deep');

      // Moving a folder that has children would push them to depth 2.
      const children = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.parentId, id), eq(folders.userId, userId)))
        .limit(1);
      if (children.length > 0) {
        return invalidParent('A folder with child folders cannot be nested');
      }
    }

    const oldParentId = current.parentId;
    const newParentId = input.parentId !== undefined ? input.parentId : oldParentId;

    await db.transaction(async (tx) => {
      const changes: Partial<typeof folders.$inferInsert> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.parentId !== undefined) changes.parentId = input.parentId;
      if (input.viewMode !== undefined) changes.viewMode = input.viewMode;
      if (input.sortOrder !== undefined) changes.sortOrder = input.sortOrder;
      if (Object.keys(changes).length > 0) {
        await tx.update(folders).set(changes).where(eq(folders.id, id));
      }
      if (newParentId !== oldParentId) {
        await renormalizeFolderScope(tx, userId, oldParentId);
      }
      // Re-place only on a move. With no position, placeFolder appends, so a
      // rename or a view change would otherwise send the folder to the end.
      if (input.parentId !== undefined || input.position !== undefined) {
        await placeFolder(tx, userId, id, newParentId, input.position);
      }
    });

    const [updated] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
    return updated!;
  });

  // Delete a folder WITHOUT deleting its contents. Its subscriptions and child
  // folders are promoted to the folder's own parent (root for a top-level
  // folder) first, so the ON DELETE cascade on folders.parentId never fires on
  // real data and the ON DELETE set null on subscriptions.folderId is moot.
  app.delete('/folders/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);

    const [current] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .limit(1);
    if (!current) return reply.code(404).send(notFound);

    const grandparentId = current.parentId;

    await db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({ folderId: grandparentId })
        .where(and(eq(subscriptions.folderId, id), eq(subscriptions.userId, userId)));
      await tx
        .update(folders)
        .set({ parentId: grandparentId })
        .where(and(eq(folders.parentId, id), eq(folders.userId, userId)));
      await tx.delete(folders).where(and(eq(folders.id, id), eq(folders.userId, userId)));
      // Close the gaps the promotions left behind.
      await renormalizeFolderScope(tx, userId, grandparentId);
      await renormalizeSubscriptionScope(tx, userId, grandparentId);
    });

    return reply.code(204).send();
  });
}
