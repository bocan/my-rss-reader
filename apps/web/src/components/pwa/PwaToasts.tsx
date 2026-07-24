import { useServiceWorkerUpdate } from '@/lib/pwa';
import { Button } from '@/components/ui/button';

/**
 * Non-blocking toasts for the service worker lifecycle: a new build waiting to
 * activate, and the one-time "ready offline" confirmation. Mounted once at the
 * app root. Positioned above the mobile bottom nav and clear of the home bar.
 */
export function PwaToasts() {
  const { needRefresh, offlineReady, update, dismiss } = useServiceWorkerUpdate();
  if (!needRefresh && !offlineReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4"
    >
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg">
        {needRefresh ? (
          <>
            <span>A new version is available.</span>
            <Button size="sm" onClick={update}>
              Reload
            </Button>
          </>
        ) : (
          <span>Ready to work offline.</span>
        )}
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
