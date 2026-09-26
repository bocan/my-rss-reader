import { Circle, CircleDot, ExternalLink, MoreHorizontal, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ArticleListItem } from '@/hooks/use-articles';
import { cn } from '@/lib/utils';

export type RowToggle = (
  article: ArticleListItem,
  patch: { read?: boolean; starred?: boolean },
) => void;

/**
 * Star, read toggle and open original for one list row, card or tile (#32),
 * so none of them needs the article to be opened (which marks it read).
 *
 * A mouse or keyboard user gets three small buttons. They show when the row is
 * under the pointer or when one of them has keyboard focus, never on hover
 * only. A touch screen has no hover, so it gets one "..." button that is always
 * visible and opens a menu with the same actions.
 *
 * The parent must be `group/row` and `relative`. The actions are siblings of
 * the row's own button, never inside it, so a press here never opens the
 * article.
 */
export function RowActions({
  article,
  onToggle,
  className,
}: {
  article: ArticleListItem;
  onToggle: RowToggle;
  className?: string;
}) {
  const starLabel = article.starred ? 'Unstar' : 'Star';
  const readLabel = article.read ? 'Mark as unread' : 'Mark as read';
  const toggleStar = () => onToggle(article, { starred: !article.starred });
  const toggleRead = () => onToggle(article, { read: !article.read });
  const ReadIcon = article.read ? CircleDot : Circle;

  return (
    <div
      className={cn(
        'absolute z-20 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-sm',
        'opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
        'focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100',
        'pointer-coarse:opacity-100',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={starLabel}
        aria-pressed={article.starred}
        onClick={toggleStar}
        className="size-7 pointer-coarse:hidden"
      >
        <Star className={cn('size-3.5', article.starred && 'fill-primary text-primary')} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={readLabel}
        onClick={toggleRead}
        className="size-7 pointer-coarse:hidden"
      >
        <ReadIcon className="size-3.5" />
      </Button>
      {article.url && (
        <Button
          variant="ghost"
          size="icon"
          asChild
          aria-label="Open original in a new tab"
          className="size-7 pointer-coarse:hidden"
        >
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Article actions"
            className="hidden size-8 pointer-coarse:inline-flex"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggleStar}>
            <Star className="size-4" /> {starLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleRead}>
            <ReadIcon className="size-4" /> {readLabel}
          </DropdownMenuItem>
          {article.url && (
            <DropdownMenuItem asChild>
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Open original
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
