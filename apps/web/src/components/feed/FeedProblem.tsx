import { describeFeedError } from '@rss/shared';
import { Button } from '@/components/ui/button';
import { useRefreshFeed, type SubscriptionRow } from '@/lib/folders';
import { relativeTime } from '@/lib/relative-time';

/**
 * Why a feed fails, in plain words and raw, with the two fixes: try again
 * now, or edit the feed (#29). Used by the sidebar popover and the
 * "Feeds with problems" list.
 */
export function FeedProblem({ sub, onEdit }: { sub: SubscriptionRow; onEdit: () => void }) {
  const refresh = useRefreshFeed();
  const error = sub.lastError ?? '';
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{describeFeedError(error).summary}</p>
      <p className="break-words rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {error}
      </p>
      <p className="text-xs text-muted-foreground">
        Last tried {relativeTime(sub.lastFetchedAt)}. Last worked {relativeTime(sub.lastSuccessAt)}.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate(sub.subscriptionId)}
        >
          {refresh.isPending ? 'Trying…' : 'Retry now'}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit feed
        </Button>
      </div>
    </div>
  );
}
