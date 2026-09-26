import type { ArticleDetail, MarkReadResult, Paginated, UnreadCounts } from '@rss/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
  type QueryClient,
} from '@tanstack/react-query';
import type { ArticleListItem } from '@/hooks/use-articles';
import { api } from './api';
import { liveQueryOptions } from './live-refresh';

type ArticlesData = { pages: Paginated<ArticleListItem>[]; pageParams: unknown[] };
interface FeedItem {
  feedId: string;
  folderId: string | null;
  unreadCount: number;
  hideFromAll: boolean;
  attention: string;
}
type FeedsData = { items: FeedItem[] };
interface FolderItem {
  id: string;
  parentId: string | null;
}

const clamp = (n: number) => Math.max(0, n);

/** Unread counts for the sidebar. Kept fresh by the optimistic writes below. */
export function useUnreadCounts() {
  return useQuery({
    queryKey: ['counts'],
    queryFn: () => api<UnreadCounts>('/counts'),
    // Counts keep up with the worker by themselves (#30).
    ...liveQueryOptions,
  });
}

function feedMeta(qc: QueryClient): Map<string, FeedItem> {
  const items = qc.getQueryData<FeedsData>(['feeds'])?.items ?? [];
  return new Map(items.map((i) => [i.feedId, i]));
}

/**
 * The folder badges a feed in `folderId` counts toward: its folder and that
 * folder's parent (#25; nesting is one level deep), as the server rolls up.
 */
function badgeFolders(qc: QueryClient, folderId: string | null | undefined): string[] {
  if (!folderId) return [];
  const folders = qc.getQueryData<{ items: FolderItem[] }>(['folders'])?.items ?? [];
  const parentId = folders.find((f) => f.id === folderId)?.parentId;
  return parentId ? [folderId, parentId] : [folderId];
}

/**
 * Which feeds a bulk mark-read covers, mirroring the server: one feed, one
 * folder with its child folders (#25), or All items, which leaves out hidden
 * feeds. A feed missing from the cache counts as visible (the refetch
 * corrects any drift).
 */
export function markReadScopeTest(
  qc: QueryClient,
  scope: { feedId?: string; folderId?: string },
): (feedId: string) => boolean {
  const meta = feedMeta(qc);
  if (scope.feedId) return (id) => id === scope.feedId;
  if (scope.folderId) {
    const folderId = scope.folderId;
    return (id) => badgeFolders(qc, meta.get(id)?.folderId).includes(folderId);
  }
  return (id) => !meta.get(id)?.hideFromAll;
}

/**
 * Zero the unread count of every feed in scope, and take exactly those counts
 * off their folders and the total, following the server's rollup rules:
 * hidden and firehose feeds never count toward the total, and firehose feeds
 * never count toward their folder.
 */
function zeroCounts(
  qc: QueryClient,
  c: UnreadCounts,
  inScope: (feedId: string) => boolean,
): UnreadCounts {
  const meta = feedMeta(qc);
  let totalDrop = 0;
  const folderDrop = new Map<string, number>();
  const feeds = c.feeds.map((f) => {
    if (!inScope(f.feedId) || f.unreadCount === 0) return f;
    const m = meta.get(f.feedId);
    const firehose = m?.attention === 'firehose';
    if (!m?.hideFromAll && !firehose) totalDrop += f.unreadCount;
    if (!firehose) {
      for (const id of badgeFolders(qc, m?.folderId)) {
        folderDrop.set(id, (folderDrop.get(id) ?? 0) + f.unreadCount);
      }
    }
    return { ...f, unreadCount: 0 };
  });
  const folders = c.folders.map((f) => {
    const drop = folderDrop.get(f.folderId) ?? 0;
    return drop ? { ...f, unreadCount: clamp(f.unreadCount - drop) } : f;
  });
  return { feeds, folders, total: clamp(c.total - totalDrop) };
}

/** Current read state + feed id for an article, from the list or detail cache. */
function currentState(qc: QueryClient, articleId: string): { read: boolean; feedId: string } | undefined {
  for (const [, data] of qc.getQueriesData<ArticlesData>({ queryKey: ['articles'] })) {
    const found = data?.pages.flatMap((p) => p.items).find((a) => a.id === articleId);
    if (found) return { read: found.read, feedId: found.feedId };
  }
  const detail = qc.getQueryData<ArticleDetail>(['article', articleId]);
  if (detail) return { read: detail.read, feedId: detail.feed.id };
  return undefined;
}

