import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useArticles, type ArticleFilters, type ArticleListItem } from './use-articles';

/**
 * Everything an article-browsing surface needs, lifted out of any one layout.
 *
 * SPEC-014 hosts the list/compact column and the cards/magazine browse region in
 * different parts of the screen, so the query, keyboard focus, scroll container
 * and infinite-scroll sentinel cannot live inside either of them. Both surfaces
 * consume this instead, which is also why switching view never refetches or
 * resets pagination.
 */
export interface ArticleSurface {
  items: ArticleListItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  focusNext: () => void;
  focusPrev: () => void;
  focusFirst: () => void;
  getFocused: () => ArticleListItem | null;
  registerRow: (id: string) => (el: HTMLElement | null) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useArticleSurface(
  filters: ArticleFilters,
  onFocusedChange?: (article: ArticleListItem) => void,
): ArticleSurface {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useArticles(filters);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const filterKey = JSON.stringify(filters);
  const onFocusedChangeRef = useRef(onFocusedChange);
  onFocusedChangeRef.current = onFocusedChange;

  const registerRow = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    [],
  );

  const revealRow = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  // Grid order equals array order in every view, so one linear step works for
  // the list column and the cards/magazine grids alike.
  const moveFocus = useCallback(
    (delta: number) => {
      const list = itemsRef.current;
      if (list.length === 0) return;
      const at = focusedIdRef.current
        ? list.findIndex((a) => a.id === focusedIdRef.current)
        : -1;
      let next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : at + delta;

      if (next >= list.length) {
        // Past the last loaded item: pull the next page so `j` keeps working.
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        next = list.length - 1;
      }
      if (next < 0) next = 0;

      const target = list[next];
      if (!target) return;
      setFocusedId(target.id);
      onFocusedChangeRef.current?.(target);
      requestAnimationFrame(() => revealRow(target.id));
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage, revealRow],
  );

  // Reset scroll and focus on a filter change only (never on appended pages).
  useEffect(() => {
    rootRef.current?.scrollTo({ top: 0 });
    setFocusedId(null);
  }, [filterKey]);

  // Infinite scroll, bound to whichever surface is currently mounted.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root: rootRef.current, rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    focusedId,
    setFocusedId,
    focusNext: () => moveFocus(1),
    focusPrev: () => moveFocus(-1),
    focusFirst: () => {
      const first = itemsRef.current[0];
      if (!first) return;
      setFocusedId(first.id);
      onFocusedChangeRef.current?.(first);
      rootRef.current?.scrollTo({ top: 0 });
    },
    getFocused: () => itemsRef.current.find((a) => a.id === focusedIdRef.current) ?? null,
    registerRow,
    rootRef,
    sentinelRef,
  };
}
