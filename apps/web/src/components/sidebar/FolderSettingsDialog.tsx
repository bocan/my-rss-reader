import { VIEW_MODES, type ViewMode } from '@rss/shared';
import { useState, type FormEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { byFolderName } from '@/lib/feed-order';
import { HAS_CHILDREN_MESSAGE } from '@/lib/folder-drop';
import { useFolders, useUpdateFolder, type FolderRow } from '@/lib/folders';
import { notify } from '@/lib/notify';
import { useSettings } from '@/lib/settings';
import { VIEW_LABELS } from '@/lib/view-labels';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70';

/** The folder editor (#48): name, parent folder and list view, applied by
 *  one Save, as the feed editor does for a feed. */
export function FolderSettingsDialog({
  folder,
  restoreFocusRef,
  onOpenChange,
}: {
  folder: FolderRow;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useFolders();
  const folders = data?.items ?? [];
  const { settings } = useSettings();
  const update = useUpdateFolder();

  const [name, setName] = useState(folder.name);
  const [parentId, setParentId] = useState(folder.parentId ?? '');
  const [viewMode, setViewMode] = useState<string>(folder.viewMode ?? '');

  // One level only, as the API allows (#28).
  const hasChildren = folders.some((f) => f.parentId === folder.id);
  const parents = folders.filter((f) => f.parentId === null && f.id !== folder.id).sort(byFolderName);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Only what changed: a sent parent moves the folder to the end of it.
    const patch = {
      ...(trimmed !== folder.name ? { name: trimmed } : {}),
      ...((parentId || null) !== folder.parentId ? { parentId: parentId || null } : {}),
      ...((viewMode || null) !== folder.viewMode ? { viewMode: (viewMode || null) as ViewMode | null } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { id: folder.id, ...patch },
      {
        onSuccess: () => {
          notify.success('Folder settings saved.');
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent restoreFocusRef={restoreFocusRef}>
        <DialogHeader>
          <DialogTitle>Folder settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm">Name</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>

          <div className="space-y-1">
            <label className="block space-y-1">
              <span className="text-sm">Inside folder</span>
              <select
                className={inputClass}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={hasChildren}
                aria-describedby={hasChildren ? 'folder-parent-note' : undefined}
              >
                <option value="">None (top level)</option>
                {parents.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {hasChildren && (
              <p id="folder-parent-note" className="text-xs text-muted-foreground">
                {HAS_CHILDREN_MESSAGE}
              </p>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-sm">List view</span>
            <select className={inputClass} value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
              <option value="">Use default ({VIEW_LABELS[settings.defaultViewMode]})</option>
              {VIEW_MODES.map((v) => (
                <option key={v} value={v}>
                  {VIEW_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
