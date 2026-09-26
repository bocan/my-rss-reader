import type { UnreadCounts } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { folders, subscriptions } from '../db/schema.js';
import { getUnreadCountsByFeed } from '../lib/unread-counts.js';

export async function countsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  // Per-feed, per-folder, and total unread counts for the sidebar. Folder and
  // total values are rolled up in application code from the per-feed counts, so
  // they can never drift from GET /feeds (which uses the same helper).
  app.get('/counts', auth, async (request) => {
    const userId = request.user!.id;
    const feedCounts = await getUnreadCountsByFeed(userId);

    const subs = await db
      .select({
        feedId: subscriptions.feedId,
        folderId: subscriptions.folderId,
        hideFromAll: subscriptions.hideFromAll,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    const folderByFeed = new Map(subs.map((s) => [s.feedId, s.folderId]));
    const hiddenFromAll = new Set(subs.filter((s) => s.hideFromAll).map((s) => s.feedId));
    // A folder's badge covers its child folders too (#25); one level deep.
    const parentOf = new Map(
      (
        await db
          .select({ id: folders.id, parentId: folders.parentId })
          .from(folders)
          .where(eq(folders.userId, userId))
      ).map((f) => [f.id, f.parentId]),
    );

    // `total` backs the All-items badge, so it excludes hidden feeds (SPEC-018)
    // and firehose-tier feeds (SPEC-022); firehose feeds are excluded from
    // folder badges too. Their per-feed count (already expiry-adjusted) still
    // ships so the feed's own header shows an honest number when opened.
    const folderTotals = new Map<string, number>();
    let total = 0;
    for (const { feedId, attention, unreadCount } of feedCounts) {
      const firehose = attention === 'firehose';
      if (!hiddenFromAll.has(feedId) && !firehose) total += unreadCount;
      const folderId = folderByFeed.get(feedId);
      if (folderId && !firehose) {
        for (const id of [folderId, parentOf.get(folderId)]) {
          if (id) folderTotals.set(id, (folderTotals.get(id) ?? 0) + unreadCount);
        }
      }
    }

    return {
      feeds: feedCounts.map(({ feedId, unreadCount }) => ({ feedId, unreadCount })),
      folders: [...folderTotals].map(([folderId, unreadCount]) => ({ folderId, unreadCount })),
      total,
    } satisfies UnreadCounts;
  });
}
