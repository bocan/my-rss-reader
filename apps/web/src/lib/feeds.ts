import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** Subscribe to a feed or homepage URL. */
export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, folderId }: { url: string; folderId?: string | null }) =>
      api<{ subscription: unknown; feed: { id: string } }>('/feeds', {
        method: 'POST',
        body: { url, folderId: folderId ?? null },
      }),
    onSuccess: () => {
      // Subscribing lands the feed AND its initial articles server-side, so
      // all three caches must learn about them. Counts especially: with
      // unread-only on, a feed whose count is unknown reads as zero and the
      // sidebar hides it, making a successful subscribe look like a no-op.
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
  });
}
