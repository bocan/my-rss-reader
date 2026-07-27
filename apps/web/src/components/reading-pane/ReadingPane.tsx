import { ARTICLE_VIEWS, type ArticleDetail, type ArticleView } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Rss, Star } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { useToggleArticleState } from '@/lib/articles';
import { useSubscriptions } from '@/lib/folders';
import { useOnlineStatus } from '@/lib/pwa';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { ArticleHtml } from './ArticleHtml';

const VIEW_LABELS: Record<ArticleView, string> = {
  simplified: 'Simplified',
  readable: 'Readable',
  web: 'Web',
};

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function ReadingPane({ articleId }: { articleId: string }) {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const { data: feedsData } = useSubscriptions();
  const online = useOnlineStatus();
  const [view, setView] = useState<ArticleView>(() => settings.defaultArticleView);

  const articleQuery = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => api<ArticleDetail>(`/articles/${articleId}`),
  });
  const article = articleQuery.data;

  // Seed the view per article: the feed's article-view override (SPEC-018) if
  // set, else the user default. `switchedRef` guards a manual in-session switch
  // from being clobbered; it resets on each new article. The seed waits for the
  // article so the feed id (and its override) is known.
  const switchedRef = useRef(false);
  useEffect(() => {
    switchedRef.current = false;
  }, [articleId]);
  const feedId = article?.feed.id;
  useEffect(() => {
    if (!feedId || switchedRef.current) return;
    const override = feedsData?.items.find((s) => s.feedId === feedId)?.articleView ?? null;
    setView(override ?? settings.defaultArticleView);
    // subs/settings intentionally excluded: only re-seed on a new article/feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedId, articleId]);
  const chooseView = (v: ArticleView) => {
    switchedRef.current = true;
    setView(v);
  };

  // Simplified view: lazily extract once, only when never attempted before.
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
    mutationFn: () => api<ArticleDetail>(`/articles/${articleId}/readable?refresh=true`),
    onSuccess: (data) => queryClient.setQueryData(['article', articleId], data),
  });

  // Mark read on open, exactly once per article (SPEC-011 can swap this seam for
  // a scroll-based trigger later). The ref guards against re-render re-fires.
  const toggle = useToggleArticleState(articleId);
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (article && !article.read && !markedRef.current.has(article.id)) {
      markedRef.current.add(article.id);
      toggle.mutate({ read: true });
    }
  }, [article, toggle]);

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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 md:p-6">
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
          <div className="inline-flex rounded-md border p-0.5">
            {ARTICLE_VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => chooseView(v)}
                aria-pressed={view === v}
                title={`${VIEW_LABELS[v]} view`}
                className={cn(
                  'rounded px-3 py-1 text-sm',
                  view === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={article.starred ? 'Unstar' : 'Star'}
            onClick={() => toggle.mutate({ starred: !article.starred })}
          >
            <Star className={cn('size-4', article.starred && 'fill-primary text-primary')} />
          </Button>
        </div>
      </div>

      {article.enclosureUrl && <EnclosurePlayer article={article} />}

      <div className={cn('min-h-0 flex-1', view === 'web' ? '' : 'overflow-y-auto p-4 md:p-6')}>
        {view === 'readable' && <ReadableView article={article} />}
        {view === 'simplified' && (
          <SimplifiedView
            article={article}
            online={online}
            loading={readableQuery.isFetching}
            failed={readableQuery.isError}
            retrying={refresh.isPending}
            onRetry={() => refresh.mutate()}
            onSwitchReadable={() => chooseView('readable')}
          />
        )}
        {view === 'web' && <WebView article={article} online={online} />}
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

function ReadableView({ article }: { article: ArticleDetail }) {
  if (article.contentHtml) return <ArticleHtml html={article.contentHtml} />;
  if (article.summary) return <Note>{article.summary}</Note>;
  return <Note>No content in this item. Try the Web view.</Note>;
}

function SimplifiedView({
  article,
  online,
  loading,
  failed,
  retrying,
  onRetry,
  onSwitchReadable,
}: {
  article: ArticleDetail;
  online: boolean;
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onSwitchReadable: () => void;
}) {
  if (article.readableHtml) return <ArticleHtml html={article.readableHtml} />;
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
        The web page is not available offline. Try the Simplified or Readable view.
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
