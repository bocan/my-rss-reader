import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';
import { errorText, notify, type MutationFeedbackMeta } from './notify';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationFeedbackMeta;
  }
}

/**
 * The safety net for #15: no mutation fails silently. Every failed mutation
 * shows an error toast, worded by its `meta.errorMessage`, unless its
 * component shows the error inline (`meta.inlineError`, e.g. a form).
 * Optimistic rollbacks still run in the mutation's own onError.
 */
export function onMutationError(error: unknown, meta: MutationFeedbackMeta | undefined): void {
  if (meta?.inlineError) return;
  if (error instanceof ApiRequestError && error.status === 401) {
    notify.error('Your session has ended. Sign in again.');
    return;
  }
  notify.error(meta?.errorMessage ?? errorText(error, 'Something went wrong.'));
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      onMutationError(error, mutation.options.meta),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Cached lists and article bodies must survive long enough to be persisted
      // to IndexedDB and rehydrated on an offline launch (SPEC-013).
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        // Never retry auth failures; the user needs to sign in.
        if (error instanceof ApiRequestError && error.status === 401) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
