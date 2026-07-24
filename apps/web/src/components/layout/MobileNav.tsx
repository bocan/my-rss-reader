import { Inbox, Search, Settings as SettingsIcon, Star } from 'lucide-react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';

type Tab = 'all' | 'starred' | 'search' | 'settings';

/**
 * Bottom navigation for phones (< md). Fixed above the home indicator via a
 * safe-area inset. Each item is a >=44px touch target. Hidden at md and up,
 * where the sidebar is authoritative.
 */
export function MobileNav({
  active,
  onAll,
  onStarred,
  onSearch,
}: {
  active: Tab | null;
  onAll: () => void;
  onStarred: () => void;
  onSearch: () => void;
}) {
  const navigate = useNavigate();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-stretch">
        <Item icon={Inbox} label="All" active={active === 'all'} onClick={onAll} />
        <Item icon={Star} label="Starred" active={active === 'starred'} onClick={onStarred} />
        <Item icon={Search} label="Search" active={active === 'search'} onClick={onSearch} />
        <Item
          icon={SettingsIcon}
          label="Settings"
          active={active === 'settings'}
          onClick={() => navigate('/settings')}
        />
      </div>
    </nav>
  );
}

function Item({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}
