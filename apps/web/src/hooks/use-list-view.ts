import type { SortOrder, ViewMode } from '@rss/shared';
import { useState } from 'react';

/** Where the reader is, for a choice saved per scope (layout, sort order). */
export type ChoiceScope<T> =
  | { kind: 'feed'; subscriptionId: string; saved: T | null }
  | { kind: 'folder'; folderId: string; saved: T | null }
  | { kind: 'all' }
  /** Starred, Shared, Precious: short lists that just use the default. */
  | { kind: 'other' };

export interface ChoiceSavers<T> {
  feed: (subscriptionId: string, value: T) => void;
  folder: (folderId: string, value: T) => void;
  default: (value: T) => void;
}

/**
 * A choice saved per scope (the Inoreader model). Each scope shows its saved
 * value, else the user default. A pick saves where you are and nowhere else:
 *
 *  - on a feed: that feed's value (the same field feed settings edits)
 *  - on a folder: that folder's value (not its feeds')
 *  - on All items: the user default, which every unsaved scope follows
 *  - elsewhere: this visit only; it lapses when the scope changes
 *
 * Saves go through optimistic cache writes, so `saved` (or the default)
 * changes at once and the value follows without any local override.
 */
export function useScopedChoice<T extends string>(
  scope: ChoiceScope<T>,
  scopeKey: string,
  fallback: T,
  save: ChoiceSavers<T>,
): [T, (value: T) => void] {
  const [pick, setPick] = useState<{ key: string; value: T } | null>(null);
  const saved = scope.kind === 'feed' || scope.kind === 'folder' ? scope.saved : null;
  const visitPick = scope.kind === 'other' && pick?.key === scopeKey ? pick.value : null;
  const value = visitPick ?? saved ?? fallback;

  const setValue = (next: T) => {
    if (next === value) return;
    switch (scope.kind) {
      case 'feed':
        return save.feed(scope.subscriptionId, next);
      case 'folder':
        return save.folder(scope.folderId, next);
      case 'all':
        return save.default(next);
      case 'other':
        return setPick({ key: scopeKey, value: next });
    }
  };
  return [value, setValue];
}

/** The list layout for the current scope (SPEC-011). */
export type ViewScope = ChoiceScope<ViewMode>;
export type ViewSavers = ChoiceSavers<ViewMode>;
export const useListView = useScopedChoice<ViewMode>;

/** The article order for the current scope (#31). */
export type SortScope = ChoiceScope<SortOrder>;
export const useSortOrder = useScopedChoice<SortOrder>;
