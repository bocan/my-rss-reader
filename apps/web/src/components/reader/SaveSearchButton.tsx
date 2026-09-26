import type { CreateSavedSearchInput } from '@rss/shared';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { announce } from '@/lib/announce';
import { useCreateSavedSearch } from '@/lib/searches';

type Scope = Omit<CreateSavedSearchInput, 'name' | 'q'>;

/**
 * "Save this search" beside the search box (SPEC-025). Shown only while a
 * query is active. The popover takes a name (the query by default) and says
 * which scope is saved with it.
 */
export function SaveSearchButton({
  query,
  scope,
  scopeText,
  savedAs,
}: {
  query: string;
  scope: Scope;
  /** e.g. "in folder Tech, unread only". */
  scopeText: string;
  /** The name of a saved search that already shows this list, if any. */
  savedAs?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(query);
  const create = useCreateSavedSearch();

  if (savedAs) {
    return (
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center text-primary"
        title={`Saved as "${savedAs}"`}
        aria-label={`Saved as "${savedAs}"`}
        role="img"
      >
        <BookmarkCheck className="size-4" />
      </span>
    );
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed.slice(0, 60), q: query, ...scope },
      {
        onSuccess: () => {
          announce('Search saved');
          setOpen(false);
        },
      },
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Each opening starts from the current query.
        if (next) setName(query);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Save this search" title="Save this search">
          <BookmarkPlus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Save this search" align="end">
        <form onSubmit={save} className="w-64 space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name</span>
            <input
              autoFocus
              value={name}
              maxLength={60}
              required
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            &ldquo;{query}&rdquo; {scopeText}. It shows under Saved searches in the sidebar.
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
