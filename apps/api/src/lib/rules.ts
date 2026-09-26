import {
  RULE_APPLY_LIMIT,
  type FilterRuleDto,
  type RuleAction,
  type RuleField,
} from '@rss/shared';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { articleStates, filterRules, subscriptions } from '../db/schema.js';

/**
 * Filter rules (SPEC-025): "when <field> contains <phrase>, <action>". A
 * phrase is always a case-insensitive LITERAL. No user input ever becomes a
 * regex (no ReDoS class at all), and in SQL it is an escaped ILIKE pattern
 * bound as a parameter.
 */

/** Escape %, _ and \ so a phrase is a literal ILIKE substring match (used
 *  with `escape '\'`). */
export function likePattern(phrase: string): string {
  return `%${phrase.replace(/[\\%_]/g, '\\$&')}%`;
}

/** The fields a rule can read, as stored at ingestion (all plain text). */
export interface RuleArticle {
  id: string;
  title: string | null;
  author: string | null;
  contentText: string | null;
  summary: string | null;
}

export interface RuleRow {
  userId: string;
  field: RuleField;
  phrase: string;
  action: RuleAction;
}

export interface RuleHit {
  userId: string;
  articleId: string;
  read: boolean;
  starred: boolean;
}

/** The text a rule field reads. `content` falls back to the summary, so
 *  rules work on summary-only feeds. Never HTML. */
export function ruleFieldText(article: RuleArticle, field: RuleField): string | null {
  if (field === 'title') return article.title;
  if (field === 'author') return article.author;
  return article.contentText ?? article.summary;
}

/**
 * Match rules against a batch of new articles, in memory: at most one feed's
 * new items. Case-insensitive substring, no regex. Two rules that hit one
 * article for one user merge into one hit (read and starred both set).
 */
export function matchRules(rules: readonly RuleRow[], batch: readonly RuleArticle[]): RuleHit[] {
  const hits = new Map<string, RuleHit>();
  for (const rule of rules) {
    const needle = rule.phrase.toLowerCase();
    for (const article of batch) {
      const text = ruleFieldText(article, rule.field);
      if (!text || !text.toLowerCase().includes(needle)) continue;
      const key = `${rule.userId}:${article.id}`;
      const hit = hits.get(key) ?? { userId: rule.userId, articleId: article.id, read: false, starred: false };
      if (rule.action === 'markRead') hit.read = true;
      else hit.starred = true;
      hits.set(key, hit);
    }
  }
  return [...hits.values()];
}

/**
 * The conflict clause shared by ingestion and the retroactive apply: a rule
 * only ever ADDS read or starred. It never un-reads or un-stars, and it
 * keeps the first read/star time.
 */
const addOnlyStates = {
  target: [articleStates.userId, articleStates.articleId],
  set: {
    read: sql`${articleStates.read} or excluded.read`,
    starred: sql`${articleStates.starred} or excluded.starred`,
    readAt: sql`coalesce(${articleStates.readAt}, excluded.read_at)`,
    starredAt: sql`coalesce(${articleStates.starredAt}, excluded.starred_at)`,
  },
};

/**
 * Apply the rules of every subscriber of `feedId` to articles that were just
 * ingested. Only enabled rules of users subscribed to the feed now, scoped to
 * this feed or to all feeds. An article a rule marks read is born read: it
 * never shows as unread, and never counts.
 *
 * Never throws: a rule problem must not stop the poll loop (the same
 * contract as fetchAndStoreFeed). Returns the number of state rows written.
 */
