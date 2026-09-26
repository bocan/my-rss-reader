import {
  describeFeedError,
  type ArticleView,
  type AttentionTier,
  type RestoreSubscriptionInput,
  type ViewMode,
  type WebSubState,
} from '@rss/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { placeAt } from './feed-order';
import { notify } from './notify';

export interface FolderRow {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  position: number;
  /** Saved list layout for the folder view; null uses the user default. */
  viewMode: ViewMode | null;
  createdAt: string;
}

export interface SubscriptionRow {
  subscriptionId: string;
  feedId: string;
  title: string | null;
  customTitle: string | null;
  feedUrl: string;
  siteUrl: string | null;
  faviconUrl: string | null;
  folderId: string | null;
  position: number;
  viewMode: ViewMode | null;
  articleView: ArticleView | null;
  hideFromAll: boolean;
  inBlogroll: boolean;
  attention: AttentionTier;
  /** WebSub delivery state for the shared feed (SPEC-021), read-only. */
  websubState: WebSubState;
  websubLeaseExpiresAt: string | null;
  /** The shared feed's poll interval; null = inherit the app default. */
  fetchIntervalSec: number | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  /** The last fetch that worked; null if none has (#29). */
  lastSuccessAt: string | null;
  unreadCount: number;
}

/** Subscriptions whose last fetch failed, by name (#29). */
export const problemFeeds = (subs: readonly SubscriptionRow[]) =>
  subs
    .filter((s) => s.lastError)
    .sort((a, b) =>
      (a.customTitle ?? a.title ?? a.feedUrl).localeCompare(b.customTitle ?? b.title ?? b.feedUrl),
    );

type FoldersData = { items: FolderRow[] };
type FeedsData = { items: SubscriptionRow[] };

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: () => api<FoldersData>('/folders') });
}

export function useSubscriptions() {
  return useQuery({ queryKey: ['feeds'], queryFn: () => api<FeedsData>('/feeds') });
}

/** Snapshot both trees, so any failed mutation can roll the sidebar back. */
async function snapshotTree(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: ['folders'] });
  await qc.cancelQueries({ queryKey: ['feeds'] });
  return {
    folders: qc.getQueryData<FoldersData>(['folders']),
    feeds: qc.getQueryData<FeedsData>(['feeds']),
  };
}
type TreeCtx = Awaited<ReturnType<typeof snapshotTree>>;

function restoreTree(qc: QueryClient, ctx: TreeCtx | undefined) {
  if (!ctx) return;
  qc.setQueryData(['folders'], ctx.folders);
  qc.setQueryData(['feeds'], ctx.feeds);
}

function reconcileTree(qc: QueryClient) {
  // The server renormalizes positions, so refetch to converge on its truth.
  qc.invalidateQueries({ queryKey: ['folders'] });
  qc.invalidateQueries({ queryKey: ['feeds'] });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not create the folder.' },
    /** A name alone makes a root folder; `parentId` makes a subfolder (#28). */
    mutationFn: (input: string | { name: string; parentId: string }) =>
      api<FolderRow>('/folders', {
        method: 'POST',
        body: typeof input === 'string' ? { name: input } : input,
      }),
    onSettled: () => reconcileTree(qc),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not update the folder.' },
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      parentId?: string | null;
      position?: number;
      viewMode?: ViewMode | null;
    }) => api<FolderRow>(`/folders/${id}`, { method: 'PATCH', body }),
    onMutate: async ({ id, ...patch }): Promise<TreeCtx> => {
      const ctx = await snapshotTree(qc);
      const moves = patch.parentId !== undefined || patch.position !== undefined;
      qc.setQueryData<FoldersData>(['folders'], (d) => {
        if (!d) return d;
        if (!moves) return { items: d.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
        // Mirror the server's placement, so manual order (#27) shows the drop at once.
        const parentId =
          patch.parentId !== undefined ? patch.parentId : d.items.find((f) => f.id === id)?.parentId;
        return {
          items: placeAt(d.items, {
            isMoved: (f) => f.id === id,
            inScope: (f) => f.parentId === parentId,
            index: patch.position,
            move: (f) => ({ ...f, ...patch }),
          }),
        };
      });
      return ctx;
    },
    onError: (_e, _v, ctx) => restoreTree(qc, ctx),
    onSettled: () => reconcileTree(qc),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not delete the folder.' },
    mutationFn: (id: string) => api<void>(`/folders/${id}`, { method: 'DELETE' }),
    onMutate: async (id): Promise<TreeCtx> => {
      const ctx = await snapshotTree(qc);
      const removed = ctx.folders?.items.find((f) => f.id === id);
      const promoteTo = removed?.parentId ?? null;
      // Mirror the server: contents move up to the deleted folder's parent.
      qc.setQueryData<FoldersData>(['folders'], (d) =>
        d
          ? {
              items: d.items
                .filter((f) => f.id !== id)
                .map((f) => (f.parentId === id ? { ...f, parentId: promoteTo } : f)),
            }
          : d,
      );
      qc.setQueryData<FeedsData>(['feeds'], (d) =>
        d
          ? { items: d.items.map((s) => (s.folderId === id ? { ...s, folderId: promoteTo } : s)) }
          : d,
      );
      return ctx;
    },
    onError: (_e, _v, ctx) => restoreTree(qc, ctx),
    onSettled: () => reconcileTree(qc),
  });
}

