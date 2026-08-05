import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ChevronLeft,
  Circle,
  CircleDot,
  Gem,
  Inbox,
  Keyboard,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shield,
  Star,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommunityPane } from '@/components/community/CommunityPane';
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
import { announce } from '@/lib/announce';
import { useMarkRead, useToggleArticleState, useUnreadCounts } from '@/lib/articles';
import { useSession } from '@/lib/auth';
import { useCommunityShares } from '@/lib/community';
import { orderedVisibleFeedIds, type FeedSort } from '@/lib/feed-order';
import { useFolders, useRefreshFeeds, useSubscriptions } from '@/lib/folders';
import { useProfile } from '@/lib/profile';
import { useExpandedFolders } from '@/lib/sidebar-expanded';
import { useSettings } from '@/lib/settings';
import type { ArticleDetail, ViewMode } from '@rss/shared';
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

  // Sidebar feed ordering (folders are always alphabetical). Persisted locally.
  const [feedSort, setFeedSort] = useState<FeedSort>(() => {
    try {
      return window.localStorage.getItem('reader:feed-sort') === 'unread' ? 'unread' : 'name';
    } catch {
      return 'name';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('reader:feed-sort', feedSort);
    } catch {
      // display preference only
    }
  }, [feedSort]);

  // "Unread only": hides read articles from the lists and read-empty feeds from
  // the sidebar. A global toggle (not per-scope), persisted locally.
  const [unreadOnly, setUnreadOnly] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('reader:unread-only') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('reader:unread-only', String(unreadOnly));
    } catch {
      // display preference only
    }
  }, [unreadOnly]);

  const { data: feedsData, isLoading } = useSubscriptions();
  // Stable identity so downstream useMemos (feedMeta, feedOrder) do not churn.
  const subs = useMemo(() => feedsData?.items ?? [], [feedsData]);
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

  // Precious shelf (SPEC-022): shown only once a precious subscription exists.
  const preciousFeedIds = useMemo(
    () => subs.filter((s) => s.attention === 'precious').map((s) => s.feedId),
    [subs],
  );
  const preciousUnread = preciousFeedIds.reduce((n, id) => n + (countByFeed.get(id) ?? 0), 0);

  const [filters, setFilters] = useState<ArticleFilters>({ sort: 'newest' });

  // Community mode (SPEC-019): swaps the content region to other users'
  // shares. Not filter-driven; any scope pick returns to the article surface.
  const [communityOpen, setCommunityOpen] = useState(false);
  const { data: profile } = useProfile();
  const community = useCommunityShares();
  const showCommunity =
    (community.data?.pages[0]?.items.length ?? 0) > 0 || (profile?.visibility ?? 'off') !== 'off';

  // View resolution. Each scope opens at its effective view: the feed's own
  // override (set in feed settings) if it has one, else the user's default view.
  // The user default is their LAST PICK from the switcher - persisted server-side
  // (settings.defaultViewMode), so it survives login and is only 'cards' until the
  // user has ever clicked the switcher.
  //
  // The switcher does two things: shows the pick immediately for the current scope
  // (viewOverride, so it responds even on a feed that has its own override), and
  // records it as the user default. It never writes a feed's override - that lives
  // only in feed settings, so an overridden feed keeps its view on the next visit.
  // The session override clears on scope change, so navigating to a feed always
  // lands on its effective view.
  const refreshFeeds = useRefreshFeeds();
  const currentSub = filters.feedId ? subs.find((s) => s.feedId === filters.feedId) : undefined;
  const effectiveView: ViewMode = currentSub?.viewMode ?? settings.defaultViewMode;
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const scopeKey = `${filters.feedId ?? ''}|${filters.folderId ?? ''}|${filters.starred ?? ''}|${filters.shared ?? ''}|${filters.attention ?? ''}`;
  useEffect(() => setViewOverride(null), [scopeKey]);
  const view: ViewMode = viewOverride ?? effectiveView;
  const isBrowse = view === 'cards' || view === 'magazine';
  const setView = (mode: ViewMode) => {
    setViewOverride(mode);
    if (mode !== settings.defaultViewMode) updateSettings({ defaultViewMode: mode });
  };

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const isSearching = debouncedQ.length > 0;
  // Searching always searches articles; leave community mode when a query starts.
  useEffect(() => {
    if (isSearching) setCommunityOpen(false);
  }, [isSearching]);
  const effectiveFilters = useMemo(() => {
    let f = filters;
    if (unreadOnly) f = { ...f, unread: true };
    if (debouncedQ) f = { ...f, q: debouncedQ };
    return f;
  }, [filters, unreadOnly, debouncedQ]);

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('article');
  const selectArticle = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('article', id);
    setSearchParams(next);
  };
  const clearArticle = () => {
    if (!searchParams.has('article')) return; // idempotent: no spurious history entry
    const next = new URLSearchParams(searchParams);
    next.delete('article');
    setSearchParams(next);
  };

  // Advance the phone flow to the list when a scope is chosen. The reader step
  // is driven by the ?article search param, so hardware/browser back pops the
  // reader back to the list for free; list -> feeds is the explicit control
  // below (a manual history barrier here would desync react-router's stack).
  const goToList = () => setMobileStep('list');
  // Changing scope always drops the article you were reading, so the reading
  // region resets to the new scope's list/cards/magazine instead of stranding the
  // old article in view while the list underneath changes feeds.
  const pickScope = (apply: () => void) => {
    clearArticle();
    setCommunityOpen(false);
    apply();
    goToList();
  };
  const openCommunity = () => {
    clearArticle();
    setCommunityOpen(true);
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
  const scopeLabel = communityOpen
    ? 'Community'
    : filters.starred
      ? 'Starred'
      : filters.shared
        ? 'Shared'
        : filters.attention === 'precious'
          ? 'Precious'
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
  const canMarkAll = !filters.starred && !filters.shared && !filters.attention && !communityOpen;
  const markRead = useMarkRead();
  function markAllRead() {
    if (unreadForView > 20 && !window.confirm(`Mark ${unreadForView} articles as read?`)) return;
    markRead.mutate(
      filters.feedId ? { feedId: filters.feedId } : filters.folderId ? { folderId: filters.folderId } : {},
    );
    announce(`Marked ${unreadForView} ${unreadForView === 1 ? 'article' : 'articles'} as read in ${scopeLabel}`);
  }

  // --- Keyboard layer (SPEC-008) ---------------------------------------
  // n/p step through feeds in the exact order the sidebar shows them (folders
  // alphabetical, feeds by the active sort), skipping feeds hidden inside
  // collapsed folders. Shares the ordering and expanded state with the tree.
  const expandedFolders = useExpandedFolders();
  const feedOrder = useMemo(
    () =>
      orderedVisibleFeedIds({
        folders: foldersData?.items ?? [],
        subs,
        sort: feedSort,
        countByFeed,
        expanded: expandedFolders,
      }),
    [foldersData, subs, feedSort, countByFeed, expandedFolders],
  );
  const stepFeed = (delta: number) => {
    if (feedOrder.length === 0) return;
    const at = filters.feedId ? feedOrder.indexOf(filters.feedId) : -1;
    const next = (at + delta + feedOrder.length) % feedOrder.length;
    const feedId = feedOrder[at === -1 && delta < 0 ? feedOrder.length - 1 : next];
    if (feedId) {
      clearArticle(); // same reset as clicking a feed: don't strand the open article
      setFilters({ feedId, sort: 'newest' });
    }
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
    toggleShared: () => {
      if (!targetId) return;
      // Shared state lives on the detail shape only; an article never opened
      // this session reads as unshared and S shares it.
      const detail = queryClient.getQueryData<ArticleDetail>(['article', targetId]);
      const next = !(detail?.shared ?? false);
      toggle.mutate({ shared: next });
      announce(next ? 'Added to shared items' : 'Removed from shared items');
    },
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
            className={navItem(
              !filters.feedId &&
                !filters.starred &&
                !filters.folderId &&
                !filters.shared &&
                !filters.attention &&
                !communityOpen,
            )}
            onClick={() => pickScope(() => setFilters({ sort: 'newest' }))}
          >
            <Inbox className="size-4" />
            <span className="flex-1">All items</span>
            <CountBadge n={counts?.total ?? 0} />
          </button>
        </li>
        <li>
          <button
            className={navItem(Boolean(filters.starred) && !communityOpen)}
            onClick={() => pickScope(() => setFilters({ starred: true, sort: 'newest' }))}
          >
            <Star className="size-4" /> Starred
          </button>
        </li>
        <li>
          <button
            className={navItem(Boolean(filters.shared) && !communityOpen)}
            onClick={() => pickScope(() => setFilters({ shared: true, sort: 'newest' }))}
          >
            <Share2 className="size-4" /> Shared
          </button>
        </li>
        {preciousFeedIds.length > 0 && (
          <li>
            <button
              className={navItem(filters.attention === 'precious' && !communityOpen)}
              onClick={() =>
                pickScope(() => setFilters({ attention: 'precious', sort: 'newest' }))
              }
            >
              <Gem className="size-4 text-primary" />
              <span className="flex-1">Precious</span>
              {preciousUnread > 0 && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-primary">
                  {preciousUnread}
                </span>
              )}
            </button>
          </li>
        )}
        {showCommunity && (
          <li>
            <button className={navItem(communityOpen)} onClick={openCommunity}>
              <Users className="size-4" /> Community
            </button>
          </li>
        )}
      </ul>

      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Feeds
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={feedSort === 'name' ? 'Sort feeds by unread' : 'Sort feeds by name'}
            title={feedSort === 'name' ? 'Sorted by name — click to sort by unread' : 'Sorted by unread — click to sort by name'}
            onClick={() => setFeedSort((s) => (s === 'name' ? 'unread' : 'name'))}
          >
            {feedSort === 'name' ? (
              <ArrowDownAZ className="size-3.5" />
            ) : (
              <ArrowDownWideNarrow className="size-3.5" />
            )}
          </Button>
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
      </div>
      {isLoading && <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && subs.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No subscriptions yet.</p>
      )}
      <FolderTree
        activeFeedId={communityOpen ? undefined : filters.feedId}
        activeFolderId={communityOpen ? undefined : filters.folderId}
        onSelectFeed={onSelectFeed}
        onSelectFolder={onSelectFolder}
        countByFeed={countByFeed}
        sort={feedSort}
        hideRead={unreadOnly}
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
            {unreadForView > 0 && !communityOpen && !filters.shared && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{unreadForView}</span>
            )}
          </>
        )}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fetch all feeds now"
          title="Fetch all feeds now"
          disabled={refreshFeeds.isPending}
          onClick={() => {
            announce('Fetching all feeds');
            refreshFeeds.mutate(undefined, {
              onSuccess: () => announce('Feeds updated'),
              onError: () => announce('Could not fetch feeds'),
            });
          }}
        >
          <RefreshCw
            className={cn(
              refreshFeeds.isPending && 'animate-spin motion-reduce:animate-none',
            )}
          />
        </Button>
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
        <Button
          variant={unreadOnly ? 'default' : 'ghost'}
          size="icon"
          aria-pressed={unreadOnly}
          aria-label={unreadOnly ? 'Showing unread only' : 'Show unread only'}
          title={
            unreadOnly
              ? 'Showing unread only — click to show all'
              : 'Show unread only'
          }
          onClick={() =>
            setUnreadOnly((v) => {
              const next = !v;
              announce(next ? 'Showing unread only' : 'Showing all articles');
              return next;
            })
          }
        >
          {unreadOnly ? <CircleDot /> : <Circle />}
        </Button>
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
      <SubscribeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubscribed={(feedId) => pickScope(() => setFilters({ feedId, sort: 'newest' }))}
      />
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

        {/* Content region: community shares, list-beside-reader, or the
            full-width browse surface. */}
        <div className={cn('min-h-0 flex-1', showFeedPicker && 'hidden')}>
          {communityOpen ? (
            <CommunityPane />
          ) : isBrowse ? (
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
