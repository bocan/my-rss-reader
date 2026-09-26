import { CheckCheck, Rss, Search, Share2, Star, Upload } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { EmptyReason } from '@/lib/empty-state';
import { relativeTime } from '@/lib/relative-time';

export interface EmptyActions {
  onAddFeed: () => void;
  onImportOpml: () => void;
  onSearchAll: () => void;
  onShowRead: () => void;
  /** Absent when no other feed has unread articles. */
  onNextFeed?: () => void;
}

/** The empty article list: what happened, and what to do next (#35). */
export function EmptyArticles({ reason, actions }: { reason: EmptyReason; actions: EmptyActions }) {
  switch (reason.kind) {
    case 'welcome':
      return (
        <Empty Icon={Rss} title="Welcome to Reader">
          <p>Add the feeds you want to follow, or bring them all from another reader.</p>
          <Actions>
            <Button size="sm" onClick={actions.onAddFeed}>
              <Rss className="size-4" /> Add a feed
            </Button>
            <Button size="sm" variant="outline" onClick={actions.onImportOpml}>
              <Upload className="size-4" /> Import OPML
            </Button>
          </Actions>
        </Empty>
      );
    case 'search':
      return (
        <Empty Icon={Search} title={`No results for "${reason.query}"`}>
          <p>
            Searched {reason.allFeeds ? 'all feeds' : reason.scope}
            {reason.unreadOnly ? ', unread articles only' : ''}.
          </p>
          {!reason.allFeeds && (
            <Actions>
              <Button size="sm" variant="outline" onClick={actions.onSearchAll}>
                Search all feeds
              </Button>
            </Actions>
          )}
        </Empty>
      );
    case 'caught-up':
      return (
        <Empty Icon={CheckCheck} title="All caught up">
          <p>Nothing unread here.</p>
          <Actions>
            <Button size="sm" variant="outline" onClick={actions.onShowRead}>
              Show read articles
            </Button>
            {actions.onNextFeed && (
              <Button size="sm" onClick={actions.onNextFeed}>
                Next unread feed
              </Button>
            )}
          </Actions>
        </Empty>
      );
    case 'starred':
      return (
        <Empty Icon={Star} title="No starred articles">
          <p>
            Star an article to keep it here: the star button, or <Kbd>s</Kbd>.
          </p>
        </Empty>
      );
    case 'shared':
      return (
        <Empty Icon={Share2} title="Nothing shared yet">
          <p>
            Share an article from its reading pane, or press <Kbd>Shift</Kbd> <Kbd>S</Kbd>.
          </p>
        </Empty>
      );
    case 'feed':
      return (
        <Empty Icon={Rss} title="Nothing here yet">
          <p>
            {reason.lastFetchedAt
              ? `This feed has no articles. Last fetched ${relativeTime(reason.lastFetchedAt)}.`
              : 'This feed has not been fetched yet.'}
          </p>
        </Empty>
      );
    case 'none':
      return <Empty Icon={Rss} title="No articles" />;
  }
}

function Empty({
  Icon,
  title,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <div className="max-w-sm space-y-3 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-2 pt-1">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-xs">{children}</kbd>;
}
