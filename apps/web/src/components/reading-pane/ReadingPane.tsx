import { ARTICLE_VIEWS, type ArticleDetail, type ArticleView } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Rss, Star } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { useToggleArticleState } from '@/lib/articles';
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
  const [view, setView] = useState<ArticleView>('simplified');

  // Reset to the default view whenever the article changes.
  useEffect(() => setView('simplified'), [articleId]);

  const articleQuery = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => api<ArticleDetail>(`/articles/${articleId}`),
  });
  const article = articleQuery.data;

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
    return (
      <div className="p-6 text-sm text-destructive">
        {notFound
          ? 'Article not found or you are not subscribed to its feed.'
          : 'Failed to load article.'}
      </div>
    );
  }
  if (!article) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 md:p-6">
        <h1 className="text-2xl font-semibold leading-tight">{article.title ?? '(untitled)'}</h1>
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
                onClick={() => setView(v)}
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

      <div className={cn('min-h-0 flex-1', view === 'web' ? '' : 'overflow-y-auto p-4 md:p-6')}>
        {view === 'readable' && <ReadableView article={article} />}
        {view === 'simplified' && (
          <SimplifiedView
            article={article}
            loading={readableQuery.isFetching}
            retrying={refresh.isPending}
            onRetry={() => refresh.mutate()}
            onSwitchReadable={() => setView('readable')}
          />
        )}
        {view === 'web' && <WebView article={article} />}
      </div>
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
  loading,
  retrying,
  onRetry,
  onSwitchReadable,
}: {
  article: ArticleDetail;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
  onSwitchReadable: () => void;
}) {
  if (article.readableHtml) return <ArticleHtml html={article.readableHtml} />;
  if (article.readableFetchedAt === null) {
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

function WebView({ article }: { article: ArticleDetail }) {
  if (!article.url) {
    return <div className="p-4 text-sm text-muted-foreground">No original URL for this item.</div>;
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
