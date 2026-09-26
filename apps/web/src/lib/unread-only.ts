import { useEffect, useState } from 'react';
import { useSettings } from './settings';

/** Where the toolbar kept "unread only" before it moved to settings (#18). */
export const LEGACY_UNREAD_ONLY_KEY = 'reader:unread-only';

function readLegacy(): string | null {
  try {
    return window.localStorage.getItem(LEGACY_UNREAD_ONLY_KEY);
  } catch {
    return null;
  }
}

/**
 * "Unread only": one value, `settings.showUnreadOnly`, for the toolbar button
 * and the Settings page, synced to the account (#18).
 *
 * A browser that still has the old local key hands it over once: after the
 * server values arrive, a local `true` is saved when the server has the
 * default (false), and the key is deleted. Until then the local value shows,
 * so the list does not flash between the two.
 */
export function useUnreadOnly(): [boolean, (next: boolean) => void] {
  const { settings, update, synced } = useSettings();
  const [legacy, setLegacy] = useState(readLegacy);

  useEffect(() => {
    if (!synced || legacy === null) return;
    try {
      window.localStorage.removeItem(LEGACY_UNREAD_ONLY_KEY);
    } catch {
      // nothing to clean up
    }
    if (legacy === 'true' && !settings.showUnreadOnly) update({ showUnreadOnly: true });
    setLegacy(null);
  }, [synced, legacy, settings.showUnreadOnly, update]);

  const value = legacy !== null && !synced ? legacy === 'true' : settings.showUnreadOnly;
  return [value, (next) => update({ showUnreadOnly: next })];
}
