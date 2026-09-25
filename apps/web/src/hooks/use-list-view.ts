import type { ViewMode } from '@rss/shared';
import { useState } from 'react';

/** Where the reader is, as far as list layout is concerned. */
export type ViewScope =
  | { kind: 'feed'; subscriptionId: string; saved: ViewMode | null }
  | { kind: 'folder'; folderId: string; saved: ViewMode | null }
  | { kind: 'all' }
  /** Starred, Shared, Precious: short lists that just use the default. */
  | { kind: 'other' };

export interface ViewSavers {
  feed: (subscriptionId: string, mode: ViewMode) => void;
  folder: (folderId: string, mode: ViewMode) => void;
  default: (mode: ViewMode) => void;
}

/**
 * The list layout for the current scope, and what a switcher pick does
 * (the Inoreader model). Each scope shows its saved layout, else the user
 * default. A pick saves where you are and nowhere else:
 *
 *  - on a feed: that feed's layout (the same field feed settings edits)
 *  - on a folder: that folder's layout (not its feeds')
 *  - on All items: the user default, which every unsaved scope follows
 *  - elsewhere: this visit only; it lapses when the scope changes
 *
 * Saves go through optimistic cache writes, so `saved` (or the default)
 * changes at once and the view follows without any local override.
 */
export function useListView(
  scope: ViewScope,
  scopeKey: string,
  defaultView: ViewMode,
  save: ViewSavers,
): [ViewMode, (mode: ViewMode) => void] {
  const [pick, setPick] = useState<{ key: string; mode: ViewMode } | null>(null);
  const saved = scope.kind === 'feed' || scope.kind === 'folder' ? scope.saved : null;
  const visitPick = scope.kind === 'other' && pick?.key === scopeKey ? pick.mode : null;
  const view = visitPick ?? saved ?? defaultView;

  const setView = (mode: ViewMode) => {
    if (mode === view) return;
    switch (scope.kind) {
      case 'feed':
        return save.feed(scope.subscriptionId, mode);
      case 'folder':
        return save.folder(scope.folderId, mode);
      case 'all':
        return save.default(mode);
      case 'other':
        return setPick({ key: scopeKey, mode });
    }
  };
  return [view, setView];
}
