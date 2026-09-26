import { X } from 'lucide-react';
import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The search box with its own clear (x) button (#33). Firefox shows no native
 * clear control on `type=search`, so every browser gets this one instead.
 * Escape clears a query and keeps focus; Escape in an empty box leaves it.
 */
export function SearchField({
  ref,
  value,
  onChange,
  onLeave,
  className,
}: {
  ref?: Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  /** Escape in an empty box, or a blur while empty. */
  onLeave: () => void;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) onLeave();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // Keep Escape from also closing the open article.
          e.stopPropagation();
          if (value) {
            onChange('');
          } else {
            e.currentTarget.blur();
            onLeave();
          }
        }}
        placeholder="Search"
        aria-label="Search articles"
        className={cn(
          'h-8 w-full min-w-0 rounded-md border border-input bg-background pl-2 pr-7 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          // Keep focus in the box, so typing can go on after a clear.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Says what a search covers (#33): the query, the scope, and the unread-only
 * filter, with a way to widen it to every feed and a way to end it.
 */
export function SearchScope({
  query,
  scope,
  allFeeds,
  unreadOnly,
  onSearchAll,
  onClear,
}: {
  query: string;
  /** The scope's name, e.g. a feed or folder. */
  scope: string;
  /** True when the scope is already All items. */
  allFeeds: boolean;
  unreadOnly: boolean;
  onSearchAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm">
      <p className="min-w-0 flex-1">
        Results for <span className="font-medium">{`"${query}"`}</span> in{' '}
        <span className="font-medium">{allFeeds ? 'all feeds' : scope}</span>
        {unreadOnly && <span className="text-muted-foreground"> (unread only)</span>}
      </p>
      <div className="flex items-center gap-1">
        {!allFeeds && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onSearchAll}>
            Search all feeds
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClear}>
          <X className="size-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}