export async function applyFilterRules(feedId: string, batch: readonly RuleArticle[]): Promise<number> {
  if (batch.length === 0) return 0;
  try {
    const rules = await db
      .select({
        userId: filterRules.userId,
        field: filterRules.field,
        phrase: filterRules.phrase,
        action: filterRules.action,
      })
      .from(filterRules)
      .innerJoin(
        subscriptions,
        and(eq(subscriptions.userId, filterRules.userId), eq(subscriptions.feedId, feedId)),
      )
      .where(
        and(eq(filterRules.enabled, true), or(isNull(filterRules.feedId), eq(filterRules.feedId, feedId))),
      );
    const hits = matchRules(rules as RuleRow[], batch);
    if (hits.length === 0) return 0;
    const now = new Date();
    await db
      .insert(articleStates)
      .values(
        hits.map((h) => ({
          userId: h.userId,
          articleId: h.articleId,
          read: h.read,
          starred: h.starred,
          readAt: h.read ? now : null,
          starredAt: h.starred ? now : null,
        })),
      )
      .onConflictDoUpdate(addOnlyStates);
    return hits.length;
  } catch (err) {
    console.error('[rules] could not apply filter rules for feed', feedId, err);
    return 0;
  }
}

const FIELD_SQL: Record<RuleField, ReturnType<typeof sql>> = {
  title: sql`a.title`,
  author: sql`a.author`,
  content: sql`coalesce(a.content_text, a.summary)`,
};

/**
 * Run one rule over EXISTING articles ("Run on existing articles"): the
 * newest RULE_APPLY_LIMIT articles, by the list's sort key, from the rule's
 * scope intersected with the user's CURRENT subscriptions, so an "all feeds"
 * rule never touches a feed the user left. `onlyFeedId` narrows it further
 * (used after a new subscription). Set-based; the phrase is an escaped,
 * bound ILIKE pattern. Returns how many articles matched. Idempotent: a
 * second run finds the same articles and changes nothing.
 */
export async function applyRuleToExisting(
  rule: Pick<FilterRuleDto, 'feedId' | 'field' | 'phrase' | 'action'>,
  userId: string,
  onlyFeedId?: string,
): Promise<number> {
  const read = rule.action === 'markRead';
  const feedClause = rule.feedId ? sql`and a.feed_id = ${rule.feedId}::uuid` : sql``;
  const onlyClause = onlyFeedId ? sql`and a.feed_id = ${onlyFeedId}::uuid` : sql``;
  const rows = await db.execute<{ count: number }>(sql`
    with scope as (
      select a.id
      from articles a
      join subscriptions s on s.feed_id = a.feed_id and s.user_id = ${userId}::uuid
      where true ${feedClause} ${onlyClause}
      order by coalesce(a.published_at, a.fetched_at) desc, a.id desc
      limit ${RULE_APPLY_LIMIT}
    ),
    matched as (
      select a.id
      from articles a
      join scope on scope.id = a.id
      where ${FIELD_SQL[rule.field]} ilike ${likePattern(rule.phrase)} escape '\\'
    ),
    written as (
      insert into article_states (user_id, article_id, read, starred, read_at, starred_at)
      select ${userId}::uuid, m.id, ${read}::boolean, ${!read}::boolean,
        ${read ? sql`now()` : sql`null`}, ${read ? sql`null` : sql`now()`}
      from matched m
      on conflict (user_id, article_id) do update
        set read = article_states.read or excluded.read,
            starred = article_states.starred or excluded.starred,
            read_at = coalesce(article_states.read_at, excluded.read_at),
            starred_at = coalesce(article_states.starred_at, excluded.starred_at)
      returning 1
    )
    select (select count(*) from matched)::int as count
  `);
  return rows[0]?.count ?? 0;
}

/**
 * After a new subscription: run the user's enabled rules that cover this
 * feed over its existing articles. Without this, the articles that arrive
 * with a subscription would skip the user's rules, since they were stored
 * before the user subscribed (or long ago, for a feed others follow).
 * Never throws.
 */
export async function applyRulesToNewSubscription(userId: string, feedId: string): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(filterRules)
      .where(
        and(
          eq(filterRules.userId, userId),
          eq(filterRules.enabled, true),
          or(isNull(filterRules.feedId), eq(filterRules.feedId, feedId)),
        ),
      );
    for (const rule of rules) {
      await applyRuleToExisting(
        { ...rule, field: rule.field as RuleField, action: rule.action as RuleAction },
        userId,
        feedId,
      );
    }
  } catch (err) {
    console.error('[rules] could not apply rules to a new subscription', feedId, err);
  }
}
