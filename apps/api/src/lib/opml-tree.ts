import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { feeds, folders, subscriptions } from '../db/schema.js';
import type { OpmlFeedNode, OpmlFolderNode } from './opml.js';

/**
 * A user's folders + subscriptions as an OPML-shaped tree (SPEC-020). Shared
 * by the authenticated OPML export and the public blogroll so the two can
 * never drift. `blogrollOnly` keeps only inBlogroll subscriptions and prunes
 * folders left empty (an empty folder name is still information about the
 * user; the public surface must not leak it).
 */

export interface TreeFolderRow {
  id: string;
  parentId: string | null;
  name: string;
}

export interface TreeSubRow {
  folderId: string | null;
  customTitle: string | null;
  title: string | null;
  feedUrl: string;
  siteUrl: string | null;
  faviconUrl: string | null;
}

export interface FeedTree {
  folders: OpmlFolderNode[];
  feeds: OpmlFeedNode[];
}

/** Pure assembly, unit-testable without a database. Rows arrive pre-sorted. */
export function assembleFeedTree(
  folderRows: TreeFolderRow[],
  subRows: TreeSubRow[],
  opts: { pruneEmptyFolders?: boolean } = {},
): FeedTree {
  const feedsFor = (folderId: string | null): OpmlFeedNode[] =>
    subRows
      .filter((s) => s.folderId === folderId)
      .map((s) => ({
        title: s.customTitle ?? s.title ?? s.feedUrl,
        xmlUrl: s.feedUrl,
        htmlUrl: s.siteUrl,
        faviconUrl: s.faviconUrl,
      }));

  const buildFolder = (id: string, name: string): OpmlFolderNode => ({
    title: name,
    folders: folderRows
      .filter((f) => f.parentId === id)
      .map((child) => buildFolder(child.id, child.name)),
    feeds: feedsFor(id),
  });

  let roots = folderRows.filter((f) => f.parentId === null).map((f) => buildFolder(f.id, f.name));

  if (opts.pruneEmptyFolders) {
    const prune = (folder: OpmlFolderNode): OpmlFolderNode | null => {
      const children = folder.folders
        .map(prune)
        .filter((f): f is OpmlFolderNode => f !== null);
      if (children.length === 0 && folder.feeds.length === 0) return null;
      return { ...folder, folders: children };
    };
    roots = roots.map(prune).filter((f): f is OpmlFolderNode => f !== null);
  }

  return { folders: roots, feeds: feedsFor(null) };
}

/** Load and assemble a user's tree in sidebar order. */
export async function buildUserFeedTree(
  userId: string,
  opts: { blogrollOnly?: boolean } = {},
): Promise<FeedTree> {
  const folderRows = await db
    .select({ id: folders.id, parentId: folders.parentId, name: folders.name })
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.position), asc(folders.createdAt));

  const subFilters = [eq(subscriptions.userId, userId)];
  if (opts.blogrollOnly) subFilters.push(eq(subscriptions.inBlogroll, true));
  const subRows = await db
    .select({
      folderId: subscriptions.folderId,
      customTitle: subscriptions.customTitle,
      title: feeds.title,
      feedUrl: feeds.feedUrl,
      siteUrl: feeds.siteUrl,
      faviconUrl: feeds.faviconUrl,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(and(...subFilters))
    .orderBy(asc(subscriptions.position), asc(subscriptions.createdAt));

  return assembleFeedTree(folderRows, subRows, { pruneEmptyFolders: opts.blogrollOnly });
}