/**
 * An article's read/starred/shared flags as the UI shows them: the detail
 * cache first (the open article; the only shape with `shared`), else its list
 * row. Both carry the same optimistic patches.
 */
export function articleFlags(
  qc: QueryClient,
  articleId: string,
): { read: boolean; starred: boolean; shared: boolean } | undefined {
  const detail = qc.getQueryData<ArticleDetail>(['article', articleId]);
  if (detail) return { read: detail.read, starred: detail.starred, shared: detail.shared };
  for (const [, data] of qc.getQueriesData<ArticlesData>({ queryKey: ['articles'] })) {
    const found = data?.pages.flatMap((p) => p.items).find((a) => a.id === articleId);
    if (found) return { read: found.read, starred: found.starred, shared: false };
  }
  return undefined;
}

function patchArticle(
  qc: QueryClient,
  articleId: string,
  // shared/shareNote only exist on the detail shape; the extra keys are inert
  // on list items.
  patch: Partial<ArticleListItem> & Partial<Pick<ArticleDetail, 'shared' | 'shareNote'>>,
) {
  qc.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((a) => (a.id === articleId ? { ...a, ...patch } : a)),
          })),
        }
      : data,
  );
  qc.setQueryData<ArticleDetail>(['article', articleId], (d) => (d ? { ...d, ...patch } : d));
}

function adjustCounts(qc: QueryClient, feedId: string, delta: number) {
  const meta = qc.getQueryData<FeedsData>(['feeds'])?.items.find((f) => f.feedId === feedId);
  // Mirror the server's rollup rules so optimistic writes cannot drift:
  // hidden feeds (SPEC-018) and firehose feeds (SPEC-022) never contribute to
  // total; firehose feeds never contribute to a folder badge either. A feed
  // counts toward its folder and that folder's parent (#25).
  const firehose = meta?.attention === 'firehose';
  const inTotal = !meta?.hideFromAll && !firehose;
  const folderIds = firehose ? [] : badgeFolders(qc, meta?.folderId);
  qc.setQueryData<UnreadCounts>(['counts'], (c) =>
    c
      ? {
          feeds: c.feeds.map((f) =>
            f.feedId === feedId ? { ...f, unreadCount: clamp(f.unreadCount + delta) } : f,
          ),
          folders: c.folders.map((f) =>
            folderIds.includes(f.folderId) ? { ...f, unreadCount: clamp(f.unreadCount + delta) } : f,
          ),
          total: inTotal ? clamp(c.total + delta) : c.total,
        }
      : c,
  );
}

async function snapshot(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: ['articles'] });
  await qc.cancelQueries({ queryKey: ['counts'] });
  return {
    prevArticles: qc.getQueriesData({ queryKey: ['articles'] }),
    prevCounts: qc.getQueryData<UnreadCounts>(['counts']),
  };
}

type Ctx = {
  prevArticles: [readonly unknown[], unknown][];
  prevCounts: UnreadCounts | undefined;
  /** The open article's detail, which patchArticle also writes. */
  prevDetail?: [readonly unknown[], ArticleDetail | undefined];
};

function restore(qc: QueryClient, ctx: Ctx | undefined) {
  if (!ctx) return;
  for (const [key, data] of ctx.prevArticles) qc.setQueryData(key, data);
  qc.setQueryData(['counts'], ctx.prevCounts);
  if (ctx.prevDetail) qc.setQueryData(ctx.prevDetail[0], ctx.prevDetail[1]);
}

function reconcile(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['articles'] });
  qc.invalidateQueries({ queryKey: ['counts'] });
}

/**
 * After a single-article change (#19): refresh the counts, and let lists the
 * reader is NOT looking at refetch the next time they show. The list on screen
 * keeps its optimistic patch and is not refetched, so an item just read stays
 * (shown as read) in an unread-only list until a scope change or refresh.
 */
function settleOne(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['counts'] });
  qc.invalidateQueries({ queryKey: ['articles'], type: 'inactive' });
}

// Stable mutation keys so a rehydrated paused mutation can find its default
// function and replay after an offline session (SPEC-013).
export const TOGGLE_STATE_KEY = ['toggle-state'] as const;
export const MARK_READ_KEY = ['mark-read'] as const;

type ToggleVars = {
  articleId: string;
  read?: boolean;
  starred?: boolean;
  shared?: boolean;
  shareNote?: string | null;
};
type TogglePatch = Omit<ToggleVars, 'articleId'>;
export type MarkReadScope = {
  feedId?: string;
  folderId?: string;
  before?: string;
  fetchedBefore?: string;
  /** Exactly these articles (mark read on scroll, #17). */
  articleIds?: string[];
};

