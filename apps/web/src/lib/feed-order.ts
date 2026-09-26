import type { FolderRow, SubscriptionRow } from '@/lib/folders';

/**
 * How the sidebar orders feeds within a scope (SPEC: feed ordering). In `name`
 * and `unread` mode folders are alphabetical. In `manual` mode feeds and
 * folders follow the saved `position`, the order the user drags them into
 * (#27). Only `manual` offers drag to reorder: in the other modes a drop could
 * never change what is shown.
 */
export type FeedSort = 'name' | 'unread' | 'manual';

export const FEED_SORTS: readonly FeedSort[] = ['name', 'unread', 'manual'];

export const isFeedSort = (v: unknown): v is FeedSort => FEED_SORTS.includes(v as FeedSort);

/** True when a drop can reorder rows (not only move them to another folder). */
export const canReorder = (sort: FeedSort) => sort === 'manual';

/** The sort key for a feed row: its display name, case-folded. */
export const feedName = (s: SubscriptionRow) =>
  (s.customTitle ?? s.title ?? s.feedUrl).toLowerCase();

/** Folders by name, the order in `name` and `unread` mode. */
export const byFolderName = (a: FolderRow, b: FolderRow) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** Folder comparator for the current sort mode. Mirrors the server's order in
 *  `manual` mode: position, then age. */
export function makeFolderComparator(sort: FeedSort) {
  if (sort !== 'manual') return byFolderName;
  return (a: FolderRow, b: FolderRow) =>
    a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Feed comparator for the current sort mode. In `unread` mode, feeds with unread
 * come first (descending); feeds with none fall back to alphabetical, so an
 * emptied feed drops back into the A-Z tail. In `name` mode it is pure A-Z. In
 * `manual` mode it is the saved position, with the name only to break a tie.
 */
export function makeFeedComparator(sort: FeedSort, countByFeed: Map<string, number>) {
  return (a: SubscriptionRow, b: SubscriptionRow) => {
    if (sort === 'manual' && a.position !== b.position) return a.position - b.position;
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
 * Folders for a select, in tree order: each root folder (by name), then its
 * subfolders (by name) marked with `depth: 1`, so the select can indent
 * them (#28).
 */
/** The sidebar filter (#46): `query` is lower case, and matches the feed's
 *  title, its custom title, or its feed URL. */
export function feedMatches(
  s: Pick<SubscriptionRow, 'title' | 'customTitle' | 'feedUrl'>,
  query: string,
): boolean {
  return [s.title, s.customTitle, s.feedUrl].some((v) => v?.toLowerCase().includes(query));
}

export function folderChoices(folders: readonly FolderRow[]): { folder: FolderRow; depth: 0 | 1 }[] {
  const roots = folders.filter((f) => f.parentId === null).sort(byFolderName);
  return roots.flatMap((root) => [
    { folder: root, depth: 0 as const },
    ...folders
      .filter((f) => f.parentId === root.id)
      .sort(byFolderName)
      .map((folder) => ({ folder, depth: 1 as const })),
  ]);
}

/**
 * The index to send when a row is dropped on another row in manual mode. The
 * server removes the moved row from the target scope, then inserts it at this
 * index (lib/ordering.ts). `scope` is the target scope in display order, all
 * rows, not only the visible ones, so a hidden read feed cannot shift the
 * result. A row dragged down lands after the row under it, a row dragged up
 * or in from another scope lands before it, as the drag preview shows.
 */
export function dropIndex(scope: readonly string[], activeId: string, overId: string): number {
  const from = scope.indexOf(activeId);
  const rest = scope.filter((id) => id !== activeId);
  const at = rest.indexOf(overId);
  if (at < 0) return rest.length;
  const movingDown = from >= 0 && from < scope.indexOf(overId);
  return movingDown ? at + 1 : at;
}

/**
 * The optimistic copy of the server's placement: take `id` out of its scope,
 * insert it into the target scope at `index` (or the end), and renumber that
 * scope 0..n-1. Without this, only the moved row changes position, and in
 * manual mode it would sort among its old neighbours until the refetch.
 */
export function placeAt<T extends { position: number }>(
  items: readonly T[],
  opts: { isMoved: (x: T) => boolean; inScope: (x: T) => boolean; index?: number; move: (x: T) => T },
): T[] {
  const moved = items.find(opts.isMoved);
  if (!moved) return [...items];
  const siblings = items
    .filter((x) => !opts.isMoved(x) && opts.inScope(x))
    .sort((a, b) => a.position - b.position);
  const index = Math.min(Math.max(opts.index ?? siblings.length, 0), siblings.length);
  const placed = { ...opts.move(moved), position: index };
  const next = new Map(siblings.map((x, i) => [x, { ...x, position: i < index ? i : i + 1 }]));
  return items.map((x) => (x === moved ? placed : (next.get(x) ?? x)));
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
  const byFolder = makeFolderComparator(sort);
  const childrenOf = (id: string) => folders.filter((f) => f.parentId === id).sort(byFolder);
  const feedsIn = (folderId: string | null) =>
    subs.filter((s) => s.folderId === folderId).sort(byFeed);

  const out: string[] = [];
  for (const folder of folders.filter((f) => f.parentId === null).sort(byFolder)) {
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
