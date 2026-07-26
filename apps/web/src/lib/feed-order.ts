import type { FolderRow, SubscriptionRow } from '@/lib/folders';

/** How the sidebar orders feeds within a scope. Folders are always alphabetical;
 *  this controls the feeds (SPEC: feed ordering). */
export type FeedSort = 'name' | 'unread';

/** The sort key for a feed row: its display name, case-folded. */
export const feedName = (s: SubscriptionRow) =>
  (s.customTitle ?? s.title ?? s.feedUrl).toLowerCase();

/** Folders are always alphabetical, everywhere. */
export const byFolderName = (a: FolderRow, b: FolderRow) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/**
 * Feed comparator for the current sort mode. In `unread` mode, feeds with unread
 * come first (descending); feeds with none fall back to alphabetical, so an
 * emptied feed drops back into the A-Z tail. In `name` mode it is pure A-Z.
 */
export function makeFeedComparator(sort: FeedSort, countByFeed: Map<string, number>) {
  return (a: SubscriptionRow, b: SubscriptionRow) => {
    if (sort === 'unread') {
      const ua = countByFeed.get(a.feedId) ?? 0;
      const ub = countByFeed.get(b.feedId) ?? 0;
      if (ua === 0 && ub === 0) return feedName(a).localeCompare(feedName(b));
      if (ua === 0) return 1;
      if (ub === 0) return -1;
      if (ua !== ub) return ub - ua;
    }
    return feedName(a).localeCompare(feedName(b));
  };
}

/**
 * The feed ids in the exact top-to-bottom order the sidebar renders them, so
 * keyboard next/prev-feed steps through what the user sees. Only feeds in
 * expanded folders are included (a collapsed folder hides its feeds, so they are
 * not navigable and cannot be scrolled to). Mirrors folder-tree's render: each
 * root folder, depth-first (its child folders and their feeds, then its own
 * feeds), then the unfoldered feeds.
 */
export function orderedVisibleFeedIds(opts: {
  folders: FolderRow[];
  subs: SubscriptionRow[];
  sort: FeedSort;
  countByFeed: Map<string, number>;
  expanded: Set<string>;
}): string[] {
  const { folders, subs, sort, countByFeed, expanded } = opts;
  const byFeed = makeFeedComparator(sort, countByFeed);
  const childrenOf = (id: string) => folders.filter((f) => f.parentId === id).sort(byFolderName);
  const feedsIn = (folderId: string | null) =>
    subs.filter((s) => s.folderId === folderId).sort(byFeed);

  const out: string[] = [];
  for (const folder of folders.filter((f) => f.parentId === null).sort(byFolderName)) {
    if (!expanded.has(folder.id)) continue;
    for (const child of childrenOf(folder.id)) {
      if (!expanded.has(child.id)) continue;
      for (const f of feedsIn(child.id)) out.push(f.feedId);
    }
    for (const f of feedsIn(folder.id)) out.push(f.feedId);
  }
  for (const f of feedsIn(null)) out.push(f.feedId);
  return out;
}
