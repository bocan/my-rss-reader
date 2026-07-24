import { VIEW_MODES, type ViewMode } from '@rss/shared';
import { LayoutGrid, List, Newspaper } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

const OPTIONS: Record<ViewMode, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  list: { label: 'List view', Icon: List },
  cards: { label: 'Card view', Icon: LayoutGrid },
  magazine: { label: 'Magazine view', Icon: Newspaper },
};

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-md border p-0.5">
      {VIEW_MODES.map((mode) => {
        const { label, Icon } = OPTIONS[mode];
        const active = view === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => onChange(mode)}
            className={cn(
              'rounded p-1.5 transition-colors duration-200 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
