import { Monitor, Moon, Rss, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useLogout, useSession } from '@/lib/auth';
import { useTheme, type Theme } from '@/lib/theme';

const THEME_CYCLE: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const THEME_ICON: Record<Theme, ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  system: <Monitor />,
};

/**
 * The permanent app frame. `leading` sits before the product mark (the sidebar
 * toggle); `bar` is the flexible middle region (scope chrome + view switcher).
 * The theme/account controls stay pinned to the right.
 */
export function AppShell({
  children,
  leading,
  bar,
}: {
  children: ReactNode;
  leading?: ReactNode;
  bar?: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const { data: user } = useSession();
  const logout = useLogout();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        {leading}
        <span className="flex shrink-0 items-center gap-2">
          <Rss className="size-5 text-primary" />
          <span className="hidden font-semibold tracking-tight sm:inline">Reader</span>
        </span>
        {bar && <div className="flex min-w-0 flex-1 items-center gap-2">{bar}</div>}
        <div className={bar ? 'flex shrink-0 items-center gap-2' : 'ml-auto flex items-center gap-2'}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Theme: ${theme}`}
            onClick={() => setTheme(THEME_CYCLE[theme])}
          >
            {THEME_ICON[theme]}
          </Button>
          {user && (
            <>
              <span className="hidden text-sm text-muted-foreground lg:inline">
                {user.displayName}
              </span>
              <Button variant="outline" size="sm" onClick={() => logout.mutate()}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
