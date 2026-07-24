import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// Full settings mirrored to localStorage so the first render already has the
// user's values (no flash of defaults), reconciled against the server on mount.
const CACHE_KEY = 'rss-settings';

function readCache(): Settings | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(s: Settings): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    // display cache only; ignore quota/private-mode failures
  }
}

/**
 * Server-persisted settings. Seeds synchronously from the localStorage mirror
 * (initialDataUpdatedAt: 0 forces an immediate background refetch to reconcile),
 * and updates optimistically with rollback.
 */
export function useSettings(): { settings: Settings; update: (patch: Partial<Settings>) => void } {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const s = await api<Settings>('/settings');
      writeCache(s);
      return s;
    },
    initialData: readCache,
    initialDataUpdatedAt: 0, // treat the cached seed as stale so it reconciles
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      api<Settings>('/settings', { method: 'PUT', body: patch }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<Settings>(['settings']);
      const next = { ...(prev ?? DEFAULT_SETTINGS), ...patch };
      qc.setQueryData(['settings'], next);
      writeCache(next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(['settings'], ctx.prev);
        writeCache(ctx.prev);
      }
    },
    onSuccess: (server) => {
      qc.setQueryData(['settings'], server);
      writeCache(server);
    },
  });

  return { settings: query.data ?? DEFAULT_SETTINGS, update: mutation.mutate };
}
