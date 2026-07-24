import type { ImportOpmlResult } from '@rss/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';

/** Mirrors the server's OPML_MAX_BYTES default so we fail fast client-side. */
const MAX_BYTES = 5 * 1024 * 1024;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportOpmlResult | null>(null);
  const [showFailures, setShowFailures] = useState(false);

  const importOpml = useMutation({
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
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ChevronLeft className="size-4" /> Back
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>

        <section className="rounded-lg border p-4">
          <h2 className="font-medium">Import subscriptions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick an OPML file exported from another reader. Folders and nesting are preserved, and
            feeds you already follow are skipped.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".opml,.xml,text/xml,text/x-opml"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <Button
            className="mt-3"
            disabled={importOpml.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" />
            {importOpml.isPending ? 'Importing…' : 'Choose OPML file'}
          </Button>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          {result && (
            <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                Added <strong>{result.feedsAdded}</strong> feed
                {result.feedsAdded === 1 ? '' : 's'} in{' '}
                <strong>{result.foldersCreated}</strong> new folder
                {result.foldersCreated === 1 ? '' : 's'}. Skipped{' '}
                <strong>{result.skipped}</strong> already-subscribed.
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
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="font-medium">Export subscriptions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download your folders and feeds as an OPML file any reader can import.
          </p>
          <Button variant="outline" className="mt-3" asChild>
            {/* A plain GET with Content-Disposition; the browser handles the save. */}
            <a href="/api/opml/export" download="reader-subscriptions.opml">
              <Download className="size-4" /> Download OPML
            </a>
          </Button>
        </section>
      </div>
    </AppShell>
  );
}
