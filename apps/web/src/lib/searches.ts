import type { CreateSavedSearchInput, SavedSearchDto } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArticleFilters } from '@/hooks/use-articles';
import { api } from './api';

/**
 * Saved searches (SPEC-025): a named query and scope pinned to the sidebar.
 * Running one is the ordinary article list with these filters, so it lists
 * exactly what the same manual search lists. Online only, like search.
 */

const KEY = ['saved-searches'] as const;

export function useSavedSearches() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<{ items: SavedSearchDto[] }>('/searches'),
  });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not save the search.' },
    mutationFn: (input: CreateSavedSearchInput) =>
      api<SavedSearchDto>('/searches', { method: 'POST', body: input }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRenameSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not rename the search.' },
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<SavedSearchDto>(`/searches/${id}`, { method: 'PATCH', body: { name } }),
    // Show the new name at once.
    onMutate: ({ id, name }) => {
      qc.setQueryData<{ items: SavedSearchDto[] }>(KEY, (d) =>
        d ? { items: d.items.map((s) => (s.id === id ? { ...s, name } : s)) } : d,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not delete the search.' },
    mutationFn: (id: string) => api<void>(`/searches/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** The list filters a saved search opens with. Search orders by relevance,
 *  so the sort is just the default. */
export function savedSearchFilters(s: SavedSearchDto): ArticleFilters {
  return {
    sort: 'newest',
    ...(s.feedId ? { feedId: s.feedId } : {}),
    ...(s.folderId ? { folderId: s.folderId } : {}),
    ...(s.starred ? { starred: true } : {}),
    ...(s.unread !== null ? { unread: s.unread } : {}),
  };
}

/**
 * True while the list shows this saved search: the same query in the box,
 * the same scope. Editing the query, or picking another scope, makes it
 * false, so the sidebar node deselects by itself.
 */
export function showsSavedSearch(s: SavedSearchDto, filters: ArticleFilters, query: string): boolean {
  return (
    query.trim() === s.q &&
    (filters.feedId ?? null) === s.feedId &&
    (filters.folderId ?? null) === s.folderId &&
    Boolean(filters.starred) === s.starred &&
    (filters.unread ?? null) === s.unread &&
    !filters.shared &&
    !filters.attention
  );
}

/**
 * A search can be saved when a saved search can hold its scope: a feed, a
 * folder, Starred or all feeds. Shared and Must read are not part of a saved
 * search, so a search there is not offered for saving.
 */
export function canSaveSearch(filters: ArticleFilters): boolean {
  return !filters.shared && !filters.attention;
}

/**
 * The scope a search is saved with, from the live list: its feed or folder,
 * Starred, and "unread only" (the list's own filter or the global switch).
 */
export function captureScope(filters: ArticleFilters, unreadOnly: boolean) {
  return {
    feedId: filters.feedId ?? null,
    folderId: filters.folderId ?? null,
    starred: Boolean(filters.starred),
    unread: unreadOnly || filters.unread === true ? true : null,
  };
}

/** "in folder Tech, starred, unread only", for the save popover. */
export function describeScope(
  scope: ReturnType<typeof captureScope>,
  names: { feed?: string; folder?: string },
): string {
  const parts = [
    scope.feedId ? `in ${names.feed ?? 'one feed'}` : scope.folderId ? `in folder ${names.folder ?? ''}`.trim() : 'in all feeds',
    ...(scope.starred ? ['starred only'] : []),
    ...(scope.unread ? ['unread only'] : []),
  ];
  return parts.join(', ');
}
