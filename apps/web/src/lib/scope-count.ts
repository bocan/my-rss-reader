import type { ArticleFilters } from '@/hooks/use-articles';

export interface ScopeCounts {
  byFeed: Map<string, number>;
  byFolder: Map<string, number>;
  total: number;
  mustRead: number;
}

/**
 * The unread count the header shows for a scope (#39), or null for none.
 * Starred and Shared have no unread count from the API, so they show none
 * rather than the All items total. Must read shows its own total.
 */
export function unreadForScope(
  filters: Pick<ArticleFilters, 'feedId' | 'folderId' | 'starred' | 'shared' | 'attention'>,
  counts: ScopeCounts,
): number | null {
  if (filters.feedId) return counts.byFeed.get(filters.feedId) ?? 0;
  if (filters.folderId) return counts.byFolder.get(filters.folderId) ?? 0;
  if (filters.starred || filters.shared) return null;
  if (filters.attention === 'precious') return counts.mustRead;
  return counts.total;
}
