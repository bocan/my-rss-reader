import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

export const queryClient = new QueryClient({
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
