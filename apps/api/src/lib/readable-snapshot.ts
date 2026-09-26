import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { articles } from '../db/schema.js';
import { extractReadableHtml } from './readability.js';

export interface ReadableSnapshot {
  readableHtml: string | null;
  readableFetchedAt: Date | null;
}

// One extraction per article at a time, in this process. A star and a first
// open of the Extracted view often come together; they share one fetch.
const inflight = new Map<string, Promise<ReadableSnapshot | null>>();

/**
 * Make sure the article has a readable snapshot (SPEC-024), the one path for
 * both the Extracted view (`GET /articles/:id/readable`) and the capture on
 * star or share, so the two cannot drift.
 *
 * - An attempt already made (`readableFetchedAt` set, whether it worked or
 *   not) is returned as it is, unless `force` (the view's "try again").
 * - No source URL: the attempt is stamped, so the view shows its fallback.
 * - A forced retry that fails keeps the snapshot already stored. A page that
 *   has died must never erase the copy taken while it was alive: that copy
 *   is the archive.
 *
 * Returns null when the article does not exist. Access checks are the
 * caller's job. Never throws for extraction failures (extractReadableHtml
 * returns null); a database error does throw.
 */
export function ensureReadableSnapshot(
  articleId: string,
  { force = false }: { force?: boolean } = {},
): Promise<ReadableSnapshot | null> {
  const running = inflight.get(articleId);
  if (running) return running;
  const job = capture(articleId, force).finally(() => inflight.delete(articleId));
  inflight.set(articleId, job);
  return job;
}

async function capture(articleId: string, force: boolean): Promise<ReadableSnapshot | null> {
  const [row] = await db
    .select({
      url: articles.url,
      readableHtml: articles.readableHtml,
      readableFetchedAt: articles.readableFetchedAt,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!row) return null;
  if (!force && row.readableFetchedAt !== null) {
    return { readableHtml: row.readableHtml, readableFetchedAt: row.readableFetchedAt };
  }

  const clean = row.url ? await extractReadableHtml(row.url) : null;
  const readableHtml = clean ?? row.readableHtml;
  const readableFetchedAt = new Date();
  await db.update(articles).set({ readableHtml, readableFetchedAt }).where(eq(articles.id, articleId));
  return { readableHtml, readableFetchedAt };
}
