import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Subscribe to a feed or homepage URL. On success the sidebar refetches. */
export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api<{ subscription: unknown; feed: unknown }>('/feeds', {
        method: 'POST',
        body: { url },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  });
}
