/**
 * One-off backfill: populate articles.content_text for rows ingested before
 * SPEC-006. Derives the text from the already-sanitized content_html, falling
 * back to the summary. The generated search_vector recomputes per updated row.
 *
 *   pnpm --filter @rss/api exec tsx src/scripts/backfill-search-text.ts
 */
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { client, db } from '../db/index.js';
import { articles } from '../db/schema.js';
import { extractText } from '../lib/sanitize.js';

const BATCH = 500;

async function main(): Promise<void> {
  let cursor: string | null = null; // last processed articles.id (uuid)
  let processed = 0;
  let updated = 0;

  for (;;) {
    const batch = await db
      .select({
        id: articles.id,
        contentHtml: articles.contentHtml,
        summary: articles.summary,
      })
      .from(articles)
      .where(and(isNull(articles.contentText), cursor ? gt(articles.id, cursor) : undefined))
      .orderBy(asc(articles.id))
      .limit(BATCH);

    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;
      processed++;
      const source = row.contentHtml ?? row.summary;
      if (!source) continue;
      const text = extractText(source);
      if (!text) continue;
      await db.update(articles).set({ contentText: text }).where(eq(articles.id, row.id));
      updated++;
    }
  }

  console.log(`[backfill-search-text] processed=${processed} updated=${updated}`);
  await client.end({ timeout: 5 });
}

void main();
