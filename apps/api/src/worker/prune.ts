import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getAppSettings } from '../lib/app-settings.js';

/** Each feed's newest articles, by date, are never pruned, however old. */
export const KEEP_NEWEST_PER_FEED = 100;
/** The prune runs at most this often in one worker process. */
export const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Delete articles older than the retention window (SPEC-024). The admin sets
 * it; null (the default) keeps everything, and this returns 0 without a
 * query. Returns the number of articles deleted. Their article_states rows go
 * with them (on delete cascade).
 *
 * An article is kept when ANY of these is true:
 * - someone starred or shared it (a star means "keep this");
 * - it is one of its feed's newest KEEP_NEWEST_PER_FEED by date. Anything
 *   still in the feed XML is among these for any feed that lists up to that
 *   many items, so a poll can never re-import a pruned item as new and
 *   unread. A sparse blog keeps its whole window this way too;
 * - it was fetched within the window. A new subscription to a feed that
 *   lists old posts keeps them for the whole window, not one night.
 *
 * Invariant: with the 30-day floor on the setting and the guards above, a
 * prune cannot make a feed's current items come back as new. The one gap is
 * a feed whose XML lists more than KEEP_NEWEST_PER_FEED items older than the
 * window: those can come back once per window.
 */
export async function pruneOldArticles(): Promise<number> {
  const { articleRetentionDays: days } = await getAppSettings();
  if (days === null) return 0;
  const [row] = await db.execute<{ count: number }>(sql`
    with ranked as (
      select id,
        row_number() over (
          partition by feed_id
          order by coalesce(published_at, fetched_at) desc, id desc
        ) as rn
      from articles
    ),
    deleted as (
      delete from articles a
      using ranked r
      where r.id = a.id
        and r.rn > ${KEEP_NEWEST_PER_FEED}
        and coalesce(a.published_at, a.fetched_at) < now() - make_interval(days => ${days})
        and a.fetched_at < now() - make_interval(days => ${days})
        and not exists (
          select 1 from article_states st
          where st.article_id = a.id and (st.starred or st.shared)
        )
      returning 1
    )
    select count(*)::int as count from deleted
  `);
  const count = row?.count ?? 0;
  console.log(`[worker] pruned ${count} article(s) older than ${days} days`);
  return count;
}

/**
 * Runs `prune` at most once per `everyMs`. The first call runs at once, so a
 * worker restart prunes on its first tick (idempotent and cheap). A failed
 * run still waits a full interval: a broken delete should not retry on
 * every tick.
 */
export function pruneScheduler(prune: () => Promise<number>, everyMs = PRUNE_EVERY_MS) {
  let lastRunAt: number | null = null;
  return async (now = Date.now()): Promise<number | null> => {
    if (lastRunAt !== null && now - lastRunAt < everyMs) return null;
    lastRunAt = now;
    return prune();
  };
}
