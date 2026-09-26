import { ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ArticleSurface } from '@/hooks/use-article-surface';
import { errorText } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * The scroll container, loading/empty/end states and infinite-scroll sentinel,
 * shared by the list column and the browse region. The switched view renders as
 * `children` INSIDE this, so changing view never remounts the scroller and never
 * resets pagination or scroll position.
 */
export function ArticleScroller({
  surface,
  className,
  header,
  empty,
  children,
}: {
  surface: ArticleSurface;
  className?: string;
  /** Above the results, e.g. what a search covers (#33). */
  header?: ReactNode;
  /** Shown when there are no articles; each empty case has its own (#35). */
  empty?: ReactNode;
  children: ReactNode;
}) {
  const { items, isLoading, isError, error, hasNextPage, isFetchingNextPage } = surface;

  return (
    <div ref={surface.rootRef} className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      {/* #30: new articles wait for a click, so the list never moves under the reader. */}
      <div role="status" className="pointer-events-none sticky top-0 z-10 flex h-0 justify-center overflow-visible">
        {surface.newCount > 0 && (
          <Button
            size="sm"
            className="pointer-events-auto mt-2 rounded-full shadow-md"
            onClick={surface.showNew}
          >
            <ArrowUp className="size-3.5" />
            {surface.newCount === 1 ? '1 new article' : `${surface.newCount} new articles`}
          </Button>
        )}
      </div>

      {header}

      {isLoading && (
        <div className="space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-3 p-6 text-center text-sm">
          <p className="text-destructive">
            {errorText(error, 'Could not load the articles.')}
          </p>
          <Button size="sm" variant="outline" onClick={surface.retry}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading &&
        !isError &&
        items.length === 0 &&
        (empty ?? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="font-medium">No articles</p>
          </div>
        ))}

      {children}

      {isFetchingNextPage && (
        <div className="p-3 text-center text-xs text-muted-foreground">Loading more…</div>
      )}
      {!hasNextPage && items.length > 0 && (
        <div className="p-3 text-center text-xs text-muted-foreground">End of list</div>
      )}
      <div ref={surface.sentinelRef} className="h-px" />
    </div>
  );
}
