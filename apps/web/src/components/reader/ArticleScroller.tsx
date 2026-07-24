import type { ReactNode } from 'react';
import type { ArticleSurface } from '@/hooks/use-article-surface';
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
  children,
}: {
  surface: ArticleSurface;
  className?: string;
  children: ReactNode;
}) {
  const { items, isLoading, isError, error, hasNextPage, isFetchingNextPage } = surface;

  return (
    <div ref={surface.rootRef} className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      {isLoading && (
        <div className="space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {isError && (
        <div className="p-6 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load articles'}
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
          <p className="font-medium">No articles</p>
          <p className="text-sm text-muted-foreground">Nothing to read here yet.</p>
        </div>
      )}

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
