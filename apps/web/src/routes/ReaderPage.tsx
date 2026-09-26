import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
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
import { mobileNavTab } from '@/components/layout/mobile-nav-tab';
import { CommunityPane } from '@/components/community/CommunityPane';
import { ArticleStepper } from '@/components/reader/ArticleStepper';
import { BrowseSurface } from '@/components/reader/BrowseSurface';
import { ListColumn } from '@/components/reader/ListColumn';
import { ViewSwitcher } from '@/components/reader/ViewSwitcher';
import { ReadingPane } from '@/components/reading-pane/ReadingPane';
import { ShortcutsOverlay } from '@/components/shortcuts/ShortcutsOverlay';
import { FeedSortMenu } from '@/components/sidebar/feed-sort-menu';
import { FolderTree } from '@/components/sidebar/folder-tree';
import { SubscribeDialog } from '@/components/subscribe-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useArticleSurface } from '@/hooks/use-article-surface';
import { useArticleToggles } from '@/hooks/use-article-toggles';
import type { ArticleFilters, ArticleListItem } from '@/hooks/use-articles';
import { useLeaveGoneFeed } from '@/hooks/use-leave-gone-feed';
import { useListView, type ViewScope } from '@/hooks/use-list-view';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useSidebar } from '@/hooks/use-sidebar';
import { announce } from '@/lib/announce';
import { notify } from '@/lib/notify';
import { useUnreadCounts } from '@/lib/articles';
import { OLDER_THAN, olderThan, useMarkAllRead } from '@/lib/mark-all-read';
import { useSession } from '@/lib/auth';
import { useCommunityShares } from '@/lib/community';
import { isFeedSort, orderedVisibleFeedIds, type FeedSort } from '@/lib/feed-order';
import {
  useFolders,
  useRefreshFeeds,
  useSubscriptions,
  useUpdateFolder,
  useUpdateSubscription,
} from '@/lib/folders';
import { useProfile } from '@/lib/profile';
import { useExpandedFolders } from '@/lib/sidebar-expanded';
import { useSettings } from '@/lib/settings';
import { useUnreadOnly } from '@/lib/unread-only';
import type { ShortcutContextName } from '@/lib/shortcuts/registry';
import { cn } from '@/lib/utils';
import type { ViewMode } from '@rss/shared';

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

  // Sidebar ordering: by name, by unread, or manual (#27). Persisted locally.
  const [feedSort, setFeedSort] = useState<FeedSort>(() => {
    try {
      const saved = window.localStorage.getItem('reader:feed-sort');
      return isFeedSort(saved) ? saved : 'name';
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
  // the sidebar. A global toggle (not per-scope), the same value as Settings.
  const [unreadOnly, setUnreadOnly] = useUnreadOnly();

  const { data: feedsData, isLoading } = useSubscriptions();
  // Stable identity so downstream useMemos (feedMeta, feedOrder) do not churn.
  const subs = useMemo(() => feedsData?.items ?? [], [feedsData]);
  const { data: foldersData } = useFolders();
  const { data: counts } = useUnreadCounts();

  const countByFeed = useMemo(
    () => new Map((counts?.feeds ?? []).map((f) => [f.feedId, f.unreadCount])),
    [counts],
  );
  const countByFolder = useMemo(
    () => new Map((counts?.folders ?? []).map((f) => [f.folderId, f.unreadCount])),
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

  // List layout (the Inoreader model, see useListView): a feed or folder shows
  // its saved layout, else the user default. The switcher saves where you are
  // only; on All items it sets the default. Feed settings edits the same field.
  const refreshFeeds = useRefreshFeeds();
  const updateSub = useUpdateSubscription();
  const updateFolder = useUpdateFolder();
  const currentSub = filters.feedId ? subs.find((s) => s.feedId === filters.feedId) : undefined;
  const currentFolder = filters.folderId
    ? foldersData?.items.find((f) => f.id === filters.folderId)
    : undefined;
  const scopeKey = `${filters.feedId ?? ''}|${filters.folderId ?? ''}|${filters.starred ?? ''}|${filters.shared ?? ''}|${filters.attention ?? ''}`;
  const isAllItems =
    !filters.feedId && !filters.folderId && !filters.starred && !filters.shared && !filters.attention;
  const viewScope: ViewScope = currentSub
    ? { kind: 'feed', subscriptionId: currentSub.subscriptionId, saved: currentSub.viewMode }
    : currentFolder
      ? { kind: 'folder', folderId: currentFolder.id, saved: currentFolder.viewMode ?? null }
      : isAllItems
        ? { kind: 'all' }
        : { kind: 'other' };
  const [view, setView] = useListView(viewScope, scopeKey, settings.defaultViewMode, {
    feed: (id, viewMode) => updateSub.mutate({ id, viewMode }),
    folder: (id, viewMode) => updateFolder.mutate({ id, viewMode }),
    default: (defaultViewMode) => updateSettings({ defaultViewMode }),
  });
  const isBrowse = view === 'cards' || view === 'magazine';

  const [searchInput, setSearchInput] = useState('');
  // Phones (below sm) show the search box only after the Search tab is used,
  // and while it holds a query.
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);
  const phoneSearchShown = phoneSearchOpen || searchInput !== '';
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
  // Stepping between articles (#23) replaces the history entry, so Back
  // still returns to the list instead of walking back through every article.
  const selectArticle = (id: string, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    next.set('article', id);
    setSearchParams(next, { replace });
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
  // An unsubscribed feed in view falls back to All items (#16).
  const subscribedFeedIds = useMemo(
    () => (feedsData ? new Set(feedsData.items.map((s) => s.feedId)) : undefined),
    [feedsData],
  );
  useLeaveGoneFeed(filters.feedId, subscribedFeedIds, () => {
    clearArticle();
    setFilters({ sort: 'newest' });
  });
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
  const surface = useArticleSurface(effectiveFilters, openInPlace, {
    markReadOnScroll: settings.markReadOnScroll,
    onOpen: (article) => selectArticle(article.id, { replace: true }),
  });

  // Keep keyboard focus on the open article (e.g. after a deep link), so
  // Next / Previous step from it.
  const hasItems = surface.items.length > 0;
  useEffect(() => {
    if (selectedId && surface.items.some((a) => a.id === selectedId)) {
      surface.setFocusedId(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the open article or the first page changes
  }, [selectedId, hasItems]);
  const adjacent = selectedId ? surface.adjacency(selectedId) : null;
  const stepper = adjacent && (
    <ArticleStepper
      hasPrev={adjacent.hasPrev}
      hasNext={adjacent.hasNext}
      onPrev={() => surface.openAdjacent(-1)}
      onNext={() => surface.openAdjacent(1)}
    />
  );

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
  const markAll = useMarkAllRead();
  // Undo on the toast replaces the old "more than 20?" confirm (#26).
  // `olderThanMs` keeps items newer than that unread.
  function markAllRead(olderThanMs?: number) {
    // Only what this list could have shown: nothing stored after it loaded.
    const fetchedBefore = surface.asOf ?? undefined;
    const before = olderThanMs ? olderThan(olderThanMs) : undefined;
    const scope = filters.feedId
      ? { feedId: filters.feedId }
      : filters.folderId
        ? { folderId: filters.folderId }
        : {};
    markAll({ ...scope, fetchedBefore, before }, scopeLabel);
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

  // The open article, else the focused row.
  const targetId = selectedId ?? surface.getFocused()?.id ?? null;
  const toggles = useArticleToggles(targetId);

  // Only the below-lg full-screen reader in list/compact takes over the
  // context; everywhere else j/k keep working over the visible items.
  const readerTakesContext = Boolean(selectedId) && !isWide && !isBrowse;
  const activeContext: ShortcutContextName = readerTakesContext ? 'reader' : 'list';
  useShortcuts(activeContext, {
    // With an article open, j/k open the next/previous one in every layout;
    // otherwise they move the list focus.
    selectNext: () => (selectedId ? surface.openAdjacent(1) : surface.focusNext()),
    selectPrev: () => (selectedId ? surface.openAdjacent(-1) : surface.focusPrev()),
    openFocused: () => {
      const a = surface.getFocused();
      if (a) selectArticle(a.id);
    },
    closeReader: () => (overlayOpen ? setOverlayOpen(false) : clearArticle()),
    toggleRead: toggles.toggleRead,
    markUnread: toggles.markUnread,
    toggleStar: toggles.toggleStar,
    toggleShared: toggles.toggleShared,
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
          <FeedSortMenu sort={feedSort} onChange={setFeedSort} />
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
        countByFolder={countByFolder}
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
      <span
        className={cn(
          'min-w-0 truncate text-sm font-medium',
          // An open phone search box takes the label's place.
          phoneSearchShown && 'hidden sm:inline',
        )}
      >
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
      <div className={cn('ml-auto flex items-center gap-2', phoneSearchShown && 'flex-1 sm:flex-none')}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fetch all feeds now"
          title="Fetch all feeds now"
          disabled={refreshFeeds.isPending}
          onClick={() => {
            announce('Fetching all feeds');
            refreshFeeds.mutate(undefined, {
              onSuccess: ({ refreshed }) =>
                notify.success(`Fetched ${refreshed} ${refreshed === 1 ? 'feed' : 'feeds'}.`),
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
          onBlur={() => {
            if (!searchInput) setPhoneSearchOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchInput('');
              setPhoneSearchOpen(false);
              e.currentTarget.blur();
            }
          }}
          placeholder="Search"
          aria-label="Search articles"
          className={cn(
            'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block sm:w-44 sm:flex-none lg:w-56',
            // Phones reach search from the bottom nav's Search tab.
            phoneSearchShown ? 'block w-full flex-1' : 'hidden',
          )}
        />
        {canMarkAll && !isSearching && unreadForView > 0 && (
          <div className="hidden items-center sm:flex">
            <Button variant="ghost" size="sm" className="rounded-r-none pr-2" onClick={() => markAllRead()}>
              Mark all read
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-l-none px-1"
                  aria-label="Mark older articles read"
                  title="Mark older articles read"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {OLDER_THAN.map((o) => (
                  <DropdownMenuItem key={o.label} onSelect={() => markAllRead(o.ms)}>
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <Button
          variant={unreadOnly ? 'default' : 'ghost'}
          size="icon"
          className="hidden sm:inline-flex"
          aria-pressed={unreadOnly}
          aria-label={unreadOnly ? 'Showing unread only' : 'Show unread only'}
          title={
            unreadOnly
              ? 'Showing unread only — click to show all'
              : 'Show unread only'
          }
          onClick={() => {
            setUnreadOnly(!unreadOnly);
            announce(unreadOnly ? 'Showing all articles' : 'Showing unread only');
          }}
        >
          {unreadOnly ? <CircleDot /> : <Circle />}
        </Button>
        <div className="hidden sm:flex">
          <ViewSwitcher view={view} onChange={setView} />
        </div>
      </div>
    </>
  );

  // Below sm the header keeps only back, the scope, and refresh; the rest of
  // the bar lives in AppShell's "More actions" menu (#22).
  const phoneMenu = (
    <>
      {canMarkAll && !isSearching && unreadForView > 0 && (
        <>
          <DropdownMenuItem onSelect={() => markAllRead()}>Mark all read</DropdownMenuItem>
          {OLDER_THAN.map((o) => (
            <DropdownMenuItem key={o.label} onSelect={() => markAllRead(o.ms)}>
              Mark read: {o.label.toLowerCase()}
            </DropdownMenuItem>
          ))}
        </>
      )}
      <DropdownMenuCheckboxItem
        checked={unreadOnly}
        onCheckedChange={(on) => {
          setUnreadOnly(on);
          announce(on ? 'Showing unread only' : 'Showing all articles');
        }}
      >
        Unread only
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>View</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={view} onValueChange={(v) => setView(v as ViewMode)}>
        <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="cards">Cards</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="magazine">Magazine</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );

  return (
    <AppShell
      leading={
        // The sidebar exists from md up; phones use the feed picker instead.
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={!collapsed}
          onClick={toggleSidebar}
        >
          <PanelLeft />
        </Button>
      }
      bar={topBar}
      phoneMenu={phoneMenu}
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
              stepper={stepper}
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
                      {/* Keyed so each article starts at the top when stepping. */}
                      <ReadingPane key={selectedId} articleId={selectedId} stepper={stepper} />
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
          active={mobileNavTab({ isSearching, communityOpen, filters })}
          onAll={() => pickScope(() => setFilters({ sort: 'newest' }))}
          onStarred={() => pickScope(() => setFilters({ starred: true, sort: 'newest' }))}
          onSearch={() => {
            if (mobileStep === 'feeds') goToList();
            // Below sm the search box shows only on demand; focus it once shown.
            setPhoneSearchOpen(true);
            requestAnimationFrame(() => searchRef.current?.focus());
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
