/**
 * Some feeds use the post URL as the entry id. When the author fixes a typo
 * in the URL, the id changes, and a guid-only dedupe would store the post a
 * second time (#51). This finds those renames, so the stored article takes the
 * new id instead.
 *
 * An incoming entry with an unknown guid is a rename of a stored article only
 * when all of these hold:
 * - the same title (and both have one);
 * - publish times within PUBLISHED_WINDOW_MS (and both have one);
 * - the same start of the body text (CONTENT_PREFIX characters, whitespace
 *   collapsed), so two posts with one title on one day (a daily digest) stay
 *   apart;
 * - the stored article's guid is not in the feed any more. If it still is,
 *   the two are separate posts.
 * Each stored article matches at most one incoming entry.
 */

export const PUBLISHED_WINDOW_MS = 60 * 60 * 1000;
export const CONTENT_PREFIX = 200;

export interface EntryKey {
  guid: string;
  title: string | null;
  publishedAt: Date | null;
  contentText: string | null;
}

const prefix = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, CONTENT_PREFIX);

/** Map of incoming guid to the id of the stored article it renames. */
export function findRenamedEntries(
  incoming: readonly EntryKey[],
  stored: readonly (EntryKey & { id: string })[],
): Map<string, string> {
  const inFeed = new Set(incoming.map((e) => e.guid));
  const known = new Set(stored.map((s) => s.guid));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const entry of incoming) {
    if (known.has(entry.guid) || !entry.title || !entry.publishedAt) continue;
    const match = stored.find(
      (s) =>
        !taken.has(s.id) &&
        !inFeed.has(s.guid) &&
        s.title === entry.title &&
        s.publishedAt !== null &&
        Math.abs(s.publishedAt.getTime() - entry.publishedAt!.getTime()) <= PUBLISHED_WINDOW_MS &&
        prefix(s.contentText) === prefix(entry.contentText),
    );
    if (match) {
      taken.add(match.id);
      out.set(entry.guid, match.id);
    }
  }
  return out;
}
