import {
  articleQuerySchema,
  markReadSchema,
  readableQuerySchema,
  updateArticleStateSchema,
  type Paginated,
} from '@rss/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { articles, articleStates, feeds, subscriptions } from '../db/schema.js';
import {
  decodeCursor,
  decodeSearchCursor,
  encodeCursor,
  encodeSearchCursor,
  type CursorPayload,
  type SearchCursorPayload,
} from '../lib/cursor.js';
import { resolveSubscribedFeedIds } from '../lib/feed-scope.js';
import { extractReadableHtml } from '../lib/readability.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Load one article for a user, scoped to their subscriptions (inner join on
 * subscriptions enforces access). Returns null when the id is malformed, the
 * article does not exist, or the user is not subscribed to its feed - all of
 * which the caller maps to an indistinguishable 404.
 */
async function loadArticleDetail(userId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      author: articles.author,
      url: articles.url,
      contentHtml: articles.contentHtml,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      readableHtml: articles.readableHtml,
      readableFetchedAt: articles.readableFetchedAt,
      feedId: feeds.id,
      feedTitle: feeds.title,
      feedSiteUrl: feeds.siteUrl,
      feedFaviconUrl: feeds.faviconUrl,
      read: sql<boolean>`coalesce(${articleStates.read}, false)`,
      starred: sql<boolean>`coalesce(${articleStates.starred}, false)`,
    })
    .from(articles)
    .innerJoin(feeds, eq(articles.feedId, feeds.id))
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.feedId, articles.feedId), eq(subscriptions.userId, userId)),
    )
    .leftJoin(
      articleStates,
      and(eq(articleStates.articleId, articles.id), eq(articleStates.userId, userId)),
    )
    .where(eq(articles.id, id))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    url: r.url,
    contentHtml: r.contentHtml,
    summary: r.summary,
    publishedAt: r.publishedAt,
    readableHtml: r.readableHtml,
    readableFetchedAt: r.readableFetchedAt,
    feed: {
      id: r.feedId,
      title: r.feedTitle,
      siteUrl: r.feedSiteUrl,
      faviconUrl: r.feedFaviconUrl,
    },
    read: r.read,
    starred: r.starred,
  };
}

const notFound = { error: 'NotFound', message: 'Article not found', statusCode: 404 } as const;
const badCursor = { error: 'Bad Request', message: 'Invalid cursor', statusCode: 400 } as const;

// Rank-ordered keyset re-scans the match set per page, so cap total search
// depth (10 pages at the default limit of 50).
const SEARCH_RESULT_CAP = 500;

