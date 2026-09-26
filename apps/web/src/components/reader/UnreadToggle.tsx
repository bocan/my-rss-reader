import { cn } from '@/lib/utils';

const OPTIONS = [
  {
    unread: true,
    label: 'Unread',
    title: 'Show unread articles only. The sidebar also hides feeds and folders with nothing unread.',
  },
  {
    unread: false,
    label: 'All',
    title: 'Show read and unread articles, and every feed in the sidebar.',
  },
] as const;

/**
 * Unread only or all articles (#34), as two words, so its meaning shows
 * without a hover. The tooltips say that it also filters the sidebar.
 */
export function UnreadToggle({
  unreadOnly,
  onChange,
}: {
  unreadOnly: boolean;
  onChange: (unreadOnly: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Articles to show" className="inline-flex shrink-0 rounded-md border p-0.5">
      {OPTIONS.map(({ unread, label, title }) => {
        const active = unreadOnly === unread;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            title={title}
            onClick={() => {
              if (!active) onChange(unread);
            }}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
