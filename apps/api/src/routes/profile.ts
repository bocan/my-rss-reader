import {
  communityQuerySchema,
  SLUG_RE,
  updateProfileSchema,
  type CommunityShare,
  type Paginated,
  type ProfileDto,
  type ShareVisibility,
} from '@rss/shared';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { articles, articleStates, feeds, profiles, subscriptions, users } from '../db/schema.js';
import { env } from '../env.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';

/** Absolute base URL for public links: PUBLIC_URL, else the request origin. */
export function publicBase(request: FastifyRequest): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '');
  return `${request.protocol}://${request.host}`;
}

/** A plausible, SLUG_RE-conformant handle derived from the username. */
export function slugSuggestion(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return SLUG_RE.test(slug) ? slug : 'my-shares';
}

type ProfileRow = typeof profiles.$inferSelect;

function toDto(row: ProfileRow, base: string): ProfileDto {
  const visibility = row.visibility as ShareVisibility;
  return {
    slug: row.slug,
    title: row.title,
    bio: row.bio,
    visibility,
    shareUrl: visibility === 'public' ? `${base}/u/${row.slug}` : null,
  };
}

/** True when err is Postgres' unique-violation (SQLSTATE 23505). Drizzle
 *  wraps driver errors, so walk the cause chain for the code. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  // The caller's sharing profile; a suggestion (no row is created) when they
  // have never configured sharing.
  app.get('/profile', auth, async (request): Promise<ProfileDto> => {
    const [row] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, request.user!.id))
      .limit(1);
    if (row) return toDto(row, publicBase(request));
    return {
      slug: slugSuggestion(request.user!.username),
      title: null,
      bio: null,
      visibility: 'off',
      shareUrl: null,
    };
  });

  // Create-or-update the caller's profile. Slug collisions are a 409.
  app.put('/profile', auth, async (request, reply) => {
    const input = updateProfileSchema.parse(request.body);
    const userId = request.user!.id;
    const now = new Date();

    try {
      await db
        .insert(profiles)
        .values({
          userId,
          slug: input.slug ?? slugSuggestion(request.user!.username),
          title: input.title ?? null,
          bio: input.bio ?? null,
          visibility: input.visibility ?? 'off',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: {
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
            ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
            updatedAt: now,
          },
        });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({
          error: 'slug_taken',
          message: 'That address is already taken',
          statusCode: 409,
        });
      }
      throw err;
    }

    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return toDto(row!, publicBase(request));
  });

  // Recent shares from other users of this instance whose profile visibility
  // allows it. Keyset-paginated on (sharedAt, articleId), newest first.
  app.get('/shares/community', auth, async (request, reply) => {
    const query = communityQuerySchema.parse(request.query);
    const userId = request.user!.id;

    let cursor = null;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) {
        return reply
          .code(400)
          .send({ error: 'Bad Request', message: 'Invalid cursor', statusCode: 400 });
      }
    }

    const rows = await db
      .select({
        sharedAt: articleStates.sharedAt,
        note: articleStates.shareNote,
        displayName: users.displayName,
        slug: profiles.slug,
        articleId: articles.id,
        title: articles.title,
        url: articles.url,
        summary: articles.summary,
        publishedAt: articles.publishedAt,
        feedId: feeds.id,
        feedTitle: feeds.title,
        feedUrl: feeds.feedUrl,
        faviconUrl: feeds.faviconUrl,
        // ::text preserves microsecond precision for the cursor (SPEC-003).
        sortTs: sql<string>`${articleStates.sharedAt}::text`,
      })
      .from(articleStates)
      .innerJoin(users, and(eq(users.id, articleStates.userId), isNull(users.disabledAt)))
      .innerJoin(
        profiles,
        and(
          eq(profiles.userId, articleStates.userId),
          inArray(profiles.visibility, ['instance', 'public']),
        ),
      )
      .innerJoin(articles, eq(articles.id, articleStates.articleId))
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(
        and(
          eq(articleStates.shared, true),
          ne(articleStates.userId, userId),
          ...(cursor
            ? [
                sql`(${articleStates.sharedAt}, ${articles.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
              ]
            : []),
        ),
      )
      .orderBy(sql`${articleStates.sharedAt} desc, ${articles.id} desc`)
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const kept = hasMore ? rows.slice(0, query.limit) : rows;

    // Which source feeds the caller already follows, in one query.
    const feedIds = [...new Set(kept.map((r) => r.feedId))];
    const subscribedSet = new Set(
      feedIds.length > 0
        ? (
            await db
              .select({ feedId: subscriptions.feedId })
              .from(subscriptions)
              .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.feedId, feedIds)))
          ).map((s) => s.feedId)
        : [],
    );

    const items: CommunityShare[] = kept.map((r) => ({
      sharedAt: r.sharedAt!.toISOString(),
      note: r.note,
      user: { displayName: r.displayName, slug: r.slug },
      article: {
        id: r.articleId,
        title: r.title,
        url: r.url,
        summary: r.summary,
        publishedAt: r.publishedAt?.toISOString() ?? null,
      },
      feed: { id: r.feedId, title: r.feedTitle, feedUrl: r.feedUrl, faviconUrl: r.faviconUrl },
      subscribed: subscribedSet.has(r.feedId),
    }));

    const last = kept.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.sortTs, last.articleId) : null;
    return { items, nextCursor } satisfies Paginated<CommunityShare>;
  });
}
