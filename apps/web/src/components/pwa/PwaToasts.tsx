import { useServiceWorkerUpdate } from '@/lib/pwa';

/**
 * The one-time "ready offline" confirmation from the service worker. New builds
 * install and reload on their own, so there is no update prompt. Mounted once
 * at the app root. Positioned above the mobile bottom nav and clear of the
 * home bar.
 */
export function PwaToasts() {
  const { offlineReady, dismiss } = useServiceWorkerUpdate();
  if (!offlineReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4"
    >
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg">
        <span>Ready to work offline.</span>
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
