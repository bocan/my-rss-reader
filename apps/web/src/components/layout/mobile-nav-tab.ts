import type { ArticleFilters } from '@/hooks/use-articles';

export type MobileNavTab = 'all' | 'starred' | 'search' | 'settings';

/**
 * Which bottom-nav tab is the current scope (#22). Only a real match lights a
 * tab: Shared, Precious, Community, a feed, or a folder light none.
 */
export function mobileNavTab({
  isSearching,
  communityOpen,
  filters,
}: {
  isSearching: boolean;
  communityOpen: boolean;
  filters: ArticleFilters;
}): MobileNavTab | null {
  if (isSearching) return 'search';
  if (communityOpen) return null;
  if (filters.starred) return 'starred';
  const allItems =
    !filters.feedId && !filters.folderId && !filters.shared && !filters.attention;
  return allItems ? 'all' : null;
}
