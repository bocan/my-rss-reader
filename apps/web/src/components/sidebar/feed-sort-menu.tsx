import { ArrowDownAZ, ArrowDownWideNarrow, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isFeedSort, type FeedSort } from '@/lib/feed-order';

const SORTS: Record<FeedSort, { label: string; Icon: typeof ArrowDownAZ }> = {
  name: { label: 'By name', Icon: ArrowDownAZ },
  unread: { label: 'By unread count', Icon: ArrowDownWideNarrow },
  manual: { label: 'Manual (drag to reorder)', Icon: GripVertical },
};

/** The FEEDS header's sort choice (#27). The icon shows the current mode. */
export function FeedSortMenu({
  sort,
  onChange,
}: {
  sort: FeedSort;
  onChange: (sort: FeedSort) => void;
}) {
  const { label, Icon } = SORTS[sort];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Sort feeds: ${label}`}
          title={`Sort feeds: ${label}`}
        >
          <Icon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort feeds</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => isFeedSort(v) && onChange(v)}>
          {(Object.keys(SORTS) as FeedSort[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {SORTS[key].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
