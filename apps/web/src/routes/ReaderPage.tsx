import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Inbox, Keyboard, PanelLeft, Plus, Settings, Shield, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { MobileNav } from '@/components/layout/MobileNav';
import { BrowseSurface } from '@/components/reader/BrowseSurface';
import { ListColumn } from '@/components/reader/ListColumn';
import { ViewSwitcher } from '@/components/reader/ViewSwitcher';
import { ReadingPane } from '@/components/reading-pane/ReadingPane';
import { ShortcutsOverlay } from '@/components/shortcuts/ShortcutsOverlay';
import { FolderTree } from '@/components/sidebar/folder-tree';
import { SubscribeDialog } from '@/components/subscribe-dialog';
import { Button } from '@/components/ui/button';
import { useArticleSurface } from '@/hooks/use-article-surface';
import type { ArticleFilters, ArticleListItem } from '@/hooks/use-articles';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useSidebar } from '@/hooks/use-sidebar';
import { useMarkRead, useToggleArticleState, useUnreadCounts } from '@/lib/articles';
import { useSession } from '@/lib/auth';
import { useFolders, useSubscriptions, useUpdateSubscription } from '@/lib/folders';
import { useSettings } from '@/lib/settings';
import type { ViewMode } from '@rss/shared';
import type { ShortcutContextName } from '@/lib/shortcuts/registry';
import { cn } from '@/lib/utils';

