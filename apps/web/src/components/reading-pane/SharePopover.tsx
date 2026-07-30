import type { ArticleDetail } from '@rss/shared';
import { Check, Copy, Share2, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { announce } from '@/lib/announce';
import { useToggleArticleState } from '@/lib/articles';
import { useProfile } from '@/lib/profile';
import { cn } from '@/lib/utils';

/**
 * Share menu for the reading pane (SPEC-019): copy link, the OS share sheet
 * where available, and the "on my shared items" toggle with its note.
 * Mount keyed by article id so note state never leaks across articles.
 */
export function SharePopover({ article }: { article: ArticleDetail }) {
  const toggle = useToggleArticleState(article.id);
  const { data: profile } = useProfile();
  const [note, setNote] = useState(article.shareNote ?? '');
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!article.url) return;
    try {
      await navigator.clipboard.writeText(article.url);
      announce('Link copied');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      announce('Could not copy the link');
    }
  };

  const shareViaDevice = () => {
    if (!article.url) return;
    navigator
      .share({ title: article.title ?? undefined, url: article.url })
      .catch(() => undefined); // dismissing the sheet is not an error
  };

  const setShared = (shared: boolean) => {
    toggle.mutate({ shared });
    announce(shared ? 'Added to shared items' : 'Removed from shared items');
  };

  const saveNote = () => {
    const trimmed = note.trim();
    if (trimmed === (article.shareNote ?? '')) return;
    toggle.mutate({ shareNote: trimmed || null });
    announce('Note saved');
  };

  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Share" title="Share">
          <Share2 className={cn('size-4', article.shared && 'fill-primary text-primary')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Share options">
        <div className="space-y-1">
          <button className={itemClass} onClick={() => void copyLink()} disabled={!article.url}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy link
          </button>
          {'share' in navigator && (
            <button className={itemClass} onClick={shareViaDevice} disabled={!article.url}>
              <Smartphone className="size-4" /> Share via device
            </button>
          )}
        </div>

        <div className="mt-2 border-t pt-2">
          <label className="flex items-center justify-between gap-3 px-2 py-1 text-sm">
            <span>On my shared items</span>
            <input
              type="checkbox"
              checked={article.shared}
              onChange={(e) => setShared(e.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
          </label>

          {article.shared && (
            <div className="mt-1 space-y-1 px-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
                rows={3}
                maxLength={2000}
                placeholder="Add a note (why this is worth reading)"
                aria-label="Note for this shared item"
                className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {profile?.visibility === 'public' && profile.shareUrl ? (
                <p className="text-xs text-muted-foreground">
                  Public on{' '}
                  <a
                    href={profile.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {profile.shareUrl.replace(/^https?:\/\//, '')}
                  </a>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {profile?.visibility === 'instance'
                    ? 'Visible to other users of this instance.'
                    : 'Only you can see these until you turn on sharing in '}
                  {profile?.visibility !== 'instance' && (
                    <Link to="/settings#sharing" className="text-primary hover:underline">
                      Settings
                    </Link>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
