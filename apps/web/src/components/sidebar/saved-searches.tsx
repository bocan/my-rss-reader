import type { SavedSearchDto } from '@rss/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { InlineInput, RowMenu } from '@/components/sidebar/row-controls';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useDeleteSavedSearch, useRenameSavedSearch, useSavedSearches } from '@/lib/searches';
import { cn } from '@/lib/utils';

/**
 * Saved searches in the sidebar (SPEC-025), between the fixed lists and
 * Feeds. Shown only when there is at least one. A click runs the search in
 * its scope; the row menu renames or deletes it. No counts and no drag in
 * this version.
 */
export function SavedSearchList({
  activeId,
  onOpen,
  itemClass,
}: {
  /** The saved search the list shows now, if any. */
  activeId: string | null;
  onOpen: (search: SavedSearchDto) => void;
  /** The sidebar's own row style, so these rows match the others. */
  itemClass: (active: boolean) => string;
}) {
  const { data } = useSavedSearches();
  const rename = useRenameSavedSearch();
  const remove = useDeleteSavedSearch();
  const [editing, setEditing] = useState<string | null>(null);
  const searches = data?.items ?? [];
  if (searches.length === 0) return null;

  return (
    <section aria-labelledby="saved-searches-heading" className="mt-4">
      <h2
        id="saved-searches-heading"
        className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Saved searches
      </h2>
      <ul className="mt-1 space-y-1 text-sm">
        {searches.map((s) => (
          <li key={s.id} className="group flex items-center gap-1">
            {editing === s.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <InlineInput
                  defaultValue={s.name}
                  onSubmit={(value) => {
                    const name = value.trim().slice(0, 60);
                    if (name && name !== s.name) rename.mutate({ id: s.id, name });
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <button
                className={cn(itemClass(s.id === activeId), 'min-w-0 flex-1')}
                aria-current={s.id === activeId ? 'true' : undefined}
                title={`Search for "${s.q}"`}
                onClick={() => onOpen(s)}
              >
                <Search className="size-4 shrink-0" />
                <span className="truncate">{s.name}</span>
              </button>
            )}
            <RowMenu label={`Saved search actions for ${s.name}`}>
              {(afterClose) => (
                <>
                  <DropdownMenuItem onSelect={() => afterClose(() => setEditing(s.id))}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => {
                      if (confirm(`Delete the saved search "${s.name}"?`)) remove.mutate(s.id);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </RowMenu>
          </li>
        ))}
      </ul>
    </section>
  );
}
