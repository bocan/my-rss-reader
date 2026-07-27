import { importOpmlSchema, type ImportOpmlResult } from '@rss/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { feeds, folders, subscriptions } from '../db/schema.js';
import { env } from '../env.js';
import { fetchAndStoreFeed, normalizeFeedUrl } from '../lib/feed-fetch.js';
import {
  buildOpml,
  OpmlParseError,
  parseOpml,
  type OpmlFolderNode,
  type OpmlOutline,
} from '../lib/opml.js';
import { renormalizeFolderScope, renormalizeSubscriptionScope } from '../lib/ordering.js';

/** Bounded parallelism so a few hundred feeds do not open hundreds of sockets. */
const IMPORT_CONCURRENCY = 5;

async function mapWithLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      if (item !== undefined) await run(item);
    }
  });
  await Promise.all(workers);
}

/** One subscription to create, already resolved to its destination folder. */
interface PendingFeed {
  title: string | null;
  xmlUrl: string;
  folderId: string | null;
}

export async function opmlRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  app.post(
    '/opml/import',
    { ...auth, bodyLimit: env.OPML_MAX_BYTES + 64 * 1024 },
    async (request, reply) => {
      const input = importOpmlSchema.parse(request.body);
      const userId = request.user!.id;

      if (Buffer.byteLength(input.opml, 'utf8') > env.OPML_MAX_BYTES) {
        return reply.code(413).send({
          error: 'opml_too_large',
          message: `OPML exceeds ${env.OPML_MAX_BYTES} bytes`,
          statusCode: 413,
        });
      }

      let tree: OpmlOutline[];
      try {
        tree = parseOpml(input.opml);
      } catch (err) {
        return reply.code(400).send({
          error: 'invalid_opml',
          message: err instanceof OpmlParseError ? err.message : 'Could not parse OPML',
          statusCode: 400,
        });
      }

      const result: ImportOpmlResult = {
        foldersCreated: 0,
        feedsAdded: 0,
        skipped: 0,
        failed: [],
      };
      const pending: PendingFeed[] = [];
      const touchedFolderScopes = new Set<string | null>();

      /** Find-or-create a folder by case-insensitive name under a parent. */
      async function ensureFolder(name: string, parentId: string | null): Promise<string> {
        const [existing] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.userId, userId),
              parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
              sql`lower(${folders.name}) = lower(${name})`,
            ),
          )
          .limit(1);
        if (existing) return existing.id;

        const [created] = await db
          .insert(folders)
          .values({ userId, name, parentId })
          .returning({ id: folders.id });
        result.foldersCreated++;
        touchedFolderScopes.add(parentId);
        return created!.id;
      }

      /**
       * Walk the outline tree. Depth is capped at one level (SPEC-007), so
       * outlines nested deeper attach to the nearest created folder rather than
       * being dropped.
       */
      async function walk(outlines: OpmlOutline[], folderId: string | null, depth: number) {
        for (const outline of outlines) {
          if (outline.xmlUrl) {
            // Canonical form so an OPML variant of an already-known feed
            // (trailing slash, host case) matches its existing row.
            pending.push({ title: outline.title, xmlUrl: normalizeFeedUrl(outline.xmlUrl), folderId });
            continue;
          }
          // No xmlUrl but a htmlUrl and no children: a bare link we cannot
          // resolve without interactive discovery.
          if (outline.htmlUrl && outline.children.length === 0) {
            result.failed.push({
              title: outline.title,
              xmlUrl: null,
              reason: 'Outline has no xmlUrl',
            });
            continue;
          }
          if (!outline.title) {
            await walk(outline.children, folderId, depth);
            continue;
          }
          // Folder. Only nest one level; deeper outlines reuse this folder.
          const targetId =
            depth === 0 ? await ensureFolder(outline.title, null)
            : depth === 1 ? await ensureFolder(outline.title, folderId)
            : folderId;
          await walk(outline.children, targetId, depth + 1);
        }
      }

      await walk(tree, null, 0);

      await mapWithLimit(pending, IMPORT_CONCURRENCY, async (item) => {
        try {
          const [existingFeed] = await db
            .select()
            .from(feeds)
            .where(eq(feeds.feedUrl, item.xmlUrl))
            .limit(1);

          let feedId: string;
          if (existingFeed) {
            feedId = existingFeed.id;
          } else {
            const [inserted] = await db
              .insert(feeds)
              .values({ feedUrl: item.xmlUrl })
              .onConflictDoUpdate({ target: feeds.feedUrl, set: { updatedAt: new Date() } })
              .returning();
            feedId = inserted!.id;
            // Populate metadata + initial articles. Records fetch errors on the
            // row rather than throwing, matching POST /feeds.
            await fetchAndStoreFeed(inserted!);

            // Reject a brand-new feed whose very first fetch failed (unreachable,
            // not a feed, unparseable): don't import it, and drop the orphan row
            // if nobody else has raced a subscription onto it.
            const [after] = await db
              .select({ lastError: feeds.lastError })
              .from(feeds)
              .where(eq(feeds.id, feedId))
              .limit(1);
            if (after?.lastError) {
              const others = await db
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(eq(subscriptions.feedId, feedId))
                .limit(1);
              if (others.length === 0) await db.delete(feeds).where(eq(feeds.id, feedId));
              result.failed.push({
                title: item.title,
                xmlUrl: item.xmlUrl,
                reason: after.lastError,
              });
              return;
            }
          }

          const [alreadySubscribed] = await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
            .limit(1);
          if (alreadySubscribed) {
            result.skipped++;
            return;
          }

          // An OPML that lists the same feed twice (or an import racing a
          // concurrent subscribe) must count as a skip, not surface a
          // unique-violation error in the failed list.
          const inserted = await db
            .insert(subscriptions)
            .values({
              userId,
              feedId,
              folderId: item.folderId,
              customTitle: item.title,
            })
            .onConflictDoNothing({ target: [subscriptions.userId, subscriptions.feedId] })
            .returning({ id: subscriptions.id });
          if (inserted.length > 0) result.feedsAdded++;
          else result.skipped++;
        } catch (err) {
          result.failed.push({
            title: item.title,
            xmlUrl: item.xmlUrl,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // Close position gaps in every scope the import touched.
      await db.transaction(async (tx) => {
        for (const scope of touchedFolderScopes) {
          await renormalizeFolderScope(tx, userId, scope);
        }
        for (const scope of new Set(pending.map((p) => p.folderId))) {
          await renormalizeSubscriptionScope(tx, userId, scope);
        }
      });

      return result;
    },
  );

  app.get('/opml/export', auth, async (request, reply) => {
    const userId = request.user!.id;

    const folderRows = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(asc(folders.position), asc(folders.createdAt));

    const subRows = await db
      .select({
        folderId: subscriptions.folderId,
        customTitle: subscriptions.customTitle,
        title: feeds.title,
        feedUrl: feeds.feedUrl,
        siteUrl: feeds.siteUrl,
      })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(eq(subscriptions.userId, userId))
      .orderBy(asc(subscriptions.position), asc(subscriptions.createdAt));

    const feedsFor = (folderId: string | null) =>
      subRows
        .filter((s) => s.folderId === folderId)
        .map((s) => ({
          title: s.customTitle ?? s.title ?? s.feedUrl,
          xmlUrl: s.feedUrl,
          htmlUrl: s.siteUrl,
        }));

    const buildFolder = (id: string, name: string): OpmlFolderNode => ({
      title: name,
      folders: folderRows
        .filter((f) => f.parentId === id)
        .map((child) => buildFolder(child.id, child.name)),
      feeds: feedsFor(id),
    });

    const xml = buildOpml({
      folders: folderRows
        .filter((f) => f.parentId === null)
        .map((f) => buildFolder(f.id, f.name)),
      feeds: feedsFor(null),
    });

    return reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="reader-subscriptions.opml"')
      .send(xml);
  });
}
