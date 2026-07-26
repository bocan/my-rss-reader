import type { ArticleListItem } from '@/hooks/use-articles';

export interface FeedMeta {
  name: string;
  faviconUrl: string | null;
}
export type FeedMetaMap = Record<string, FeedMeta>;

export interface ArticleRowView {
  id: string;
  feedId: string;
  title: string;
  feedName: string;
  feedFaviconUrl: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  when: string;
  isRead: boolean;
  isStarred: boolean;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const absoluteWithYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DIVISIONS: [seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [3600, 'minute'],
  [86_400, 'hour'],
];

/**
 * "5 minutes ago" for recent items, a short date beyond a day, and the year
 * appears once the date is not from the current year ("Jul 12, 2023"), so
 * old items (Starred especially) are never ambiguous.
 */
export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);

  for (const [limit, unit] of DIVISIONS) {
    if (abs < limit) {
      const divisor = limit === 60 ? 1 : limit === 3600 ? 60 : 3600;
      return relative.format(Math.round(diffSeconds / divisor), unit);
    }
  }
  return date.getFullYear() === new Date().getFullYear()
    ? absolute.format(date)
    : absoluteWithYear.format(date);
}

/**
 * Pure helper (deliberately not a hook: it is called inside list .map(),
 * where a use* function would violate the Rules of Hooks).
 * Derives the view-agnostic fields every list layout needs, so read/star,
 * relative time, and title fallbacks live in exactly one place.
 */
export function deriveArticleRow(article: ArticleListItem, feeds: FeedMetaMap): ArticleRowView {
  const feed = feeds[article.feedId];
  return {
    id: article.id,
    feedId: article.feedId,
    title: article.title?.trim() || '(untitled)',
    feedName: feed?.name ?? '',
    feedFaviconUrl: feed?.faviconUrl ?? null,
    excerpt: article.summary?.trim() || null,
    imageUrl: article.imageUrl,
    when: formatWhen(article.publishedAt),
    isRead: article.read,
    isStarred: article.starred,
  };
}
