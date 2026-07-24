/**
 * One-off backfill: derive articles.image_url for rows ingested before
 * SPEC-010, using the same extractor the fetch path uses over the already
 * sanitized content_html.
 *
 *   pnpm --filter @rss/api exec tsx src/scripts/backfill-image-url.ts
 */
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { client, db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { extractImageUrl } from '../lib/feed-fetch.js';

const BATCH = 500;

async function main(): Promise<void> {
  let cursor: string | null = null;
  let processed = 0;
  let updated = 0;

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
      .where(and(isNull(articles.imageUrl), cursor ? gt(articles.id, cursor) : undefined))
      .orderBy(asc(articles.id))
      .limit(BATCH);

    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;
      processed++;
      const image = extractImageUrl([row.contentHtml], {}, row.url ?? row.siteUrl ?? null);
      if (!image) continue;
      await db.update(articles).set({ imageUrl: image }).where(eq(articles.id, row.id));
      updated++;
    }
  }

  console.log(`[backfill-image-url] processed=${processed} updated=${updated}`);
  await client.end({ timeout: 5 });
}

void main();
