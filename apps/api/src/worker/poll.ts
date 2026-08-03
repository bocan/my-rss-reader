import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { feeds } from '../db/schema.js';
import { env } from '../env.js';
import { getAppSettings } from '../lib/app-settings.js';
import { fetchAndStoreFeed, type FeedRow } from '../lib/feed-fetch.js';
import {
  RENEW_WINDOW_SEC,
  subscribeToHub,
  WEBSUB_ACTIVE_POLL_FLOOR_SEC,
} from '../lib/websub.js';

/**
 * Feeds whose lastFetchedAt is null or older than their effective interval:
 * the feed's own fetchIntervalSec, or the app-wide default when it is null
 * (SPEC-018). A feed with an active WebSub lease is floored to a lazy
 * integrity-check cadence instead (SPEC-021): pushes carry the realtime load.
 */
export async function findDueFeeds(): Promise<FeedRow[]> {
  const { defaultPollIntervalSec } = await getAppSettings();
  return db
    .select()
    .from(feeds)
    .where(
      or(
        isNull(feeds.lastFetchedAt),
        lte(
          feeds.lastFetchedAt,
          sql`now() - make_interval(secs => greatest(
            coalesce(${feeds.fetchIntervalSec}, ${defaultPollIntervalSec}),
            case when ${feeds.websubState} = 'active'
                  and ${feeds.websubLeaseExpiresAt} > now()
                 then ${WEBSUB_ACTIVE_POLL_FLOOR_SEC} else 0 end))`,
        ),
      ),
    )
    .limit(200);
}

/**
 * Fetch, parse, and persist a single feed; errors are recorded, not thrown.
 * Afterwards, start (or retry) a WebSub subscription when the feed
 * advertises a hub and none is active yet. The fetch may have just updated
 * the hub columns, so re-read the row first.
 */
export async function pollFeed(feed: FeedRow): Promise<void> {
  await fetchAndStoreFeed(feed);
  if (!env.PUBLIC_URL) return;
  const [fresh] = await db.select().from(feeds).where(eq(feeds.id, feed.id)).limit(1);
  if (!fresh?.websubHubUrl) return;
  const retryable =
    fresh.websubState === 'inactive' ||
    (fresh.websubState === 'pending' && fresh.websubLeaseExpiresAt === null);
  if (retryable) await subscribeToHub(fresh);
}

/** Active leases that expire within the renewal window (or already have). */
export async function findLeasesDueForRenewal(): Promise<FeedRow[]> {
  return db
    .select()
    .from(feeds)
    .where(
      and(
        eq(feeds.websubState, 'active'),
        lt(feeds.websubLeaseExpiresAt, sql`now() + make_interval(secs => ${RENEW_WINDOW_SEC})`),
      ),
    )
    .limit(200);
}

/** Re-subscribe every lease nearing expiry. Returns the count attempted. */
export async function renewDueWebSubLeases(): Promise<number> {
  if (!env.PUBLIC_URL) return 0;
  const due = await findLeasesDueForRenewal();
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < due.length) {
      const feed = due[index++];
      if (feed) await subscribeToHub(feed); // never throws
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(env.FEED_POLL_CONCURRENCY, due.length) }, worker),
  );
  return due.length;
}

/** Poll all due feeds with bounded concurrency. Returns the count processed. */
export async function pollDueFeeds(): Promise<number> {
  const due = await findDueFeeds();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < due.length) {
      const feed = due[index++];
      if (feed) await pollFeed(feed);
    }
  }

  const workers = Array.from({ length: Math.min(env.FEED_POLL_CONCURRENCY, due.length) }, worker);
  await Promise.all(workers);
  return due.length;
}
