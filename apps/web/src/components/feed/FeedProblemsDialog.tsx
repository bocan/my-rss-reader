import { useState } from 'react';
import { FeedProblem } from '@/components/feed/FeedProblem';
import { FeedSettingsDialog } from '@/components/feed/FeedSettingsDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { problemFeeds, useSubscriptions, type SubscriptionRow } from '@/lib/folders';

/**
 * "Feeds with problems": every failing feed, why, and the fixes (#29). It
 * reads the live list, so a feed that works again after "Retry now" leaves
 * it, and the last one out shows the empty state.
 */
export function FeedProblemsDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { data } = useSubscriptions();
  const failing = problemFeeds(data?.items ?? []);
  const [editing, setEditing] = useState<SubscriptionRow | null>(null);

  // One dialog at a time: Edit swaps this list for the feed's settings.
  if (editing) {
    return (
      <FeedSettingsDialog sub={editing} onOpenChange={(open) => !open && setEditing(null)} />
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feeds with problems</DialogTitle>
        </DialogHeader>
        {failing.length === 0 ? (
          <p className="text-sm text-muted-foreground">All your feeds are working.</p>
        ) : (
          <ul className="space-y-4">
            {failing.map((sub) => (
              <li key={sub.subscriptionId} className="space-y-1">
                <h3 className="text-sm font-semibold">{sub.customTitle ?? sub.title ?? sub.feedUrl}</h3>
                <FeedProblem sub={sub} onEdit={() => setEditing(sub)} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
