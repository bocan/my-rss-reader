import type { CommunityShare } from '@rss/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Rss, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatWhen } from '@/components/reader/article-row';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useCommunityShares } from '@/lib/community';
import { useSubscribe } from '@/lib/feeds';

/**
 * Instance-local shares from other users (SPEC-019): a plain chronological
 * list, separate from the article surfaces because the reader may not be
 * subscribed to the source feeds.
 */
export function CommunityPane() {
  const query = useCommunityShares();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Infinite scroll, same IntersectionObserver pattern as the article surface.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (query.isError) {
    return <div className="p-6 text-sm text-muted-foreground">Could not load community shares.</div>;
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
        <Users className="mb-1 size-6 text-muted-foreground" />
        <p className="font-medium">Nothing shared yet</p>
        <p className="text-sm text-muted-foreground">
          When other users of this instance share articles, they show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <ul className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
        {items.map((share) => (
          <ShareRow key={`${share.user.slug}:${share.article.id}`} share={share} />
        ))}
      </ul>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <p className="pb-4 text-center text-sm text-muted-foreground">Loading more…</p>
      )}
    </div>
  );
}

function ShareRow({ share }: { share: CommunityShare }) {
  const subscribe = useSubscribe();
  const queryClient = useQueryClient();

  const onSubscribe = () => {
    subscribe.mutate(
      { url: share.feed.feedUrl },
      {
        onSuccess: () => {
          announce(`Subscribed to ${share.feed.title ?? share.feed.feedUrl}`);
          queryClient.invalidateQueries({ queryKey: ['community'] });
        },
        onError: () => announce('Could not subscribe'),
      },
    );
  };

  return (
    <li className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{share.user.displayName}</span>{' '}
        {formatWhen(share.sharedAt)}
      </p>
      {share.note && <p className="mt-1.5 font-serif text-[1.05rem] leading-relaxed">{share.note}</p>}
      <h3 className="mt-1.5 text-sm font-semibold">
        {share.article.url ? (
          <a
            href={share.article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {share.article.title ?? 'Untitled'} <ExternalLink className="size-3.5" />
          </a>
        ) : (
          (share.article.title ?? 'Untitled')
        )}
      </h3>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {share.feed.faviconUrl ? (
          <img src={share.feed.faviconUrl} alt="" className="size-3.5 rounded-sm" />
        ) : (
          <Rss className="size-3.5" />
        )}
        <span className="min-w-0 truncate">{share.feed.title ?? share.feed.feedUrl}</span>
        {share.subscribed ? (
          <span className="ml-auto shrink-0">Subscribed</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 shrink-0 px-2 text-xs"
            disabled={subscribe.isPending}
            onClick={onSubscribe}
          >
            {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
          </Button>
        )}
      </div>
    </li>
  );
}