/** Reactively tracks a media query. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** True at the `lg` breakpoint, where list/compact keep the reader as a column. */
function useIsWide(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/** True below `md`: the stacked feeds -> list -> reader phone flow (SPEC-013). */
function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function ReaderPage() {
  const isWide = useIsWide();
  const isPhone = useIsPhone();
  const { collapsed, toggle: toggleSidebar } = useSidebar();
  const { settings, update: updateSettings } = useSettings();
  const { data: me } = useSession();

  // Phone-only stacked navigation: feeds -> list (-> reader, driven by the
  // ?article param). Starts on the feed picker, which desktop keeps in the
  // sidebar but phones otherwise cannot reach.
  const [mobileStep, setMobileStep] = useState<'feeds' | 'list'>('feeds');

  const { data: feedsData, isLoading } = useSubscriptions();
  const subs = feedsData?.items ?? [];
  const { data: foldersData } = useFolders();
  const { data: counts } = useUnreadCounts();

  const countByFeed = useMemo(
    () => new Map((counts?.feeds ?? []).map((f) => [f.feedId, f.unreadCount])),
    [counts],
  );
  const feedMeta = useMemo(
    () =>
      Object.fromEntries(
        subs.map((s) => [s.feedId, { name: s.customTitle ?? s.title ?? s.feedUrl, faviconUrl: s.faviconUrl }]),
      ),
    [subs],
  );

  const [filters, setFilters] = useState<ArticleFilters>({ sort: 'newest' });

  // Active list view: a per-feed override wins over the user default. The
  // switcher writes the override when scoped to a feed, else the default.
  const updateSub = useUpdateSubscription();
  const currentSub = filters.feedId ? subs.find((s) => s.feedId === filters.feedId) : undefined;
  const view: ViewMode = currentSub?.viewMode ?? settings.defaultViewMode;
  const isBrowse = view === 'cards' || view === 'magazine';
  const hasOverride = Boolean(currentSub?.viewMode);
  const setView = (mode: ViewMode) => {
    if (currentSub) updateSub.mutate({ id: currentSub.subscriptionId, viewMode: mode });
    else updateSettings({ defaultViewMode: mode });
  };
  const resetView = () => {
    if (currentSub) updateSub.mutate({ id: currentSub.subscriptionId, viewMode: null });
  };

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const isSearching = debouncedQ.length > 0;
  const effectiveFilters = useMemo(
    () => (debouncedQ ? { ...filters, q: debouncedQ } : filters),
    [filters, debouncedQ],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('article');
  const selectArticle = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('article', id);
    setSearchParams(next);
  };
  const clearArticle = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('article');
    setSearchParams(next);
  };

  // Advance the phone flow to the list when a scope is chosen. The reader step
  // is driven by the ?article search param, so hardware/browser back pops the
  // reader back to the list for free; list -> feeds is the explicit control
  // below (a manual history barrier here would desync react-router's stack).
  const goToList = () => setMobileStep('list');
  const pickScope = (apply: () => void) => {
    apply();
    goToList();
  };

  const [addOpen, setAddOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  // Moving focus opens in place only in list/compact at lg (the reader is a
  // persistent column there). In cards/magazine, j/k only move focus; o/Enter
  // opens by swapping the browse region to the reader.
  const openInPlace = (article: ArticleListItem) => {
    if (isWide && !isBrowse) selectArticle(article.id);
  };
  const surface = useArticleSurface(effectiveFilters, openInPlace);

  // --- Scope chrome + mark all read (top bar) ---------------------------
  const scopeLabel = filters.starred
    ? 'Starred'
    : filters.feedId
      ? (feedMeta[filters.feedId]?.name ?? 'Feed')
      : filters.folderId
        ? (foldersData?.items.find((f) => f.id === filters.folderId)?.name ?? 'Folder')
        : 'All items';
  const unreadForView = filters.feedId
    ? (countByFeed.get(filters.feedId) ?? 0)
    : filters.folderId
      ? (counts?.folders.find((f) => f.folderId === filters.folderId)?.unreadCount ?? 0)
      : (counts?.total ?? 0);
  const canMarkAll = !filters.starred;
  const markRead = useMarkRead();
  function markAllRead() {
    if (unreadForView > 20 && !window.confirm(`Mark ${unreadForView} articles as read?`)) return;
    markRead.mutate(
      filters.feedId ? { feedId: filters.feedId } : filters.folderId ? { folderId: filters.folderId } : {},
    );
  }

  // --- Keyboard layer (SPEC-008) ---------------------------------------
  const feedOrder = subs.map((s) => s.feedId);
  const stepFeed = (delta: number) => {
    if (feedOrder.length === 0) return;
    const at = filters.feedId ? feedOrder.indexOf(filters.feedId) : -1;
    const next = (at + delta + feedOrder.length) % feedOrder.length;
    const feedId = feedOrder[at === -1 && delta < 0 ? feedOrder.length - 1 : next];
    if (feedId) setFilters({ feedId, sort: 'newest' });
  };

  const targetId = selectedId ?? surface.getFocused()?.id ?? null;
  const toggle = useToggleArticleState(targetId ?? '');

  // Only the below-lg full-screen reader in list/compact takes over the
  // context; everywhere else j/k keep working over the visible items.
  const readerTakesContext = Boolean(selectedId) && !isWide && !isBrowse;
  const activeContext: ShortcutContextName = readerTakesContext ? 'reader' : 'list';
  useShortcuts(activeContext, {
    selectNext: surface.focusNext,
    selectPrev: surface.focusPrev,
    openFocused: () => {
      const a = surface.getFocused();
      if (a) selectArticle(a.id);
    },
    closeReader: () => (overlayOpen ? setOverlayOpen(false) : clearArticle()),
    toggleRead: () => {
      if (!targetId) return;
      toggle.mutate({ read: selectedId ? true : !surface.getFocused()?.read });
    },
    markUnread: () => targetId && toggle.mutate({ read: false }),
    toggleStar: () => targetId && toggle.mutate({ starred: !surface.getFocused()?.starred }),
    markAllRead: () => canMarkAll && unreadForView > 0 && markAllRead(),
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['counts'] });
    },
    focusSearch: () => searchRef.current?.focus(),
    nextFeed: () => stepFeed(1),
    prevFeed: () => stepFeed(-1),
    gotoTop: surface.focusFirst,
    toggleOverlay: () => setOverlayOpen((v) => !v),
    toggleSidebar,
  });

  const navItem = (active: boolean) =>
    cn(
      // >=44px hit area on phones for comfortable touch targets (SPEC-013).
      'flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left md:py-1.5',
      active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent',
    );

  // Scope selectors also advance the phone flow to the list step.
  const onSelectFeed = (feedId: string) => pickScope(() => setFilters({ feedId, sort: 'newest' }));
  const onSelectFolder = (folderId: string) =>
    pickScope(() => setFilters({ folderId, sort: 'newest' }));

  // Shared sidebar body, rendered in the desktop aside and the phone feed picker.
  const sidebarInner = (
    <>
      <ul className="space-y-1 text-sm">
        <li>
          <button
            className={navItem(!filters.feedId && !filters.starred && !filters.folderId)}
            onClick={() => pickScope(() => setFilters({ sort: 'newest' }))}
          >
            <Inbox className="size-4" />
            <span className="flex-1">All items</span>
            <CountBadge n={counts?.total ?? 0} />
          </button>
        </li>
        <li>
          <button
            className={navItem(Boolean(filters.starred))}
            onClick={() => pickScope(() => setFilters({ starred: true, sort: 'newest' }))}
          >
            <Star className="size-4" /> Starred
          </button>
        </li>
      </ul>

      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Feeds
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Add subscription"
          onClick={() => setAddOpen(true)}
        >
          <Plus />
        </Button>
      </div>
      {isLoading && <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && subs.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No subscriptions yet.</p>
      )}
      <FolderTree
        activeFeedId={filters.feedId}
        activeFolderId={filters.folderId}
        onSelectFeed={onSelectFeed}
        onSelectFolder={onSelectFolder}
        countByFeed={countByFeed}
      />

      <div className="mt-auto space-y-0.5 pt-2">
        {me?.role === 'admin' && (
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <Shield className="size-3.5" /> Administration
          </Link>
        )}
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Settings className="size-3.5" /> Settings
        </Link>
        <button
          onClick={() => setOverlayOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Keyboard className="size-3.5" /> Shortcuts
          <kbd className="ml-auto rounded border bg-muted px-1 font-mono">?</kbd>
        </button>
      </div>
    </>
  );

  // Swipe-right in the reader returns to the list (phone progressive enhancement).
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onReaderPointerDown = (e: ReactPointerEvent) => {
    swipeStart.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
  };
  const onReaderPointerUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx > 60 && Math.abs(dy) < 40) clearArticle();
  };

  const showFeedPicker = isPhone && mobileStep === 'feeds' && !selectedId;
  const showBottomNav = isPhone && !selectedId;

  const topBar = (
    <>
      {isPhone && mobileStep === 'list' && !selectedId && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to feeds"
          className="-ml-1 shrink-0"
          onClick={() => setMobileStep('feeds')}
        >
          <ChevronLeft />
        </Button>
      )}
      <span className="min-w-0 truncate text-sm font-medium">
        {isSearching ? (
          <>
            Results for <span className="text-muted-foreground">{`"${debouncedQ}"`}</span>
          </>
        ) : (
          <>
            {scopeLabel}
            {unreadForView > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{unreadForView}</span>
            )}
          </>
        )}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search"
          aria-label="Search articles"
          className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44 lg:w-56"
        />
        {canMarkAll && !isSearching && unreadForView > 0 && (
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
        {hasOverride && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden text-xs text-muted-foreground lg:inline-flex"
            title="This feed has its own view; reset to your default"
            onClick={resetView}
          >
            Reset view
          </Button>
        )}
        <ViewSwitcher view={view} onChange={setView} />
      </div>
    </>
  );

  return (
    <AppShell
      leading={
        <Button
          variant="ghost"
          size="icon"
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={!collapsed}
          onClick={toggleSidebar}
        >
          <PanelLeft />
        </Button>
      }
      bar={topBar}
    >
      <SubscribeDialog open={addOpen} onOpenChange={setAddOpen} />
      <ShortcutsOverlay open={overlayOpen} onOpenChange={setOverlayOpen} />

      <div
        className={cn(
          'flex h-full',
          // Lift content above the fixed bottom nav on phones.
          showBottomNav && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0',
        )}
      >
        {/* Desktop sidebar: collapses fully to give the content the whole width. */}
        <aside
          className={cn(
            'hidden shrink-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none md:block',
            collapsed ? 'w-0' : 'w-[260px] border-r',
          )}
        >
          <nav className="flex h-full w-[260px] flex-col overflow-y-auto p-3">{sidebarInner}</nav>
        </aside>

        {/* Phone feed picker: the first step of the stacked flow. */}
        {showFeedPicker && (
          <nav className="flex h-full w-full flex-col overflow-y-auto p-3 md:hidden">
            {sidebarInner}
          </nav>
        )}

        {/* Content region: list-beside-reader, or the full-width browse surface. */}
        <div className={cn('min-h-0 flex-1', showFeedPicker && 'hidden')}>
          {isBrowse ? (
            <BrowseSurface
              surface={surface}
              feeds={feedMeta}
              view={view}
              selectedId={selectedId}
              onSelect={(a) => selectArticle(a.id)}
              onBack={clearArticle}
            />
          ) : (
            <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col lg:border-r">
                <ListColumn
                  surface={surface}
                  feeds={feedMeta}
                  view={view}
                  selectedId={selectedId}
                  onSelect={(a) => selectArticle(a.id)}
                />
              </section>
              <article
                onPointerDown={onReaderPointerDown}
                onPointerUp={onReaderPointerUp}
                className={cn(
                  'min-h-0 bg-background lg:static lg:z-auto lg:block',
                  selectedId ? 'fixed inset-0 z-40 block' : 'hidden lg:block',
                )}
              >
                {selectedId ? (
                  <div className="flex h-full flex-col">
                    <button
                      onClick={clearArticle}
                      className="flex min-h-[44px] items-center gap-1 border-b p-2 text-sm text-muted-foreground hover:text-foreground lg:hidden"
                    >
                      <ChevronLeft className="size-4" /> Back to articles
                    </button>
                    <div className="min-h-0 flex-1">
                      <ReadingPane articleId={selectedId} />
                    </div>
                  </div>
                ) : (
                  <EmptyPane title="Select an article" hint="Nothing selected yet." />
                )}
              </article>
            </div>
          )}
        </div>
      </div>

      {showBottomNav && (
        <MobileNav
          active={
            isSearching
              ? 'search'
              : filters.starred
                ? 'starred'
                : !filters.feedId && !filters.folderId
                  ? 'all'
                  : null
          }
          onAll={() => pickScope(() => setFilters({ sort: 'newest' }))}
          onStarred={() => pickScope(() => setFilters({ starred: true, sort: 'newest' }))}
          onSearch={() => {
            if (mobileStep === 'feeds') goToList();
            searchRef.current?.focus();
          }}
        />
      )}
    </AppShell>
  );
}

function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

function EmptyPane({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
