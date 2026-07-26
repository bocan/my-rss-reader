import { useSyncExternalStore } from 'react';

/**
 * A single polite live region for screen-reader announcements of actions whose
 * result is not otherwise obvious non-visually (mark all read, subscribe, refresh
 * ...). Call announce() from anywhere - including mutation callbacks outside the
 * React tree - and render <Announcer/> (see components/a11y/Announcer) once at the
 * app root to voice them.
 */
let message = '';
let version = 0;
const listeners = new Set<() => void>();

export function announce(text: string): void {
  message = text;
  version += 1;
  listeners.forEach((notify) => notify());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The latest announcement and a monotonic counter (so repeats still register). */
export function useAnnouncement(): { message: string; version: number } {
  const v = useSyncExternalStore(subscribe, () => version);
  return { message, version: v };
}
