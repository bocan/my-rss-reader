import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** The `beforeinstallprompt` event is not in the standard DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** True while the browser reports a network connection. Updates on online/offline. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** True when the app is running as an installed, standalone PWA. */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag instead of display-mode.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Captures the deferred install prompt. `canInstall` is false when the browser
 * has not offered one (already installed, unsupported, or iOS Safari).
 */
export function useInstallPrompt(): { canInstall: boolean; promptInstall: () => void } {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so we can trigger it from our own UI
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = () => {
    if (!deferred) return;
    void deferred.prompt();
    void deferred.userChoice.finally(() => setDeferred(null));
  };

  return { canInstall: deferred !== null, promptInstall };
}

/**
 * Registers the service worker. New builds activate and reload on their own
 * (registerType 'autoUpdate'), so the only state left to show is
 * `offlineReady`, which fires once on first cache.
 */
export function useServiceWorkerUpdate() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW();

  return { offlineReady, dismiss: () => setOfflineReady(false) };
}
