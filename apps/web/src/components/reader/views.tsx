import { Star } from 'lucide-react';
import type { ArticleListItem } from '@/hooks/use-articles';
import { cn } from '@/lib/utils';
import { ArticleThumbnail } from './ArticleThumbnail';
import { useUsableArticleImage } from './article-image';
import { deriveArticleRow, type FeedMetaMap } from './article-row';

// Minimum natural size for an article image to be shown as cover art without
// upscaling into blur. Below this we show no image (never the feed favicon). The
// card hero fills the card width; the magazine tile is small (128x96), so its
// floor is lower - but both comfortably reject favicon-sized icons.
const CARD_IMAGE_MIN = { w: 320, h: 180 };
const MAGAZINE_IMAGE_MIN = { w: 160, h: 120 };

export interface ViewProps {
  items: ArticleListItem[];
  feeds: FeedMetaMap;
  selectedId: string | null;
  focusedId: string | null;
  onSelect: (article: ArticleListItem) => void;
  registerRow: (id: string) => (el: HTMLElement | null) => void;
}

/**
 * Entrance stagger, capped so a long page does not cascade forever. Motion is
 * deliberately small and only on mount/view change; `motion-reduce` disables it.
 */
const stagger = (index: number) => ({
  animationDelay: index < 12 ? `${index * 25}ms` : undefined,
});

const ENTER = 'animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards motion-reduce:animate-none';

const focusRing = (focused: boolean) => focused && 'ring-2 ring-ring';

// --- List --------------------------------------------------------------
// Two-line rows at comfortable density; the `compact:` variant collapses them
// to a single dense title-only line (SPEC-016 replaces the old Compact view).

