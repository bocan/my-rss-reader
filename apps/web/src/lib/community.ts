import type { CommunityShare, Paginated } from '@rss/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';

/** Shares from the other users of this instance, newest first (SPEC-019). */
export function useCommunityShares(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['community'],
    queryFn: ({ pageParam }) =>
      api<Paginated<CommunityShare>>(
        `/shares/community${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}
