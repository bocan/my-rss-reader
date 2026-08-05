import type { ArticleView, AttentionTier, ViewMode, WebSubState } from '@rss/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface FolderRow {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  position: number;
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
  unreadCount: number;
}

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
    mutationFn: (name: string) =>
      api<FolderRow>('/folders', { method: 'POST', body: { name } }),
    onSettled: () => reconcileTree(qc),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      parentId?: string | null;
      position?: number;
    }) => api<FolderRow>(`/folders/${id}`, { method: 'PATCH', body }),
    onMutate: async ({ id, ...patch }): Promise<TreeCtx> => {
      const ctx = await snapshotTree(qc);
      qc.setQueryData<FoldersData>(['folders'], (d) =>
        d ? { items: d.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) } : d,
      );
      return ctx;
    },
    onError: (_e, _v, ctx) => restoreTree(qc, ctx),
    onSettled: () => reconcileTree(qc),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
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

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
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
      qc.setQueryData<FeedsData>(['feeds'], (d) =>
        d
          ? {
              items: d.items.map((s) =>
                s.subscriptionId === id
                  ? {
                      ...s,
                      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
                      ...(patch.title !== undefined ? { customTitle: patch.title } : {}),
                      ...(patch.position !== undefined ? { position: patch.position } : {}),
                      ...(patch.viewMode !== undefined ? { viewMode: patch.viewMode } : {}),
                      ...(patch.articleView !== undefined ? { articleView: patch.articleView } : {}),
                      ...(patch.hideFromAll !== undefined ? { hideFromAll: patch.hideFromAll } : {}),
                      ...(patch.inBlogroll !== undefined ? { inBlogroll: patch.inBlogroll } : {}),
                      ...(patch.attention !== undefined ? { attention: patch.attention } : {}),
                      ...(patch.fetchIntervalSec !== undefined
                        ? { fetchIntervalSec: patch.fetchIntervalSec }
                        : {}),
                    }
                  : s,
              ),
            }
          : d,
      );
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

/** Force-fetch all of the user's feeds now (the "Fetch now" button). */
export function useRefreshFeeds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ refreshed: number }>('/feeds/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}

/** Re-point a subscription at a feed hosted at a new URL (validates by fetching). */
export function useChangeFeedUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, feedUrl }: { id: string; feedUrl: string }) =>
      api<SubscriptionRow>(`/feeds/${id}/url`, { method: 'PATCH', body: { feedUrl } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
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
    onSettled: () => {
      reconcileTree(qc);
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}
