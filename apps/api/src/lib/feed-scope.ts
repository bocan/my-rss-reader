import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { folders, subscriptions } from '../db/schema.js';

/**
 * A folder scope is the folder plus its child folders (#25), like Feedly and
 * Inoreader: its list, its mark-all-read, and its badge all cover both.
 * Nesting is one level deep, so the children are the whole subtree. Scoped to
 * userId, so a crafted folderId never reaches another user's folders.
 */
export async function folderScopeIds(userId: string, folderId: string): Promise<string[]> {
  const children = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.userId, userId), eq(folders.parentId, folderId)));
  return [folderId, ...children.map((c) => c.id)];
}

/**
 * Resolve the user's subscribed feed ids, optionally narrowed. feedId wins over
 * folderId; feedId narrows to that single subscription (empty when not
 * subscribed); folderId narrows to the folder and its child folders
 * (folderScopeIds); neither returns every subscribed feed. Always scoped to
 * userId, so a crafted feedId/folderId can never reach feeds the user does not
 * follow.
 *
 * `excludeHidden` drops feeds hidden from All items when no feedId/folderId is
 * given, matching the All-items list (SPEC-018).
 */
export async function resolveSubscribedFeedIds(
  userId: string,
  scope: { feedId?: string; folderId?: string; excludeHidden?: boolean } = {},
): Promise<string[]> {
  const filters = [eq(subscriptions.userId, userId)];
  if (scope.feedId) {
    filters.push(eq(subscriptions.feedId, scope.feedId));
  } else if (scope.folderId) {
    filters.push(inArray(subscriptions.folderId, await folderScopeIds(userId, scope.folderId)));
  } else if (scope.excludeHidden) {
    filters.push(eq(subscriptions.hideFromAll, false));
  }
  const rows = await db
    .select({ feedId: subscriptions.feedId })
    .from(subscriptions)
    .where(and(...filters));
  return rows.map((r) => r.feedId);
}