/** `inlineError`: the caller shows failures itself (the feed settings form). */
export function useUpdateSubscription({ inlineError = false } = {}) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not update the feed.', inlineError },
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      folderId?: string | null;
      title?: string | null;
      position?: number;
      viewMode?: ViewMode | null;
      articleView?: ArticleView | null;
      hideFromAll?: boolean;
      inBlogroll?: boolean;
      attention?: AttentionTier;
      fetchIntervalSec?: number | null;
    }) => api<SubscriptionRow>(`/feeds/${id}`, { method: 'PATCH', body }),
    onMutate: async ({ id, ...patch }): Promise<TreeCtx> => {
      const ctx = await snapshotTree(qc);
      const apply = (s: SubscriptionRow): SubscriptionRow => ({
        ...s,
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ...(patch.title !== undefined ? { customTitle: patch.title } : {}),
        ...(patch.viewMode !== undefined ? { viewMode: patch.viewMode } : {}),
        ...(patch.articleView !== undefined ? { articleView: patch.articleView } : {}),
        ...(patch.hideFromAll !== undefined ? { hideFromAll: patch.hideFromAll } : {}),
        ...(patch.inBlogroll !== undefined ? { inBlogroll: patch.inBlogroll } : {}),
        ...(patch.attention !== undefined ? { attention: patch.attention } : {}),
        ...(patch.fetchIntervalSec !== undefined ? { fetchIntervalSec: patch.fetchIntervalSec } : {}),
      });
      qc.setQueryData<FeedsData>(['feeds'], (d) => {
        if (!d) return d;
        const current = d.items.find((s) => s.subscriptionId === id);
        const folderId = patch.folderId !== undefined ? patch.folderId : current?.folderId;
        // Mirror the server: only a move re-places the row (#27).
        if (current && (folderId !== current.folderId || patch.position !== undefined)) {
          return {
            items: placeAt(d.items, {
              isMoved: (s) => s.subscriptionId === id,
              inScope: (s) => s.folderId === folderId,
              index: patch.position,
              move: apply,
            }),
          };
        }
        return { items: d.items.map((s) => (s.subscriptionId === id ? apply(s) : s)) };
      });
      return ctx;
    },
    onError: (_e, _v, ctx) => restoreTree(qc, ctx),
    onSettled: (_d, _e, variables) => {
      reconcileTree(qc);
      // Hiding/showing a feed or re-tiering it changes counts and lists.
      if (variables.hideFromAll !== undefined || variables.attention !== undefined) {
        qc.invalidateQueries({ queryKey: ['counts'] });
        qc.invalidateQueries({ queryKey: ['articles'] });
      }
    },
  });
}

/** Clear every saved feed and folder list layout, so all follow the default. */
export function useResetViews() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not reset the views.' },
    mutationFn: () => api<void>('/settings/reset-views', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData<FeedsData>(['feeds'], (d) =>
        d ? { items: d.items.map((s) => ({ ...s, viewMode: null })) } : d,
      );
      qc.setQueryData<FoldersData>(['folders'], (d) =>
        d ? { items: d.items.map((f) => ({ ...f, viewMode: null })) } : d,
      );
      reconcileTree(qc);
    },
  });
}

