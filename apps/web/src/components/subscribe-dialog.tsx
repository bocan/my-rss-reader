import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AmbiguousFeedError, FeedCandidate } from '@rss/shared';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { useSubscribe } from '@/lib/feeds';
import { cn } from '@/lib/utils';

interface SubscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubscribeDialog({ open, onOpenChange }: SubscribeDialogProps) {
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscribe = useSubscribe();

  // Reset local state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setUrl('');
      setCandidates(null);
      setError(null);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  async function submit(targetUrl: string) {
    setError(null);
    try {
      await subscribe.mutateAsync(targetUrl);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        const body = err.body as AmbiguousFeedError | null;
        setCandidates(body?.candidates ?? []);
        return;
      }
      setError(
        err instanceof ApiRequestError ? (err.body?.message ?? err.message) : 'Something went wrong',
      );
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCandidates(null);
    void submit(url.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add subscription</h2>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close">
            <X />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            autoFocus
            type="url"
            required
            placeholder="https://example.com or a feed URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={cn(
              'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          {candidates && candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Multiple feeds found. Choose one:</p>
              <ul className="space-y-1">
                {candidates.map((c) => (
                  <li key={c.feedUrl}>
                    <button
                      type="button"
                      onClick={() => void submit(c.feedUrl)}
                      disabled={subscribe.isPending}
                      className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <div className="truncate text-sm font-medium">{c.title ?? c.feedUrl}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.feedUrl}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidates && candidates.length === 0 && !error && (
            <p className="text-sm text-destructive">No feed found at that URL.</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={subscribe.isPending}>
              {subscribe.isPending ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
