import { CloudOff, Rss } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ThemePickerButton } from '@/components/theme/ThemePicker';
import { useLogout, useSession } from '@/lib/auth';
import { useOnlineStatus } from '@/lib/pwa';
import { useSettings } from '@/lib/settings';
import { applyDensity } from '@/lib/theme';

/** Move focus (and the viewport) to the main content region. */
function focusMainContent(): void {
  const main = document.getElementById('main-content');
  main?.focus();
  main?.scrollIntoView();
}

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
  const { data: user } = useSession();
  const logout = useLogout();
  const online = useOnlineStatus();
  const { settings } = useSettings();

  // Keep the row density in sync with the server-backed setting.
  useEffect(() => applyDensity(settings.density), [settings.density]);

  return (
    <div className="flex h-full flex-col">
      {/* First focusable element: lets keyboard users jump past the header
          straight into the content. Off-screen until focused. */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          focusMainContent();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            // Handle activation here and stop the event: the global shortcut layer
            // listens on document and binds Enter, which would otherwise consume it.
            e.preventDefault();
            e.stopPropagation();
            focusMainContent();
          }
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        {leading}
        <span className="flex shrink-0 items-center gap-2">
          <Rss className="size-5 text-primary" />
          <span className="hidden font-semibold tracking-tight sm:inline">Reader</span>
        </span>
        {bar && <div className="flex min-w-0 flex-1 items-center gap-2">{bar}</div>}
        <div className={bar ? 'flex shrink-0 items-center gap-2' : 'ml-auto flex items-center gap-2'}>
          {!online && (
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
              title="You are offline. Read/star changes will sync when you reconnect."
            >
              <CloudOff className="size-3.5" />
              <span className="hidden sm:inline">Offline &middot; changes will sync</span>
            </span>
          )}
          <ThemePickerButton />
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
      <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 focus:outline-none">
        {children}
      </main>
    </div>
  );
}