/** Force-fetch all of the user's feeds now (the "Fetch now" button). */
export function useRefreshFeeds() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not fetch the feeds.' },
    mutationFn: () => api<{ refreshed: number }>('/feeds/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}

/**
 * Fetch one feed now ("Retry now", #29). The row comes back with its new
 * error or none, and the toast says which.
 */
export function useRefreshFeed() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not fetch the feed.' },
    mutationFn: (subscriptionId: string) =>
      api<SubscriptionRow>(`/feeds/${subscriptionId}/refresh`, { method: 'POST' }),
    onSuccess: (row) => {
      qc.setQueryData<FeedsData>(['feeds'], (d) =>
        d
          ? { items: d.items.map((s) => (s.subscriptionId === row.subscriptionId ? row : s)) }
          : d,
      );
      const name = row.customTitle ?? row.title ?? row.feedUrl;
      if (row.lastError) {
        notify.error(`${name} still fails: ${describeFeedError(row.lastError).summary}`);
      } else {
        notify.success(`${name} is working again.`);
      }
      // It may have brought new articles.
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}

/** Re-point a subscription at a feed hosted at a new URL (validates by fetching). */
export function useChangeFeedUrl() {
  const qc = useQueryClient();
  return useMutation({
    // The feed settings dialog shows URL errors next to the field.
    meta: { inlineError: true },
    mutationFn: ({ id, feedUrl }: { id: string; feedUrl: string }) =>
      api<SubscriptionRow>(`/feeds/${id}/url`, { method: 'PATCH', body: { feedUrl } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
  });
}

/** How long the Undo button stays on the unsubscribe toast. */
export const UNDO_UNSUBSCRIBE_MS = 10_000;

/** The body that re-creates a subscription exactly as it was (#16). */
export function restoreBody(s: SubscriptionRow): RestoreSubscriptionInput {
  return {
    feedId: s.feedId,
    folderId: s.folderId,
    title: s.customTitle,
    position: s.position,
    viewMode: s.viewMode,
    articleView: s.articleView,
    hideFromAll: s.hideFromAll,
    inBlogroll: s.inBlogroll,
    attention: s.attention,
  };
}

/** Everything an unsubscribe or its undo changes: the tree, counts, lists. */
function reconcileSubscriptions(qc: QueryClient) {
  reconcileTree(qc);
  qc.invalidateQueries({ queryKey: ['counts'] });
  qc.invalidateQueries({ queryKey: ['articles'] });
}

/**
 * Unsubscribe at once, then offer Undo on a toast for a while. Undo subscribes
 * again with the same folder, title, place, and settings. Read, starred, and
 * shared marks are per article, so they were never lost.
 */
export function useUnsubscribe() {
  const qc = useQueryClient();
  const undo = useMutation({
    meta: { errorMessage: 'Could not undo the unsubscribe.' },
    mutationFn: (body: RestoreSubscriptionInput) =>
      api<SubscriptionRow>('/feeds/restore', { method: 'POST', body }),
    onSettled: () => reconcileSubscriptions(qc),
  });
  return useMutation({
    meta: { errorMessage: 'Could not unsubscribe.' },
    mutationFn: (subscriptionId: string) =>
      api<void>(`/feeds/${subscriptionId}`, { method: 'DELETE' }),
    onMutate: async (subscriptionId): Promise<TreeCtx> => {
      const ctx = await snapshotTree(qc);
      qc.setQueryData<FeedsData>(['feeds'], (d) =>
        d ? { items: d.items.filter((s) => s.subscriptionId !== subscriptionId) } : d,
      );
      return ctx;
    },
    onError: (_e, _v, ctx) => restoreTree(qc, ctx),
    onSuccess: (_d, subscriptionId, ctx) => {
      const sub = ctx?.feeds?.items.find((s) => s.subscriptionId === subscriptionId);
      if (!sub) return;
      notify.success(`Unsubscribed from ${sub.customTitle ?? sub.title ?? sub.feedUrl}.`, {
        duration: UNDO_UNSUBSCRIBE_MS,
        action: { label: 'Undo', onClick: () => undo.mutate(restoreBody(sub)) },
      });
    },
    onSettled: () => reconcileSubscriptions(qc),
  });
}
