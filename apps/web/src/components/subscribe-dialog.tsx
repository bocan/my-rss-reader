import { useEffect, useState, type FormEvent } from 'react';
import type { AmbiguousFeedError, FeedCandidate } from '@rss/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { announce } from '@/lib/announce';
import { ApiRequestError } from '@/lib/api';
import { useSubscribe } from '@/lib/feeds';
import { useCreateFolder, useFolders } from '@/lib/folders';
import { cn } from '@/lib/utils';

interface SubscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Sentinel select value for "create a folder from the name typed below". */
const NEW_FOLDER = '__new__';

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

export function SubscribeDialog({ open, onOpenChange }: SubscribeDialogProps) {
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // '' = no folder, a folder id, or NEW_FOLDER (name comes from newFolderName).
  const [folderChoice, setFolderChoice] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const subscribe = useSubscribe();
  const createFolder = useCreateFolder();
  const { data: foldersData } = useFolders();
  const folders = foldersData?.items ?? [];

  // Reset local state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setUrl('');
      setCandidates(null);
      setError(null);
      setFolderChoice('');
      setNewFolderName('');
    }
  }, [open]);

  /**
   * The folder the new subscription lands in. A typed name reuses an existing
   * folder on a case-insensitive match (same contract as OPML import) rather
   * than creating a duplicate; otherwise it is created here. The created id is
   * pinned into folderChoice so retries and the ambiguous-candidate flow never
   * create it twice.
   */
  async function resolveFolderId(): Promise<string | null> {
    if (folderChoice !== NEW_FOLDER) return folderChoice || null;
    const name = newFolderName.trim();
    if (!name) return null;
    const existing = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setFolderChoice(existing.id);
      return existing.id;
    }
    const created = await createFolder.mutateAsync(name);
    setFolderChoice(created.id);
    return created.id;
  }

  async function submit(targetUrl: string) {
    setError(null);
    try {
      const folderId = await resolveFolderId();
      await subscribe.mutateAsync({ url: targetUrl, folderId });
      announce('Subscription added');
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

  const busy = subscribe.isPending || createFolder.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add subscription</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            autoFocus
            type="url"
            required
            aria-label="Site or feed URL"
            placeholder="https://example.com or a feed URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputClass}
          />

          <label className="block space-y-1">
            <span className="text-sm">Add to folder</span>
            <select
              className={inputClass}
              value={folderChoice}
              onChange={(e) => setFolderChoice(e.target.value)}
              title="Folder for the new subscription"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value={NEW_FOLDER}>New folder…</option>
            </select>
          </label>

          {folderChoice === NEW_FOLDER && (
            <input
              autoFocus
              type="text"
              required
              maxLength={100}
              aria-label="New folder name"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className={inputClass}
            />
          )}

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
                      disabled={busy}
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
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
