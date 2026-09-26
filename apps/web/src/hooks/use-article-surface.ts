import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMarkRead } from '@/lib/articles';
import { createScrollReadTracker } from '@/lib/scroll-read';
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
  /** Server time the list was produced; send as mark-read `fetchedBefore`. */
  asOf: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** Refetch the list after a load error. */
  retry: () => void;
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
  { markReadOnScroll = false }: { markReadOnScroll?: boolean } = {},
): ArticleSurface {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useArticles(filters);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  // Server time of the first page: nothing stored after it is on screen.
  const asOf = data?.pages[0]?.asOf ?? null;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  // Where the focused item last was, for when it drops out of the list (#19).
  const lastIndexRef = useRef(-1);
  const focusedIndex = focusedId ? items.findIndex((a) => a.id === focusedId) : -1;
  if (focusedIndex !== -1) lastIndexRef.current = focusedIndex;

  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const filterKey = JSON.stringify(filters);
  const onFocusedChangeRef = useRef(onFocusedChange);
  onFocusedChangeRef.current = onFocusedChange;

  // Mark read on scroll (#17): one observer over every row while enabled.
  const readObserverRef = useRef<IntersectionObserver | null>(null);
  const rowIds = useRef(new WeakMap<Element, string>());

  const registerRow = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      const old = rowRefs.current.get(id);
      if (old && old !== el) readObserverRef.current?.unobserve(old);
      if (el) {
        rowRefs.current.set(id, el);
        rowIds.current.set(el, id);
        readObserverRef.current?.observe(el);
      } else {
        rowRefs.current.delete(id);
      }
    },
    [],
  );

  const markRead = useMarkRead();
  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;

  useEffect(() => {
    if (!markReadOnScroll) return;
    const tracker = createScrollReadTracker({
      isUnread: (id) => itemsRef.current.find((a) => a.id === id)?.read === false,
      flush: (articleIds) => markReadRef.current({ articleIds }),
    });
    // The viewport is the root, so this works for whichever scroller (list
    // column or browse region) holds the rows; the browser still clips each
    // row by its scroll container. The top edge is read per callback.
    const observer = new IntersectionObserver((entries) => {
      const root = rootRef.current;
      if (!root) return;
      const rootTop = root.getBoundingClientRect().top;
      for (const e of entries) {
        const id = rowIds.current.get(e.target);
        if (!id || !root.contains(e.target)) continue;
        const { bottom, height } = e.boundingClientRect;
        tracker.update(id, { isIntersecting: e.isIntersecting, bottom, height }, rootTop);
      }
    });
    readObserverRef.current = observer;
    for (const el of rowRefs.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      readObserverRef.current = null;
      tracker.flushNow();
    };
  }, [markReadOnScroll, filterKey]);

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
      let next: number;
      if (at !== -1) next = at + delta;
      else if (focusedIdRef.current && lastIndexRef.current >= 0) {
        // The focused item left the list (e.g. a refetch dropped it): the item
        // after it now sits at its old index, so step from there, not from 0.
        next = delta > 0 ? lastIndexRef.current : lastIndexRef.current - 1;
      } else next = delta > 0 ? 0 : list.length - 1;

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
    asOf,
    isLoading,
    isError,
    error,
    retry: () => void refetch(),
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
