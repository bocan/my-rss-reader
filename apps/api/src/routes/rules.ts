import {
  createRuleSchema,
  MAX_FILTER_RULES,
  updateRuleSchema,
  type FilterRuleDto,
  type RuleAction,
  type RuleField,
} from '@rss/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { filterRules, subscriptions } from '../db/schema.js';
import { applyRuleToExisting } from '../lib/rules.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: 'NotFound', message: 'Rule not found', statusCode: 404 } as const;

type Row = typeof filterRules.$inferSelect;
const toDto = (r: Row): FilterRuleDto => ({
  id: r.id,
  feedId: r.feedId,
  field: r.field as RuleField,
  phrase: r.phrase,
  action: r.action as RuleAction,
  enabled: r.enabled,
  createdAt: r.createdAt.toISOString(),
});

const badRequest = (reply: FastifyReply, error: string, message: string) =>
  reply.code(400).send({ error, message, statusCode: 400 });

async function followsFeed(userId: string, feedId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Filter rules (SPEC-025): "when <field> contains <phrase> in <feed | all
 * feeds>, mark read / star". The worker applies them to new articles at
 * ingestion (lib/rules.ts); POST /rules/:id/apply runs one over existing
 * articles. Every query here is scoped to the caller.
 */
export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  const loadOwn = async (id: string, userId: string) =>
    UUID_RE.test(id)
      ? (
          await db
            .select()
            .from(filterRules)
            .where(and(eq(filterRules.id, id), eq(filterRules.userId, userId)))
            .limit(1)
        )[0]
      : undefined;

  app.get('/rules', auth, async (request) => {
    const rows = await db
      .select()
      .from(filterRules)
      .where(eq(filterRules.userId, request.user!.id))
      .orderBy(asc(filterRules.createdAt));
    return { items: rows.map(toDto) };
  });

  app.post('/rules', auth, async (request, reply) => {
    const input = createRuleSchema.parse(request.body);
    const userId = request.user!.id;
    if (input.feedId && !(await followsFeed(userId, input.feedId))) {
      return badRequest(reply, 'invalid_scope', 'You do not follow that feed');
    }
    const [stats] = await db.select({ n: count() }).from(filterRules).where(eq(filterRules.userId, userId));
    if ((stats?.n ?? 0) >= MAX_FILTER_RULES) {
      return badRequest(reply, 'too_many_rules', `You can have up to ${MAX_FILTER_RULES} rules`);
    }
    const [row] = await db
      .insert(filterRules)
      .values({
        userId,
        feedId: input.feedId ?? null,
        field: input.field,
        phrase: input.phrase,
        action: input.action,
      })
      .returning();
    return reply.code(201).send(toDto(row!));
  });

  app.patch('/rules/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateRuleSchema.parse(request.body);
    const userId = request.user!.id;
    if (!(await loadOwn(id, userId))) return reply.code(404).send(notFound);
    if (input.feedId && !(await followsFeed(userId, input.feedId))) {
      return badRequest(reply, 'invalid_scope', 'You do not follow that feed');
    }
    const [row] = await db
      .update(filterRules)
      .set({
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.phrase !== undefined ? { phrase: input.phrase } : {}),
        ...(input.field !== undefined ? { field: input.field } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.feedId !== undefined ? { feedId: input.feedId } : {}),
      })
      .where(and(eq(filterRules.id, id), eq(filterRules.userId, userId)))
      .returning();
    return toDto(row!);
  });

  app.delete('/rules/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(404).send(notFound);
    const deleted = await db
      .delete(filterRules)
      .where(and(eq(filterRules.id, id), eq(filterRules.userId, request.user!.id)))
      .returning({ id: filterRules.id });
    if (deleted.length === 0) return reply.code(404).send(notFound);
    return reply.code(204).send();
  });

  // "Run on existing articles": one rule over the newest in-scope articles.
  // It runs even when the rule is disabled: the user pressed the button.
  app.post('/rules/:id/apply', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const rule = await loadOwn(id, userId);
    if (!rule) return reply.code(404).send(notFound);
    const matched = await applyRuleToExisting(toDto(rule), userId);
    return { matched };
  });
}
