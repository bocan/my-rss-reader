import {
  createSavedSearchSchema,
  MAX_SAVED_SEARCHES,
  updateSavedSearchSchema,
  type SavedSearchDto,
} from '@rss/shared';
import { and, asc, count, eq, max } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { folders, savedSearches, subscriptions } from '../db/schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: 'NotFound', message: 'Saved search not found', statusCode: 404 } as const;

type Row = typeof savedSearches.$inferSelect;
const toDto = (r: Row): SavedSearchDto => ({
  id: r.id,
  name: r.name,
  q: r.q,
  feedId: r.feedId,
  folderId: r.folderId,
  starred: r.starred,
  unread: r.unread,
  position: r.position,
  createdAt: r.createdAt.toISOString(),
});

const badRequest = (reply: FastifyReply, error: string, message: string) =>
  reply.code(400).send({ error, message, statusCode: 400 });

/**
 * Saved searches (SPEC-025): a named query and scope pinned to the sidebar.
 * There is no endpoint to run one: the client sends its fields to the
 * ordinary GET /articles, so a saved search lists exactly what the same
 * manual search lists. Every query here is scoped to the caller.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  app.get('/searches', auth, async (request) => {
    const rows = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.userId, request.user!.id))
      .orderBy(asc(savedSearches.position), asc(savedSearches.createdAt));
    return { items: rows.map(toDto) };
  });

  app.post('/searches', auth, async (request, reply) => {
    const input = createSavedSearchSchema.parse(request.body);
    const userId = request.user!.id;

    // The scope must be the caller's own: a folder they made, a feed they
    // follow. A foreign id would otherwise leak nothing, but would be a
    // search that can never match; refuse it plainly.
    if (input.folderId) {
      const [own] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.userId, userId)))
        .limit(1);
      if (!own) return badRequest(reply, 'invalid_scope', 'Unknown folder');
    }
    if (input.feedId) {
      const [own] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.feedId, input.feedId), eq(subscriptions.userId, userId)))
        .limit(1);
      if (!own) return badRequest(reply, 'invalid_scope', 'You do not follow that feed');
    }

    const [stats] = await db
      .select({ n: count(), top: max(savedSearches.position) })
      .from(savedSearches)
      .where(eq(savedSearches.userId, userId));
    if ((stats?.n ?? 0) >= MAX_SAVED_SEARCHES) {
      return badRequest(reply, 'too_many_searches', `You can save up to ${MAX_SAVED_SEARCHES} searches`);
    }

    const [row] = await db
      .insert(savedSearches)
      .values({
        userId,
        name: input.name,
        q: input.q,
        feedId: input.feedId ?? null,
        folderId: input.folderId ?? null,
        starred: input.starred,
        unread: input.unread ?? null,
        position: stats?.top == null ? 0 : stats.top + 1,
      })
      .returning();
    return reply.code(201).send(toDto(row!));
  });

  app.patch('/searches/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateSavedSearchSchema.parse(request.body);
    const userId = request.user!.id;
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);

    const updated = await db.transaction(async (tx) => {
      const mine = await tx
        .select()
        .from(savedSearches)
        .where(eq(savedSearches.userId, userId))
        .orderBy(asc(savedSearches.position), asc(savedSearches.createdAt));
      const current = mine.find((s) => s.id === id);
      if (!current) return null;

      if (input.name !== undefined) {
        await tx.update(savedSearches).set({ name: input.name }).where(eq(savedSearches.id, id));
      }
      // Move to the index and renumber the whole list 0..n-1. A user has at
      // most MAX_SAVED_SEARCHES rows, so rewriting them all stays cheap.
      if (input.position !== undefined) {
        const order = mine.filter((s) => s.id !== id);
        order.splice(Math.min(input.position, order.length), 0, current);
        for (const [i, s] of order.entries()) {
          if (s.position !== i) {
            await tx.update(savedSearches).set({ position: i }).where(eq(savedSearches.id, s.id));
          }
        }
      }
      const [row] = await tx.select().from(savedSearches).where(eq(savedSearches.id, id));
      return row!;
    });
    if (!updated) return reply.code(404).send(notFound);
    return toDto(updated);
  });

  app.delete('/searches/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);
    const deleted = await db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, request.user!.id)))
      .returning({ id: savedSearches.id });
    if (deleted.length === 0) return reply.code(404).send(notFound);
    return reply.code(204).send();
  });
}
