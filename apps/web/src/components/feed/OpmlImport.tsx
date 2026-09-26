import type { ImportOpmlResult } from '@rss/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiRequestError } from '@/lib/api';

/** Mirrors the server's OPML_MAX_BYTES default so we fail fast client-side. */
const MAX_BYTES = 5 * 1024 * 1024;

const DESCRIPTION =
  'Pick an OPML file exported from another reader. Folders and nesting are preserved, and feeds you already follow are skipped.';

/**
 * Pick an OPML file, import it, and show what happened. Used in Settings, and
 * in a dialog from the sidebar "+" menu and the first-run panel (#35).
 */
export function OpmlImportPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportOpmlResult | null>(null);
  const [showFailures, setShowFailures] = useState(false);

  const importOpml = useMutation({
    meta: { inlineError: true },
    mutationFn: (opml: string) =>
      api<ImportOpmlResult>('/opml/import', { method: 'POST', body: { opml } }),
    onSuccess: (data) => {
      setResult(data);
      // New folders and feeds should appear in the sidebar immediately.
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['counts'] });
    },
    onError: (err) =>
      setError(err instanceof ApiRequestError ? (err.body?.message ?? err.message) : 'Import failed'),
  });

  async function onPick(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`);
      return;
    }
    importOpml.mutate(await file.text());
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml,application/xml"
        className="hidden"
        data-testid="opml-file"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <Button
        autoFocus={autoFocus}
        disabled={importOpml.isPending}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="size-4" />
        {importOpml.isPending ? 'Importing…' : 'Choose OPML file'}
      </Button>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {result && (
        <div role="status" className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            Added <strong>{result.feedsAdded}</strong> feed
            {result.feedsAdded === 1 ? '' : 's'} in <strong>{result.foldersCreated}</strong> new
            folder
            {result.foldersCreated === 1 ? '' : 's'}. Skipped <strong>{result.skipped}</strong>{' '}
            already-subscribed.
          </p>
          {result.failed.length > 0 && (
            <div className="mt-2">
              <button
                className="text-destructive underline"
                onClick={() => setShowFailures((v) => !v)}
              >
                {result.failed.length} failed
              </button>
              {showFailures && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {result.failed.map((f, i) => (
                    <li key={`${f.xmlUrl ?? f.title ?? i}`}>
                      <span className="font-medium">{f.title ?? '(untitled)'}</span>
                      {f.xmlUrl ? ` ${f.xmlUrl}` : ''}: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The Settings section text, for callers that show the panel elsewhere. */
export function OpmlImportDescription({ className }: { className?: string }) {
  return <p className={className}>{DESCRIPTION}</p>;
}

export function ImportOpmlDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import subscriptions</DialogTitle>
        </DialogHeader>
        <OpmlImportDescription className="text-sm text-muted-foreground" />
        {/* Remounted per open, so an old result does not show again. */}
        {open && <OpmlImportPanel autoFocus />}
      </DialogContent>
    </Dialog>
  );
}
