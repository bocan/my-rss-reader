import {
  ARTICLE_VIEWS,
  ATTENTION_TIERS,
  describeFeedError,
  VIEW_MODES,
  type ArticleView,
  type AttentionTier,
  type ViewMode,
} from '@rss/shared';
import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent, type RefObject } from 'react';
import { FolderOptions } from '@/components/feed/folder-options';
import { relativeTime } from '@/lib/relative-time';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { ApiRequestError } from '@/lib/api';
import {
  useChangeFeedUrl,
  useFolders,
  useUpdateSubscription,
  type SubscriptionRow,
} from '@/lib/folders';
import { ARTICLE_VIEW_LABELS } from '@/lib/article-view';
import { ATTENTION_EFFECTS, ATTENTION_LABELS } from '@/lib/attention';
import { useSession } from '@/lib/auth';
import { useProfile } from '@/lib/profile';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { VIEW_LABELS } from '@/lib/view-labels';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Consolidated feed editor (SPEC-018): URL, rename, folder, view overrides,
 *  hide, and the shared poll interval, all applied by one Save. */
export function FeedSettingsDialog({
  sub,
  restoreFocusRef,
  onOpenChange,
}: {
  sub: SubscriptionRow;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: foldersData } = useFolders();
  const folders = foldersData?.items ?? [];
  const { data: profile } = useProfile();
  const { settings } = useSettings();
  const update = useUpdateSubscription({ inlineError: true });
  const changeUrl = useChangeFeedUrl();

  const [url, setUrl] = useState(sub.feedUrl);
  const [urlMsg, setUrlMsg] = useState<string | null>(null);
  const [name, setName] = useState(sub.customTitle ?? '');
  const [folderId, setFolderId] = useState<string>(sub.folderId ?? '');
  const [viewMode, setViewMode] = useState<string>(sub.viewMode ?? '');
  const [articleView, setArticleView] = useState<string>(sub.articleView ?? '');
  const [hideFromAll, setHideFromAll] = useState(sub.hideFromAll);
  const [inBlogroll, setInBlogroll] = useState(sub.inBlogroll);
  const [attention, setAttention] = useState<AttentionTier>(sub.attention);
  const { data: me } = useSession();
  // #38: the interval is on the shared feed. Only an admin may change it.
  const canSetInterval = me?.role === 'admin';
  const initialMin =
    sub.fetchIntervalSec != null ? String(Math.round(sub.fetchIntervalSec / 60)) : '';
  const [intervalMin, setIntervalMin] = useState<string>(initialMin);

  const newUrl = url.trim();
  const urlChanged = newUrl !== sub.feedUrl;
  const saving = changeUrl.isPending || update.isPending;

  /** #37: one Save does both. A changed URL goes first; if the server refuses
   *  it, the dialog stays open with the error and nothing else is saved. */
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (urlChanged) {
      setUrlMsg(null);
      try {
        await changeUrl.mutateAsync({ id: sub.subscriptionId, feedUrl: newUrl });
      } catch (err) {
        setUrlMsg(
          err instanceof ApiRequestError
            ? (err.body?.message ?? err.message)
            : 'Could not change the URL.',
        );
        return;
      }
    }
    const trimmed = name.trim();
    // Send the interval only when it changed, so a Save of other settings never
    // rewrites the value that everyone subscribed to this feed shares.
    const intervalChanged = canSetInterval && intervalMin.trim() !== initialMin;
    const min = intervalMin.trim() === '' ? null : Math.max(1, Math.round(Number(intervalMin)));
    update.mutate(
      {
        id: sub.subscriptionId,
        title: trimmed || null,
        folderId: folderId || null,
        viewMode: (viewMode || null) as ViewMode | null,
        articleView: (articleView || null) as ArticleView | null,
        hideFromAll,
        inBlogroll,
        attention,
        ...(intervalChanged ? { fetchIntervalSec: min == null ? null : min * 60 } : {}),
      },
      {
        onSuccess: () => {
          notify.success('Feed settings saved.');
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent restoreFocusRef={restoreFocusRef} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feed settings</DialogTitle>
        </DialogHeader>

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

          <div className="space-y-1">
            <span className="text-sm">Feed URL</span>
            <div className="flex items-center gap-2">
              <input
                type="url"
                required
                aria-label="Feed URL"
                aria-invalid={urlMsg ? true : undefined}
                aria-describedby={urlChanged || urlMsg ? 'feed-url-note' : undefined}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlMsg(null);
                }}
                className={cn(inputClass, 'font-mono text-xs')}
              />
              <CopyButton value={url} />
            </div>
            {urlChanged && !urlMsg && (
              <p id="feed-url-note" className="text-xs text-muted-foreground">
                Save checks the new URL first, then moves this subscription to it.
              </p>
            )}
            {urlMsg && (
              <p id="feed-url-note" role="alert" className="text-xs text-destructive">
                {urlMsg} Your other changes are not saved yet.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm">Folder</span>
              <select
                className={inputClass}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">No folder</option>
                <FolderOptions folders={folders} />
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm">List view</span>
              <select
                className={inputClass}
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
              >
                <option value="">Use default ({VIEW_LABELS[settings.defaultViewMode]})</option>
                {VIEW_MODES.map((v) => (
                  <option key={v} value={v}>
                    {VIEW_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              {/* #48: "Article view" everywhere: here, in Settings and on the pane. */}
              <span className="text-sm">Article view</span>
              <select
                className={inputClass}
                value={articleView}
                onChange={(e) => setArticleView(e.target.value)}
              >
                <option value="">
                  Use default ({ARTICLE_VIEW_LABELS[settings.defaultArticleView]})
                </option>
                {ARTICLE_VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {ARTICLE_VIEW_LABELS[v]}
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
                className={cn(inputClass, !canSetInterval && 'cursor-not-allowed opacity-70')}
                value={intervalMin}
                onChange={(e) => setIntervalMin(e.target.value)}
                placeholder="App default"
                readOnly={!canSetInterval}
                aria-describedby="poll-interval-note"
              />
              <span id="poll-interval-note" className="block text-xs text-muted-foreground">
                {canSetInterval
                  ? 'Applies to everyone subscribed to this feed.'
                  : 'Set by an admin. It applies to everyone subscribed to this feed.'}
              </span>
            </label>
          </div>

          {/* #36: each level says what it does, next to "Show in All items",
              which is a separate choice. */}
          <fieldset className="space-y-2">
            <legend className="text-sm">How much attention</legend>
            {ATTENTION_TIERS.map((tier) => (
              <label key={tier} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="attention"
                  value={tier}
                  checked={attention === tier}
                  onChange={() => setAttention(tier)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>
                  <span className="block text-sm">{ATTENTION_LABELS[tier]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ATTENTION_EFFECTS[tier]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm">Show in All items</span>
              <span className="block text-xs text-muted-foreground">
                Off: this feed's articles are not in the All items list. The feed still updates,
                and you read it from the sidebar. This is not the same as Skim, which keeps the
                articles in All items but removes the count.
              </span>
            </span>
            <input
              type="checkbox"
              checked={!hideFromAll}
              onChange={(e) => setHideFromAll(!e.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
          </label>

          {profile?.blogrollEnabled && (
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm">Include in public blogroll</span>
                <span className="block text-xs text-muted-foreground">
                  Untick to keep this feed off your blogroll page.
                </span>
              </span>
              <input
                type="checkbox"
                checked={inBlogroll}
                onChange={(e) => setInBlogroll(e.target.checked)}
                className="size-4 shrink-0 accent-primary"
              />
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            Delivery:{' '}
            {sub.websubState === 'active' ? (
              <>
                <span
                  className="mr-1 inline-block size-2 rounded-full bg-primary align-baseline"
                  aria-hidden="true"
                />
                Realtime via WebSub
                {sub.websubLeaseExpiresAt
                  ? ` (lease renews ${new Date(sub.websubLeaseExpiresAt).toLocaleDateString()})`
                  : ''}
              </>
            ) : sub.websubState === 'pending' ? (
              'Realtime subscription pending'
            ) : sub.websubState === 'denied' ? (
              'Realtime refused by hub; polling instead'
            ) : (
              'Polled (this feed does not offer realtime delivery)'
            )}
          </p>

          {sub.lastError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="font-medium">{describeFeedError(sub.lastError).summary}</span> Last
              tried {relativeTime(sub.lastFetchedAt)}, last worked {relativeTime(sub.lastSuccessAt)}:{' '}
              {sub.lastError}
            </p>
          ) : (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Last fetched {relativeTime(sub.lastFetchedAt)} · no errors.
            </p>
          )}

          {update.isError && (
            <p className="text-sm text-destructive">Could not save. Try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className={cn(saving && 'opacity-70')}>
              {changeUrl.isPending ? 'Checking feed…' : update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied; the field is selectable for manual copy
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Copy feed URL"
      onClick={copy}
      className="shrink-0"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}