/**
 * Register the read/star and mark-read mutation logic on the client, keyed by
 * mutationKey. Called once at startup (before the persister resumes paused
 * mutations) so an offline tap that was queued and rehydrated knows how to run.
 */
export function registerMutationDefaults(qc: QueryClient): void {
  qc.setMutationDefaults(TOGGLE_STATE_KEY, {
    meta: { errorMessage: 'Could not update the article.' },
    mutationFn: ({ articleId, read, starred, shared, shareNote }: ToggleVars) =>
      api<void>(`/articles/${articleId}/state`, {
        method: 'PATCH',
        body: { read, starred, shared, shareNote },
      }),
    onMutate: async ({ articleId, ...vars }: ToggleVars): Promise<Ctx> => {
      const detailKey = ['article', articleId] as const;
      const ctx: Ctx = {
        ...(await snapshot(qc)),
        prevDetail: [detailKey, qc.getQueryData<ArticleDetail>(detailKey)],
      };
      const state = currentState(qc, articleId);
      // Only a read change moves counts; starred never does.
      if (vars.read !== undefined && state && state.read !== vars.read) {
        adjustCounts(qc, state.feedId, vars.read ? -1 : 1);
      }
      patchArticle(qc, articleId, vars);
      return ctx;
    },
    onError: (_e: unknown, _v: ToggleVars, ctx: Ctx | undefined) => restore(qc, ctx),
    onSettled: () => settleOne(qc),
  });

  qc.setMutationDefaults(MARK_READ_KEY, {
    meta: { errorMessage: 'Could not mark the articles as read.' },
    mutationFn: (scope: MarkReadScope) =>
      api<MarkReadResult>('/articles/mark-read', { method: 'POST', body: scope }),
    onMutate: async (scope: MarkReadScope): Promise<Ctx> => {
      const ctx = await snapshot(qc);
      if (scope.articleIds) {
        for (const id of scope.articleIds) {
          const state = currentState(qc, id);
          if (!state || state.read) continue;
          adjustCounts(qc, state.feedId, -1);
          patchArticle(qc, id, { read: true });
        }
        return ctx;
      }
      // With a `before` cutoff the exact set is unknowable from a partial cache;
      // skip the optimistic write and let onSettled refetch the truth.
      if (scope.before) return ctx;

      const inScope = markReadScopeTest(qc, scope);
      qc.setQueryData<UnreadCounts>(['counts'], (c) => (c ? zeroCounts(qc, c, inScope) : c));

      qc.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((a) => (inScope(a.feedId) ? { ...a, read: true } : a)),
              })),
            }
          : data,
      );
      return ctx;
    },
    onError: (_e: unknown, _v: MarkReadScope, ctx: Ctx | undefined) => restore(qc, ctx),
    // A scroll batch leaves the list on screen as it is (see settleOne); a
    // whole-scope mark refetches, so the list shows the server's truth.
    onSettled: (_d: unknown, _e: unknown, scope: MarkReadScope) =>
      scope.articleIds ? settleOne(qc) : reconcile(qc),
  });
}

/**
 * Optimistically toggle read and/or starred on one article. Thin wrapper over
 * the registered default (see registerMutationDefaults); injects the articleId
 * into the variables so the mutation is self-contained and replayable offline.
 */
export function useToggleArticleState(articleId: string) {
  const m = useMutation<void, Error, ToggleVars, Ctx>({ mutationKey: TOGGLE_STATE_KEY });
  return {
    isPending: m.isPending,
    mutate: (vars: TogglePatch, opts?: MutateOptions<void, Error, ToggleVars, Ctx>) =>
      m.mutate({ articleId, ...vars }, opts),
    mutateAsync: (vars: TogglePatch) => m.mutateAsync({ articleId, ...vars }),
  };
}

/** Optimistically mark a whole scope read (feed, folder, or everything). */
export function useMarkRead() {
  return useMutation<MarkReadResult, Error, MarkReadScope, Ctx>({ mutationKey: MARK_READ_KEY });
}

/** Undo a mark-read (#26): these articles go back to unread, then refetch. */
export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not undo. The articles are still read.' },
    mutationFn: (articleIds: string[]) =>
      api<void>('/articles/mark-unread', { method: 'POST', body: { articleIds } }),
    onSettled: () => reconcile(qc),
  });
}
