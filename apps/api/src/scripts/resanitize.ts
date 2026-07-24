/**
 * One-off backfill: re-run the current sanitizer over already-stored article
 * HTML. Run it manually after bumping SANITIZER_VERSION in
 * apps/api/src/lib/sanitize.ts:
 *
 *   pnpm --filter @rss/api exec tsx src/scripts/resanitize.ts
 *
 * It re-sanitizes the HTML already in articles.contentHtml (no network fetch),
 * which is why the policy must also run at ingestion in poll.ts.
 */
import { and, asc, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { client, db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { SANITIZER_VERSION, sanitizeArticleHtml } from '../lib/sanitize.js';

const BATCH = 500;

async function main(): Promise<void> {
  let cursor: string | null = null; // last processed articles.id (uuid)
  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (;;) {
    const batch = await db
      .select({
        id: articles.id,
        contentHtml: articles.contentHtml,
        url: articles.url,
        siteUrl: feeds.siteUrl,
      })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(
        and(
          isNotNull(articles.contentHtml),
          or(
            isNull(articles.sanitizerVersion),
            lt(articles.sanitizerVersion, SANITIZER_VERSION),
          ),
          cursor ? gt(articles.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(articles.id))
      .limit(BATCH);

    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;
      processed++;
      try {
        const base = row.url ?? row.siteUrl ?? null;
        const clean = sanitizeArticleHtml(row.contentHtml as string, base);
        await db
          .update(articles)
          .set({
            contentHtml: clean,
            sanitizedAt: new Date(),
            sanitizerVersion: SANITIZER_VERSION,
          })
          .where(eq(articles.id, row.id));
        updated++;
      } catch (err) {
        failed++;
        console.error(
          `[resanitize] failed on ${row.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  console.log(`[resanitize] processed=${processed} updated=${updated} failed=${failed}`);
  await client.end({ timeout: 5 });
}

void main();
