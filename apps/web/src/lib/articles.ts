import type { ArticleDetail, Paginated, UnreadCounts } from '@rss/shared';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import type { ArticleListItem } from '@/hooks/use-articles';
import { api } from './api';

type ArticlesData = { pages: Paginated<ArticleListItem>[]; pageParams: unknown[] };
interface FeedItem {
  feedId: string;
  folderId: string | null;
  unreadCount: number;
}
type FeedsData = { items: FeedItem[] };

const clamp = (n: number) => Math.max(0, n);

/** Unread counts for the sidebar. Kept fresh by the optimistic writes below. */
export function useUnreadCounts() {
  return useQuery({ queryKey: ['counts'], queryFn: () => api<UnreadCounts>('/counts') });
}

function folderForFeed(qc: QueryClient, feedId: string): string | null {
  return qc.getQueryData<FeedsData>(['feeds'])?.items.find((f) => f.feedId === feedId)?.folderId ?? null;
}

function feedsInFolder(qc: QueryClient, folderId: string): Set<string> {
  const items = qc.getQueryData<FeedsData>(['feeds'])?.items ?? [];
  return new Set(items.filter((i) => i.folderId === folderId).map((i) => i.feedId));
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
  const folderId = folderForFeed(qc, feedId);
  qc.setQueryData<UnreadCounts>(['counts'], (c) =>
    c
      ? {
          feeds: c.feeds.map((f) =>
            f.feedId === feedId ? { ...f, unreadCount: clamp(f.unreadCount + delta) } : f,
          ),
          folders: folderId
            ? c.folders.map((f) =>
                f.folderId === folderId ? { ...f, unreadCount: clamp(f.unreadCount + delta) } : f,
              )
            : c.folders,
          total: clamp(c.total + delta),
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

type Ctx = { prevArticles: [readonly unknown[], unknown][]; prevCounts: UnreadCounts | undefined };

function restore(qc: QueryClient, ctx: Ctx | undefined) {
  if (!ctx) return;
  for (const [key, data] of ctx.prevArticles) qc.setQueryData(key, data);
  qc.setQueryData(['counts'], ctx.prevCounts);
}

function reconcile(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['articles'] });
  qc.invalidateQueries({ queryKey: ['counts'] });
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
type MarkReadScope = { feedId?: string; folderId?: string; before?: string };

/**
 * Register the read/star and mark-read mutation logic on the client, keyed by
 * mutationKey. Called once at startup (before the persister resumes paused
 * mutations) so an offline tap that was queued and rehydrated knows how to run.
 */
export function registerMutationDefaults(qc: QueryClient): void {
  qc.setMutationDefaults(TOGGLE_STATE_KEY, {
    mutationFn: ({ articleId, read, starred, shared, shareNote }: ToggleVars) =>
      api<void>(`/articles/${articleId}/state`, {
        method: 'PATCH',
        body: { read, starred, shared, shareNote },
      }),
    onMutate: async ({ articleId, ...vars }: ToggleVars): Promise<Ctx> => {
      const ctx = await snapshot(qc);
      const state = currentState(qc, articleId);
      // Only a read change moves counts; starred never does.
      if (vars.read !== undefined && state && state.read !== vars.read) {
        adjustCounts(qc, state.feedId, vars.read ? -1 : 1);
      }
      patchArticle(qc, articleId, vars);
      return ctx;
    },
    onError: (_e: unknown, _v: ToggleVars, ctx: Ctx | undefined) => restore(qc, ctx),
    onSettled: () => reconcile(qc),
  });

  qc.setMutationDefaults(MARK_READ_KEY, {
    mutationFn: (scope: MarkReadScope) =>
      api<void>('/articles/mark-read', { method: 'POST', body: scope }),
    onMutate: async (scope: MarkReadScope): Promise<Ctx> => {
      const ctx = await snapshot(qc);
      // With a `before` cutoff the exact set is unknowable from a partial cache;
      // skip the optimistic write and let onSettled refetch the truth.
      if (scope.before) return ctx;

      // Which feeds are in scope: one feed, a folder's feeds, or all (null).
      const feedSet: Set<string> | null = scope.feedId
        ? new Set([scope.feedId])
        : scope.folderId
          ? feedsInFolder(qc, scope.folderId)
          : null;

      qc.setQueryData<UnreadCounts>(['counts'], (c) => {
        if (!c) return c;
        const zeroed = c.feeds.map((f) =>
          !feedSet || feedSet.has(f.feedId) ? { ...f, unreadCount: 0 } : f,
        );
        const removed = c.feeds
          .filter((f) => !feedSet || feedSet.has(f.feedId))
          .reduce((s, f) => s + f.unreadCount, 0);
        const folderId = scope.feedId ? folderForFeed(qc, scope.feedId) : scope.folderId ?? null;
        const folders = feedSet
          ? c.folders.map((f) =>
              f.folderId === folderId ? { ...f, unreadCount: clamp(f.unreadCount - removed) } : f,
            )
          : c.folders.map((f) => ({ ...f, unreadCount: 0 }));
        return { feeds: zeroed, folders, total: clamp(c.total - removed) };
      });

      qc.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((a) =>
                  !feedSet || feedSet.has(a.feedId) ? { ...a, read: true } : a,
                ),
              })),
            }
          : data,
      );
      return ctx;
    },
    onError: (_e: unknown, _v: MarkReadScope, ctx: Ctx | undefined) => restore(qc, ctx),
    onSettled: () => reconcile(qc),
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
    mutate: (vars: TogglePatch) => m.mutate({ articleId, ...vars }),
    mutateAsync: (vars: TogglePatch) => m.mutateAsync({ articleId, ...vars }),
  };
}

/** Optimistically mark a whole scope read (feed, folder, or everything). */
export function useMarkRead() {
  return useMutation<void, Error, MarkReadScope, Ctx>({ mutationKey: MARK_READ_KEY });
}
