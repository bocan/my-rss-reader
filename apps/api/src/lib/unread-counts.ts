import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/**
 * Unread items on a firehose-tier subscription quietly expire after this many
 * days (SPEC-022). Purely a query-time predicate: no state rows are ever
 * written, so the window is retroactive and reversible by re-tiering.
 * Interpolated as a bound parameter at every SQL site that uses it.
 */
export const FIREHOSE_EXPIRY_DAYS = 14;

/**
 * Per-feed unread counts for a user. A missing article_states row means unread,
 * so the left join + coalesce(read, false) = false counts never-touched
 * articles. Firehose subscriptions (SPEC-022) do not count items older than
 * the expiry window. count(...)::int deserializes as a number, not a bigint
 * string.
 */
export async function getUnreadCountsByFeed(
  userId: string,
): Promise<{ feedId: string; attention: string; unreadCount: number }[]> {
  const rows = (await db.execute(sql`
    select s.feed_id as "feedId",
           s.attention,
           count(a.id) filter (
             where coalesce(st.read, false) = false
               and not (
                 s.attention = 'firehose'
                 and coalesce(a.published_at, a.fetched_at)
                     < now() - make_interval(days => ${FIREHOSE_EXPIRY_DAYS})
               )
           )::int as "unreadCount"
    from subscriptions s
    join articles a on a.feed_id = s.feed_id
    left join article_states st
      on st.article_id = a.id and st.user_id = s.user_id
    where s.user_id = ${userId}::uuid
    group by s.feed_id, s.attention
  `)) as unknown as { feedId: string; attention: string; unreadCount: number }[];

  return rows.map((r) => ({
    feedId: r.feedId,
    attention: r.attention,
    unreadCount: Number(r.unreadCount),
  }));
}
