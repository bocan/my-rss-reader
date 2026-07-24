import { and, asc, eq, isNull, ne, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../db/index.js';
import { folders, subscriptions } from '../db/schema.js';

/**
 * Dense integer positions, renormalized per sibling scope on every write.
 *
 * A "scope" is a user's rows sharing the same parent: subscriptions with the
 * same folderId (root = null), or folders with the same parentId (root = null).
 * A `position` in a PATCH body is a desired 0-based index within the
 * destination scope, not a literal stored value: the row is placed at that
 * index and the whole scope is rewritten gap-free to 0..n-1.
 *
 * Sibling counts here are tens, not thousands, so a full renormalize is a few
 * indexed updates over one small scope. That keeps position human-readable and
 * ordering a plain ORDER BY, without the drift and rebalancing that fractional
 * indexing eventually forces.
 *
 * Every function takes a transaction so callers can bundle validation, field
 * updates, and renormalization atomically.
 */

/** The transaction handle Drizzle hands to db.transaction(cb). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** `col = value`, or `col IS NULL` when value is null (root scope). */
function scopeMatches(col: PgColumn, value: string | null): SQL {
  return value === null ? isNull(col) : eq(col, value);
}

/** Rewrite a subscription scope to gap-free 0..n-1, current order preserved. */
export async function renormalizeSubscriptionScope(
  tx: Tx,
  userId: string,
  folderId: string | null,
): Promise<void> {
  const rows = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), scopeMatches(subscriptions.folderId, folderId)))
    .orderBy(asc(subscriptions.position), asc(subscriptions.createdAt));

  for (const [i, row] of rows.entries()) {
    await tx.update(subscriptions).set({ position: i }).where(eq(subscriptions.id, row.id));
  }
}

/** Rewrite a folder scope to gap-free 0..n-1, current order preserved. */
export async function renormalizeFolderScope(
  tx: Tx,
  userId: string,
  parentId: string | null,
): Promise<void> {
  const rows = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.userId, userId), scopeMatches(folders.parentId, parentId)))
    .orderBy(asc(folders.position), asc(folders.createdAt));

  for (const [i, row] of rows.entries()) {
    await tx.update(folders).set({ position: i }).where(eq(folders.id, row.id));
  }
}

/**
 * Place a subscription at `desiredIndex` within its (new) scope and rewrite the
 * whole scope to 0..n-1. Omitting the index appends to the end.
 */
export async function placeSubscription(
  tx: Tx,
  userId: string,
  subscriptionId: string,
  folderId: string | null,
  desiredIndex?: number,
): Promise<void> {
  const siblings = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        scopeMatches(subscriptions.folderId, folderId),
        ne(subscriptions.id, subscriptionId),
      ),
    )
    .orderBy(asc(subscriptions.position), asc(subscriptions.createdAt));

  const ids = siblings.map((s: { id: string }) => s.id);
  const index = clamp(desiredIndex ?? ids.length, 0, ids.length);
  const ordered = [...ids.slice(0, index), subscriptionId, ...ids.slice(index)];

  for (const [i, id] of ordered.entries()) {
    await tx.update(subscriptions).set({ position: i }).where(eq(subscriptions.id, id));
  }
}

/**
 * Place a folder at `desiredIndex` within its (new) sibling scope and rewrite
 * the whole scope to 0..n-1. Omitting the index appends to the end.
 */
export async function placeFolder(
  tx: Tx,
  userId: string,
  folderId: string,
  parentId: string | null,
  desiredIndex?: number,
): Promise<void> {
  const siblings = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        scopeMatches(folders.parentId, parentId),
        ne(folders.id, folderId),
      ),
    )
    .orderBy(asc(folders.position), asc(folders.createdAt));

  const ids = siblings.map((f: { id: string }) => f.id);
  const index = clamp(desiredIndex ?? ids.length, 0, ids.length);
  const ordered = [...ids.slice(0, index), folderId, ...ids.slice(index)];

  for (const [i, id] of ordered.entries()) {
    await tx.update(folders).set({ position: i }).where(eq(folders.id, id));
  }
}
