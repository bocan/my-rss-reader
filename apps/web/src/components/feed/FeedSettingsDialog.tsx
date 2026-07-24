import { ARTICLE_VIEWS, VIEW_MODES, type ArticleView, type ViewMode } from '@rss/shared';
import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useFolders, useUpdateSubscription, type SubscriptionRow } from '@/lib/folders';
import { cn } from '@/lib/utils';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const VIEW_LABEL: Record<ViewMode, string> = { list: 'List', cards: 'Cards', magazine: 'Magazine' };
const ARTICLE_LABEL: Record<ArticleView, string> = {
  simplified: 'Simplified',
  readable: 'Readable',
  web: 'Web',
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Consolidated feed editor (SPEC-018): rename, folder, view overrides, hide,
 *  and the shared poll interval, saved in one PATCH. */
export function FeedSettingsDialog({
  sub,
  onOpenChange,
}: {
  sub: SubscriptionRow;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: foldersData } = useFolders();
  const folders = foldersData?.items ?? [];
  const update = useUpdateSubscription();

  const [name, setName] = useState(sub.customTitle ?? '');
  const [folderId, setFolderId] = useState<string>(sub.folderId ?? '');
  const [viewMode, setViewMode] = useState<string>(sub.viewMode ?? '');
  const [articleView, setArticleView] = useState<string>(sub.articleView ?? '');
  const [hideFromAll, setHideFromAll] = useState(sub.hideFromAll);
  const [intervalMin, setIntervalMin] = useState<string>(
    sub.fetchIntervalSec != null ? String(Math.round(sub.fetchIntervalSec / 60)) : '',
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const min = intervalMin.trim() === '' ? null : Math.max(1, Math.round(Number(intervalMin)));
    update.mutate(
      {
        id: sub.subscriptionId,
        title: trimmed || null,
        folderId: folderId || null,
        viewMode: (viewMode || null) as ViewMode | null,
        articleView: (articleView || null) as ArticleView | null,
        hideFromAll,
        fetchIntervalSec: min == null ? null : min * 60,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-label="Feed settings"
        className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Feed settings</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X className="size-4" />
          </Button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm">Name</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={sub.title ?? sub.feedUrl}
              maxLength={200}
            />
            <span className="text-xs text-muted-foreground">
              Blank uses the feed&apos;s own title.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm">Folder</span>
              <select
                className={inputClass}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm">List view</span>
              <select
                className={inputClass}
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
              >
                <option value="">Default</option>
                {VIEW_MODES.map((v) => (
                  <option key={v} value={v}>
                    {VIEW_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm">Opens in</span>
              <select
                className={inputClass}
                value={articleView}
                onChange={(e) => setArticleView(e.target.value)}
              >
                <option value="">Default</option>
                {ARTICLE_VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {ARTICLE_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm">Poll every (min)</span>
              <input
                type="number"
                min={1}
                max={1440}
                className={inputClass}
                value={intervalMin}
                onChange={(e) => setIntervalMin(e.target.value)}
                placeholder="App default"
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm">Hide from All Items</span>
              <span className="block text-xs text-muted-foreground">
                Keeps polling; still reachable by clicking the feed.
              </span>
            </span>
            <input
              type="checkbox"
              checked={hideFromAll}
              onChange={(e) => setHideFromAll(e.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
          </label>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Last fetched {relativeTime(sub.lastFetchedAt)}
            {sub.lastError ? ` · last error: ${sub.lastError}` : ' · no errors'}. The poll interval
            is shared by everyone subscribed to this feed.
          </p>

          {update.isError && (
            <p className="text-sm text-destructive">Could not save. Try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending} className={cn(update.isPending && 'opacity-70')}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
