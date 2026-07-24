import type { Paginated } from '@rss/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort);
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
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