export function ListView({ items, feeds, selectedId, focusedId, onSelect, registerRow }: ViewProps) {
  return (
    <ul role="listbox" aria-label="Articles">
      {items.map((article, index) => {
        const row = deriveArticleRow(article, feeds);
        const focused = focusedId === article.id;
        return (
          <li key={article.id} role="option" aria-selected={focused} ref={registerRow(article.id)}>
            <button
              type="button"
              onClick={() => onSelect(article)}
              style={stagger(index)}
              className={cn(
                'flex w-full items-start gap-2 border-b px-3 py-2.5 text-left',
                'transition-colors duration-200 motion-reduce:transition-none',
                'compact:items-center compact:py-1.5',
                selectedId === article.id ? 'bg-accent' : 'hover:bg-accent/60',
                focusRing(focused),
                ENTER,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full transition-colors duration-300 motion-reduce:transition-none',
                  'compact:mt-0 compact:size-1.5',
                  row.isRead ? 'bg-transparent' : 'bg-primary',
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    row.isRead ? 'text-muted-foreground' : 'font-medium',
                  )}
                >
                  {row.title}
                </span>
                {/* Meta line: hidden in compact density for a one-line row. */}
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground compact:hidden">
                  <span className="truncate">{row.feedName}</span>
                  <span className="shrink-0">{row.when}</span>
                  {row.isStarred && <Star className="size-3 shrink-0 fill-primary text-primary" />}
                </span>
              </span>
              {/* Starred marker kept visible when the meta line is hidden. */}
              {row.isStarred && (
                <Star className="hidden size-3 shrink-0 fill-primary text-primary compact:inline" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// --- Cards (square, hover reveal) ---------------------------------------

/**
 * A square card whose inner stack slides on hover/focus, within the card's own
 * fixed bounds: the image scrolls up and out, the text rides up into its place,
 * and the excerpt fades in below. Nothing reflows; no neighbor moves.
 */
function Card({
  article,
  feeds,
  index,
  selected,
  focused,
  onSelect,
  registerRow,
}: {
  article: ArticleListItem;
  feeds: FeedMetaMap;
  index: number;
  selected: boolean;
  focused: boolean;
  onSelect: (a: ArticleListItem) => void;
  registerRow: ViewProps['registerRow'];
}) {
  const row = deriveArticleRow(article, feeds);
  const showImage = useUsableArticleImage(row.imageUrl, CARD_IMAGE_MIN.w, CARD_IMAGE_MIN.h);

  return (
    <li role="option" aria-selected={focused} ref={registerRow(article.id)}>
      <button
        type="button"
        onClick={() => onSelect(article)}
        style={stagger(index)}
        className={cn(
          'group relative block aspect-square w-full overflow-hidden rounded-lg border text-left',
          'transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none',
          selected && 'bg-accent',
          focusRing(focused),
          ENTER,
        )}
      >
        {/* The sliding stack. On hover/focus it translates up by the image
            height so the image leaves and the meta rises into view. */}
        <span
          className={cn(
            'absolute inset-x-0 top-0 flex flex-col',
            'transition-transform duration-300 ease-out motion-reduce:transition-none',
            showImage && 'group-hover:-translate-y-[58%] group-focus-visible:-translate-y-[58%]',
          )}
        >
          {showImage && row.imageUrl && (
            <ArticleThumbnail
              imageUrl={row.imageUrl}
              className="aspect-[16/10] w-full rounded-none"
            />
          )}
          <span className="block bg-background p-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{row.feedName}</span>
              <span className="shrink-0">{row.when}</span>
              {row.isStarred && (
                <Star className="ml-auto size-3 shrink-0 fill-primary text-primary" />
              )}
            </span>
            <span
              className={cn(
                'mt-1 line-clamp-2 text-sm',
                row.isRead ? 'text-muted-foreground' : 'font-medium',
              )}
            >
              {row.title}
            </span>
            {row.excerpt && (
              <span
                className={cn(
                  'mt-2 line-clamp-4 text-xs text-muted-foreground',
                  // Below the fold at rest when there is an image; revealed as
                  // the stack rises. Always visible when there is no image.
                  showImage &&
                    'opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:opacity-100 motion-reduce:transition-none',
                )}
              >
                {row.excerpt}
              </span>
            )}
          </span>
        </span>
        {!row.isRead && (
          <span
            aria-hidden
            className="absolute right-2 top-2 z-10 size-2 rounded-full bg-primary shadow"
          />
        )}
      </button>
    </li>
  );
}

export function CardsView({ items, feeds, selectedId, focusedId, onSelect, registerRow }: ViewProps) {
  return (
    <ul
      role="listbox"
      aria-label="Articles"
      className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {items.map((article, index) => (
        <Card
          key={article.id}
          article={article}
          feeds={feeds}
          index={index}
          selected={selectedId === article.id}
          focused={focusedId === article.id}
          onSelect={onSelect}
          registerRow={registerRow}
        />
      ))}
    </ul>
  );
}

// --- Magazine (two columns of wide rows) --------------------------------

function MagazineRow({
  article,
  feeds,
  index,
  selected,
  focused,
  onSelect,
  registerRow,
}: {
  article: ArticleListItem;
  feeds: FeedMetaMap;
  index: number;
  selected: boolean;
  focused: boolean;
  onSelect: (a: ArticleListItem) => void;
  registerRow: ViewProps['registerRow'];
}) {
  const row = deriveArticleRow(article, feeds);
  const showImage = useUsableArticleImage(row.imageUrl, MAGAZINE_IMAGE_MIN.w, MAGAZINE_IMAGE_MIN.h);

  return (
    <li role="option" aria-selected={focused} ref={registerRow(article.id)}>
      <button
        type="button"
        onClick={() => onSelect(article)}
        style={stagger(index)}
        className={cn(
          'flex w-full gap-3 rounded-lg border p-3 text-left',
          'transition-[transform,box-shadow,background-color] duration-200',
          'hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0',
          selected && 'bg-accent',
          focusRing(focused),
          ENTER,
        )}
      >
        {showImage && row.imageUrl && (
          <ArticleThumbnail imageUrl={row.imageUrl} className="h-24 w-32 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{row.feedName}</span>
            <span className="shrink-0">{row.when}</span>
            {row.isStarred && <Star className="size-3 shrink-0 fill-primary text-primary" />}
          </span>
          <span
            className={cn(
              'mt-0.5 line-clamp-2 text-sm',
              row.isRead ? 'text-muted-foreground' : 'font-semibold',
            )}
          >
            {row.title}
          </span>
          {row.excerpt && (
            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.excerpt}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export function MagazineView({ items, feeds, selectedId, focusedId, onSelect, registerRow }: ViewProps) {
  return (
    <ul role="listbox" aria-label="Articles" className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
      {items.map((article, index) => (
        <MagazineRow
          key={article.id}
          article={article}
          feeds={feeds}
          index={index}
          selected={selectedId === article.id}
          focused={focusedId === article.id}
          onSelect={onSelect}
          registerRow={registerRow}
        />
      ))}
    </ul>
  );
}
