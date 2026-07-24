import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/**
 * Per-feed unread counts for a user. A missing article_states row means unread,
 * so the left join + coalesce(read, false) = false counts never-touched
 * articles. count(...)::int deserializes as a number, not a bigint string.
 */
export async function getUnreadCountsByFeed(
  userId: string,
): Promise<{ feedId: string; unreadCount: number }[]> {
  const rows = (await db.execute(sql`
    select s.feed_id as "feedId",
           count(a.id) filter (where coalesce(st.read, false) = false)::int as "unreadCount"
    from subscriptions s
    join articles a on a.feed_id = s.feed_id
    left join article_states st
      on st.article_id = a.id and st.user_id = s.user_id
    where s.user_id = ${userId}::uuid
    group by s.feed_id
  `)) as unknown as { feedId: string; unreadCount: number }[];

  return rows.map((r) => ({ feedId: r.feedId, unreadCount: Number(r.unreadCount) }));
}
