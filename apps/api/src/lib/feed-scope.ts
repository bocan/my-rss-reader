import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';

/**
 * Resolve the user's subscribed feed ids, optionally narrowed. feedId wins over
 * folderId; feedId narrows to that single subscription (empty when not
 * subscribed); folderId narrows to subscriptions with that exact folderId;
 * neither returns every subscribed feed. Always scoped to userId, so a crafted
 * feedId/folderId can never reach feeds the user does not follow.
 */
export async function resolveSubscribedFeedIds(
  userId: string,
  scope: { feedId?: string; folderId?: string } = {},
): Promise<string[]> {
  const filters = [eq(subscriptions.userId, userId)];
  if (scope.feedId) {
    filters.push(eq(subscriptions.feedId, scope.feedId));
  } else if (scope.folderId) {
    filters.push(eq(subscriptions.folderId, scope.folderId));
  }
  const rows = await db
    .select({ feedId: subscriptions.feedId })
    .from(subscriptions)
    .where(and(...filters));
  return rows.map((r) => r.feedId);
}
