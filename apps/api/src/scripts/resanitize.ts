/**
 * One-off backfill: re-run the current sanitizer over already-stored article
 * HTML. Run it manually after bumping SANITIZER_VERSION in
 * apps/api/src/lib/sanitize.ts:
 *
 *   pnpm --filter @rss/api exec tsx src/scripts/resanitize.ts
 *
 * In the production container (no tsx there):
 *
 *   docker exec rss-reader-api-1 node dist/resanitize.js
 *
 * It re-sanitizes the HTML already in articles.contentHtml and strips markup
 * left in articles.summary (no network fetch), which is why the policy must
 * also run at ingestion in feed-fetch.ts.
 */
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { client, db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { htmlToText, looksLikeHtml, SANITIZER_VERSION, sanitizeArticleHtml } from '../lib/sanitize.js';

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
        summary: articles.summary,
        url: articles.url,
        siteUrl: feeds.siteUrl,
      })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(
        and(
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
        const summary =
          row.summary && looksLikeHtml(row.summary) ? htmlToText(row.summary) || null : row.summary;
        await db
          .update(articles)
          .set({
            contentHtml: row.contentHtml ? sanitizeArticleHtml(row.contentHtml, base) : null,
            summary,
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
