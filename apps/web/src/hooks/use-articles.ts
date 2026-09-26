import type { Paginated } from '@rss/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { liveQueryOptions } from '@/lib/live-refresh';

export interface ArticleListItem {
  id: string;
  feedId: string;
  title: string | null;
  url: string | null;
  author: string | null;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  read: boolean;
  starred: boolean;
}

export interface ArticleFilters {
  feedId?: string;
  folderId?: string;
  unread?: boolean;
  starred?: boolean;
  /** Only the caller's shared items (SPEC-019). */
  shared?: boolean;
  /** Restrict to subscriptions of one attention tier (SPEC-022). */
  attention?: 'firehose' | 'normal' | 'precious';
  /** Full-text query. When set the API orders by relevance and ignores sort. */
  q?: string;
  sort: 'newest' | 'oldest';
}

function buildQuery(filters: ArticleFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.feedId) params.set('feedId', filters.feedId);
  if (filters.folderId) params.set('folderId', filters.folderId);
  if (filters.unread !== undefined) params.set('unread', String(filters.unread));
  if (filters.starred) params.set('starred', 'true');
  if (filters.shared) params.set('shared', 'true');
  if (filters.attention) params.set('attention', filters.attention);
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort);
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
}

/**
 * How many articles joined this list after it loaded (`since` is its asOf),
 * checked every few minutes and on focus (#30). The list itself never
 * changes by this; the user loads them from the "N new" bar. Search has no
 * such count.
 */
export function useNewArticleCount(filters: ArticleFilters, since: string | null) {
  const { data } = useQuery({
    queryKey: ['new-articles', filters, since],
    queryFn: () => {
      const params = new URLSearchParams(buildQuery(filters, null));
      params.delete('sort');
      params.set('since', since!);
      return api<{ count: number }>(`/articles/new-count?${params.toString()}`);
    },
    enabled: since !== null && !filters.q,
    // The list just loaded, so there is nothing new yet: first check later.
    initialData: { count: 0 },
    refetchOnMount: false,
    ...liveQueryOptions,
  });
  return data.count;
}

export function useArticles(filters: ArticleFilters) {
  return useInfiniteQuery({
    queryKey: ['articles', filters],
    queryFn: ({ pageParam }) =>
      api<Paginated<ArticleListItem>>(`/articles${buildQuery(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