export async function articleRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  // Keyset-paginated list of articles across the caller's subscriptions.
  // Effective sort key is coalesce(publishedAt, fetchedAt) (never null since
  // fetchedAt is NOT NULL), with id as a strict, unique tiebreaker.
  //
  // When `q` is present the route switches to relevance mode: results are
  // ordered by ts_rank DESC, id DESC, pagination uses a (rank, id) cursor, and
  // `sort` is IGNORED (relevance and chronology cannot share one cursor).
  app.get('/articles', auth, async (request, reply) => {
    const query = articleQuerySchema.parse(request.query);
    const userId = request.user!.id;
    const isSearch = query.q !== undefined;

    // Decode the cursor for the active mode. A chronological cursor sent with
    // `q` (or a search cursor sent without it) fails its decoder -> 400.
    let decoded: CursorPayload | null = null;
    let searchCursor: SearchCursorPayload | null = null;
    if (query.cursor) {
      if (isSearch) {
        searchCursor = decodeSearchCursor(query.cursor);
        if (!searchCursor) return reply.code(400).send(badCursor);
      } else {
        decoded = decodeCursor(query.cursor);
        if (!decoded) return reply.code(400).send(badCursor);
      }
    }

    // Resolve the caller's feed ids, always scoped by userId, optionally
    // narrowed by feedId and/or folderId.
    const subFilters = [eq(subscriptions.userId, userId)];
    if (query.feedId) subFilters.push(eq(subscriptions.feedId, query.feedId));
    if (query.folderId) subFilters.push(eq(subscriptions.folderId, query.folderId));
    // Hidden feeds drop out of the All-items firehose only; an explicit feed,
    // folder, starred, or search scope still includes them (SPEC-018).
    const isAllItems = !query.feedId && !query.folderId && !query.starred && !isSearch;
    if (isAllItems) subFilters.push(eq(subscriptions.hideFromAll, false));
    const subs = await db
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .where(and(...subFilters));
    const feedIds = subs.map((s) => s.feedId);

    if (feedIds.length === 0) {
      return { items: [], nextCursor: null } satisfies Paginated<never>;
    }

    const sortKey = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;

    const filters = [inArray(articles.feedId, feedIds)];
    if (query.unread !== undefined) {
      // No state row means unread; treat missing rows as read=false.
      filters.push(sql`coalesce(${articleStates.read}, false) = ${!query.unread}`);
    }
    if (query.starred) {
      filters.push(sql`coalesce(${articleStates.starred}, false) = true`);
    }
    // websearch_to_tsquery understands "exact phrase", -exclude and OR, and
    // never throws on malformed input. An all-stopword query yields an empty
    // tsquery that matches nothing, so search simply returns no rows.
    const tsQuery = sql`websearch_to_tsquery('english', ${query.q ?? ''})`;
    // ::float8 so the cursor comparison is exact (ts_rank returns float4).
    const rankExpr = sql<number>`ts_rank(${articles.searchVector}, ${tsQuery})::float8`;

    if (isSearch) {
      filters.push(sql`${articles.searchVector} @@ ${tsQuery}`);
      if (searchCursor) {
        filters.push(
          sql`(${rankExpr}, ${articles.id}) < (${searchCursor.r}::float8, ${searchCursor.id}::uuid)`,
        );
      }
    } else if (decoded) {
      // Row-value keyset continuation. (a, b) < (c, d) is a < c OR (a = c AND b < d).
      // Bind the cursor timestamp as text cast to timestamptz so the exact
      // (microsecond) value from the previous page is compared, not a truncated Date.
      filters.push(
        query.sort === 'oldest'
          ? sql`(coalesce(${articles.publishedAt}, ${articles.fetchedAt}), ${articles.id}) > (${decoded.t}::timestamptz, ${decoded.id}::uuid)`
          : sql`(coalesce(${articles.publishedAt}, ${articles.fetchedAt}), ${articles.id}) < (${decoded.t}::timestamptz, ${decoded.id}::uuid)`,
      );
    }

    const pageRows = await db
      .select({
        id: articles.id,
        feedId: articles.feedId,
        title: articles.title,
        url: articles.url,
        author: articles.author,
        summary: articles.summary,
        imageUrl: articles.imageUrl,
        publishedAt: articles.publishedAt,
        read: sql<boolean>`coalesce(${articleStates.read}, false)`,
        starred: sql<boolean>`coalesce(${articleStates.starred}, false)`,
        // ::text preserves the exact timestamp (microseconds) for the cursor.
        sortTs: sql<string>`coalesce(${articles.publishedAt}, ${articles.fetchedAt})::text`,
        // Rank is selected only in search mode, for the cursor; stripped below.
        ...(isSearch ? { rank: rankExpr } : {}),
      })
      .from(articles)
      .leftJoin(
        articleStates,
        and(eq(articleStates.articleId, articles.id), eq(articleStates.userId, userId)),
      )
      .where(and(...filters))
      .orderBy(
        isSearch
          ? sql`${rankExpr} desc, ${articles.id} desc`
          : query.sort === 'oldest'
            ? sql`${sortKey} asc, ${articles.id} asc`
            : sql`${sortKey} desc, ${articles.id} desc`,
      )
      .limit(query.limit + 1);

    const hasMore = pageRows.length > query.limit;
    const kept = hasMore ? pageRows.slice(0, query.limit) : pageRows;
    const last = kept.at(-1);

    let nextCursor: string | null = null;
    if (isSearch) {
      const seen = (searchCursor?.n ?? 0) + kept.length;
      if (hasMore && last && seen < SEARCH_RESULT_CAP) {
        nextCursor = encodeSearchCursor(Number(last.rank ?? 0), last.id, seen);
      }
    } else if (hasMore && last) {
      nextCursor = encodeCursor(last.sortTs, last.id);
    }

    const items = kept.map(({ sortTs, rank, ...rest }) => rest);
    return { items, nextCursor } satisfies Paginated<(typeof items)[number]>;
  });

  // Full article for the reading pane, scoped to the caller's subscriptions.
  app.get('/articles/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = await loadArticleDetail(request.user!.id, id);
    if (!detail) return reply.code(404).send(notFound);
    return detail;
  });

  // Read-through cache for the Simplified view. Extraction runs only here, only
  // on a cache miss (or ?refresh=true), and only for a subscribed article.
  app.get('/articles/:id/readable', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = readableQuerySchema.parse(request.query);

    const detail = await loadArticleDetail(request.user!.id, id);
    if (!detail) return reply.code(404).send(notFound);

    // Cache hit: an attempt already ran. Do not re-fetch (even if it failed).
    if (!query.refresh && detail.readableFetchedAt !== null) {
      return detail;
    }
    // Nothing to extract from.
    if (!detail.url) {
      return reply.code(422).send({
        error: 'UnprocessableEntity',
        message: 'Article has no source URL',
        statusCode: 422,
      });
    }

    const clean = await extractReadableHtml(detail.url);
    const readableFetchedAt = new Date();
    await db
      .update(articles)
      .set({ readableHtml: clean, readableFetchedAt })
      .where(eq(articles.id, id));

    return { ...detail, readableHtml: clean, readableFetchedAt };
  });

  // Bulk mark-as-read across a feed, a folder's feeds, or all subscriptions,
  // optionally only items older than `before`. One set-based statement.
  app.post('/articles/mark-read', auth, async (request, reply) => {
    const input = markReadSchema.parse(request.body);
    const userId = request.user!.id;

    // feedId wins over folderId; neither means all subscribed feeds.
    const feedIds = await resolveSubscribedFeedIds(userId, {
      feedId: input.feedId,
      folderId: input.folderId,
    });
    if (feedIds.length === 0) return reply.code(204).send(); // empty folder / no subs

    // Bind the feed ids as a single Postgres array literal param. (drizzle's sql
    // template expands a JS array into separate params, which breaks any(...).)
    // feedIds are DB-sourced uuids, so the literal is safe and still parameterized.
    const feedIdArray = `{${feedIds.join(',')}}`;

    // Undated articles fall back to fetched_at so `before` is deterministic.
    const beforeClause = input.before
      ? sql`and coalesce(a.published_at, a.fetched_at) < ${input.before}::timestamptz`
      : sql``;

    // The conflict guard (read = false) makes this idempotent: already-read
    // articles keep their original read_at, and starred/starred_at survive.
    await db.execute(sql`
      insert into article_states (user_id, article_id, read, read_at)
      select ${userId}::uuid, a.id, true, now()
      from articles a
      where a.feed_id = any(${feedIdArray}::uuid[]) ${beforeClause}
      on conflict (user_id, article_id) do update
        set read = true, read_at = now()
        where article_states.read = false
    `);

    return reply.code(204).send();
  });

  // Update read / starred state for a single article (upsert the state row).
  app.patch('/articles/:id/state', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateArticleStateSchema.parse(request.body);
    const userId = request.user!.id;
    const now = new Date();

    await db
      .insert(articleStates)
      .values({
        userId,
        articleId: id,
        read: input.read ?? false,
        starred: input.starred ?? false,
        readAt: input.read ? now : null,
        starredAt: input.starred ? now : null,
      })
      .onConflictDoUpdate({
        target: [articleStates.userId, articleStates.articleId],
        set: {
          ...(input.read !== undefined ? { read: input.read, readAt: input.read ? now : null } : {}),
          ...(input.starred !== undefined
            ? { starred: input.starred, starredAt: input.starred ? now : null }
            : {}),
        },
      });

    return reply.code(204).send();
  });
}
