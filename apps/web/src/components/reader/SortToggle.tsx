import type { SortOrder } from '@rss/shared';
import { CalendarArrowDown, CalendarArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SORT_LABELS } from '@/lib/sort-order';

/**
 * Newest or oldest first (#31). One button that flips the order; its icon and
 * name say the current one. The caller hides it during search, which orders
 * by relevance.
 */
export function SortToggle({
  sort,
  onChange,
}: {
  sort: SortOrder;
  onChange: (sort: SortOrder) => void;
}) {
  const next: SortOrder = sort === 'newest' ? 'oldest' : 'newest';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${SORT_LABELS[sort]}. Show ${SORT_LABELS[next].toLowerCase()}`}
      title={`${SORT_LABELS[sort]}. Click for ${SORT_LABELS[next].toLowerCase()}`}
      onClick={() => onChange(next)}
    >
      {sort === 'newest' ? <CalendarArrowDown /> : <CalendarArrowUp />}
    </Button>
  );
}
