import { isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { feeds } from '../db/schema.js';
import { env } from '../env.js';
import { getAppSettings } from '../lib/app-settings.js';
import { fetchAndStoreFeed, type FeedRow } from '../lib/feed-fetch.js';

/**
 * Feeds whose lastFetchedAt is null or older than their effective interval:
 * the feed's own fetchIntervalSec, or the app-wide default when it is null
 * (SPEC-018).
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
          sql`now() - make_interval(secs => coalesce(${feeds.fetchIntervalSec}, ${defaultPollIntervalSec}))`,
        ),
      ),
    )
    .limit(200);
}

/** Fetch, parse, and persist a single feed. Errors are recorded, not thrown. */
export async function pollFeed(feed: FeedRow): Promise<void> {
  await fetchAndStoreFeed(feed);
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
