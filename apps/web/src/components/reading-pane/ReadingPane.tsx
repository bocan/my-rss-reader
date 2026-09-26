import { ARTICLE_VIEWS, type ArticleDetail, type ArticleView, type ReadingSize } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Mail, MailOpen, Rss, Star } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ARTICLE_VIEW_LABELS, resolveAutoView } from '@/lib/article-view';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { useToggleArticleState } from '@/lib/articles';
import { useSubscriptions } from '@/lib/folders';
import { useOnlineStatus } from '@/lib/pwa';
import { proseSizeClass, readingColumnClass } from '@/lib/reading-format';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { ArticleHtml } from './ArticleHtml';
import { SharePopover } from './SharePopover';

const VIEW_TITLES: Record<ArticleView, string> = {
  readable: 'Feed view: the content the feed itself provides',
  simplified: 'Extracted view: a clean copy pulled from the original page',
  web: 'Web view: the original page',
};

const dateFmt =new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function ReadingPane({
  articleId,
  stepper,
}: {
  articleId: string;
  /** Previous / Next controls, shown with the article actions (#23). */
  stepper?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const { data: feedsData } = useSubscriptions();
  const online = useOnlineStatus();

  const articleQuery = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => api<ArticleDetail>(`/articles/${articleId}`),
  });
  const article = articleQuery.data;

  // The view, in priority order: a manual pick on this article, the feed's
  // override (SPEC-018), the user default. A default of 'auto' resolves per
  // article from what the feed carries. The manual pick is keyed by article id,
  // so it lapses on its own when another article opens.
  const [picked, setPicked] = useState<{ articleId: string; view: ArticleView } | null>(null);
  const manual = picked?.articleId === articleId ? picked.view : null;
  const override =
    feedsData?.items.find((s) => s.feedId === article?.feed.id)?.articleView ?? null;
  const fallback = settings.defaultArticleView;
  const isAuto = !manual && !override && fallback === 'auto';
  const view: ArticleView =
    manual ?? override ?? (fallback !== 'auto' ? fallback : article ? resolveAutoView(article) : 'readable');
  const chooseView = (v: ArticleView) => setPicked({ articleId, view: v });

  // Extracted view: lazily extract once, only when never attempted before.
  const needsReadable = view === 'simplified' && !!article && article.readableFetchedAt === null;
  const readableQuery = useQuery({
    queryKey: ['article', articleId, 'readable'],
    queryFn: () => api<ArticleDetail>(`/articles/${articleId}/readable`),
    enabled: needsReadable,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (readableQuery.data) queryClient.setQueryData(['article', articleId], readableQuery.data);
  }, [readableQuery.data, articleId, queryClient]);

  const refresh = useMutation({
    // The Extracted view shows its own "could not extract" state.
    meta: { inlineError: true },
    mutationFn: () => api<ArticleDetail>(`/articles/${articleId}/readable?refresh=true`),
    onSuccess: (data) => queryClient.setQueryData(['article', articleId], data),
  });

  // Mark read on open, exactly once per opening, unless the user marks by hand
  // (settings.markReadOnOpen, #24). The ref guards against re-render re-fires,
  // so an article marked unread here stays unread while it stays open; the
  // pane is keyed by article, so opening it again starts fresh.
  const toggle = useToggleArticleState(articleId);
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!settings.markReadOnOpen || !article || markedRef.current.has(article.id)) return;
    // Recorded on first sight even when already read, so a later Mark unread
    // (button, u, m) is never undone by this effect.
    markedRef.current.add(article.id);
    if (!article.read) toggle.mutate({ read: true });
  }, [article, toggle, settings.markReadOnOpen]);
  const toggleRead = () => {
    if (!article) return;
    markedRef.current.add(article.id);
    toggle.mutate({ read: !article.read });
  };

  if (articleQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (articleQuery.isError) {
    const notFound =
      articleQuery.error instanceof ApiRequestError && articleQuery.error.status === 404;
    // A network failure with no cached copy means this article was never opened
    // while online; say so plainly rather than implying it is broken.
    const offlineMiss = !online && !(articleQuery.error instanceof ApiRequestError);
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {offlineMiss
          ? 'Not available offline. Open this article while online to read it later.'
          : notFound
            ? 'Article not found or you are not subscribed to its feed.'
            : 'Failed to load article.'}
      </div>
    );
  }
  if (!article) return null;

  // #41: the header and body share one centered column, so lines stay a
  // readable length at any window width.
  const column = readingColumnClass(settings.readingSize, settings.readingWidth);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 md:p-6">
        <div className={column}>
          <h1 className="font-serif text-[1.7rem] font-semibold leading-tight tracking-tight">
            {article.title ?? '(untitled)'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {article.feed.faviconUrl ? (
                <img src={article.feed.faviconUrl} alt="" className="size-4 rounded-sm" />
              ) : (
                <Rss className="size-4" />
              )}
              {article.feed.title ?? article.feed.siteUrl ?? ''}
            </span>
            {article.author && <span>{article.author}</span>}
            {article.publishedAt && <span>{formatDate(article.publishedAt)}</span>}
            {article.url && (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" /> Open original
              </a>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Article view">
                {ARTICLE_VIEWS.map((v) => (
                  <button
                    key={v}
                    onClick={() => chooseView(v)}
                    aria-pressed={view === v}
                    title={VIEW_TITLES[v]}
                    className={cn(
                      'rounded px-3 py-1 text-sm',
                      view === v
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {ARTICLE_VIEW_LABELS[v]}
                  </button>
                ))}
              </div>
              {isAuto && (
                <span
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  title="Your default view is Automatic: the reader chose this view for this article. Pick another view to override it."
                >
                  Auto
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={article.read ? 'Mark unread' : 'Mark read'}
                title={article.read ? 'Read. Mark unread (u)' : 'Unread. Mark read (m)'}
                onClick={toggleRead}
              >
                {article.read ? <MailOpen className="size-4" /> : <Mail className="size-4 text-primary" />}
              </Button>
              <SharePopover key={article.id} article={article} />
              <Button
                variant="ghost"
                size="icon"
                aria-label={article.starred ? 'Unstar' : 'Star'}
                onClick={() => toggle.mutate({ starred: !article.starred })}
              >
                <Star className={cn('size-4', article.starred && 'fill-primary text-primary')} />
              </Button>
              {stepper}
            </div>
          </div>
        </div>
      </div>

      {article.enclosureUrl && <EnclosurePlayer article={article} />}

      <div className={cn('min-h-0 flex-1', view === 'web' ? '' : 'overflow-y-auto p-4 md:p-6')}>
        {view === 'web' ? (
          <WebView article={article} online={online} />
        ) : (
          <div className={column} data-testid="reading-column">
            {view === 'readable' && (
              <FeedView
                article={article}
                size={settings.readingSize}
                onSwitchExtracted={() => chooseView('simplified')}
              />
            )}
            {view === 'simplified' && (
              <ExtractedView
                article={article}
                size={settings.readingSize}
                online={online}
                loading={readableQuery.isFetching}
                failed={readableQuery.isError}
                retrying={refresh.isPending}
                onRetry={() => refresh.mutate()}
                onSwitchReadable={() => chooseView('readable')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Native player for the item's podcast/video enclosure. Sits between the
 * header and the article body so the episode stays playable in every view,
 * including while reading show notes or the original page.
 */
function EnclosurePlayer({ article }: { article: ArticleDetail }) {
  const url = article.enclosureUrl!;
  const isVideo = (article.enclosureType ?? '').startsWith('video/');
  const mediaLabel = `${isVideo ? 'Video' : 'Audio'} for ${article.title ?? 'this item'}`;
  return (
    <div className="border-b p-4 md:px-6">
      {isVideo ? (
        <video
          controls
          preload="metadata"
          src={url}
          aria-label={mediaLabel}
          className="max-h-96 w-full rounded-md bg-black"
        />
      ) : (
        <audio controls preload="metadata" src={url} aria-label={mediaLabel} className="w-full" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        title={`Download this ${isVideo ? 'video' : 'episode'}`}
      >
        <Download className="size-3.5" /> Download {isVideo ? 'video' : 'episode'}
      </a>
    </div>
  );
}

function FeedView({
  article,
  size,
  onSwitchExtracted,
}: {
  article: ArticleDetail;
  size: ReadingSize;
  onSwitchExtracted: () => void;
}) {
  if (article.contentHtml) return <ArticleHtml html={article.contentHtml} size={size} />;
  if (article.summary) {
    // A summary is the article as the feed sends it, so it reads as body
    // text, not as a grey notice (#47). Then say where the rest is.
    return (
      <div className="space-y-6">
        <div
          className={cn('prose prose-neutral max-w-none dark:prose-invert', proseSizeClass(size))}
          data-testid="feed-summary"
        >
          <p>{article.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
          <span className="mr-1">This feed sends only a summary.</span>
          <Button size="sm" variant="outline" onClick={onSwitchExtracted}>
            Extracted
          </Button>
          {article.url && (
            <Button size="sm" variant="outline" asChild>
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" /> Open original
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }
  return <Note>No content in this item. Try the Web view.</Note>;
}

function ExtractedView({
  article,
  size,
  online,
  loading,
  failed,
  retrying,
  onRetry,
  onSwitchReadable,
}: {
  article: ArticleDetail;
  size: ReadingSize;
  online: boolean;
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onSwitchReadable: () => void;
}) {
  if (article.readableHtml) return <ArticleHtml html={article.readableHtml} size={size} />;
  // Only wait ("Preparing"/"Extracting") while an attempt is genuinely pending.
  // A stamped readableFetchedAt or an errored /readable request (e.g. 422 for an
  // article with no source URL, or a transient network/proxy error) both fall
  // through to the recoverable "could not extract" state instead of hanging.
  if (article.readableFetchedAt === null && !failed) {
    // Extraction needs the network; offline it would spin forever.
    if (!online) {
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">A clean version was not fetched while online.</p>
          {article.contentHtml && (
            <Button size="sm" variant="outline" onClick={onSwitchReadable}>
              Read feed version
            </Button>
          )}
        </div>
      );
    }
    return <Note>{loading ? 'Extracting a clean version…' : 'Preparing…'}</Note>;
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Could not extract a clean version of this article.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Trying…' : 'Try again'}
        </Button>
        <Button size="sm" variant="outline" onClick={onSwitchReadable}>
          Read feed version
        </Button>
      </div>
    </div>
  );
}

function WebView({ article, online }: { article: ArticleDetail; online: boolean }) {
  if (!article.url) {
    return <div className="p-4 text-sm text-muted-foreground">No original URL for this item.</div>;
  }
  // The live page cannot be cached; the iframe would just show a browser error.
  if (!online) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        The web page is not available offline. Try the Feed or Extracted view.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary"
        >
          <ExternalLink className="size-4" /> Open original in new tab
        </a>
        <span className="text-muted-foreground">
          If the page below is blank, the site blocks embedding. Use the link above.
        </span>
      </div>
      <iframe
        src={article.url}
        title={article.title ?? 'Original page'}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="h-full w-full border-0"
      />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
