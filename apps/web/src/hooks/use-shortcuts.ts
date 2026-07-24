import { useEffect, useRef } from 'react';
import {
  isEditableTarget,
  resolveShortcut,
  startsChord,
  type ShortcutActions,
  type ShortcutContextName,
} from '@/lib/shortcuts/registry';

/** How long a chord prefix (e.g. `g`) stays armed waiting for its second key. */
const CHORD_WINDOW_MS = 800;

/**
 * Mount once at the app root. One document keydown listener resolves the active
 * context against the registry and runs the matching action.
 */
export function useShortcuts(active: ShortcutContextName, actions: ShortcutActions): void {
  // Keep the latest actions without re-binding the listener on every render.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const activeRef = useRef(active);
  activeRef.current = active;

  const pendingChord = useRef<string | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearChord = () => {
      pendingChord.current = null;
      if (chordTimer.current) clearTimeout(chordTimer.current);
      chordTimer.current = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Leave browser/OS chords alone.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Never fire while typing; Escape still gets through so a field can blur.
      if (event.key !== 'Escape' && isEditableTarget(event.target)) return;

      const context = activeRef.current;

      // Second key of a chord.
      if (pendingChord.current) {
        const chorded = resolveShortcut(event.key, context, pendingChord.current);
        clearChord();
        if (chorded) {
          event.preventDefault();
          chorded.run(actionsRef.current);
        }
        return; // a chord attempt consumes the key either way
      }

      // First key of a chord.
      if (startsChord(event.key, context)) {
        pendingChord.current = event.key;
        chordTimer.current = setTimeout(clearChord, CHORD_WINDOW_MS);
        event.preventDefault();
        return;
      }

      const shortcut = resolveShortcut(event.key, context);
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run(actionsRef.current);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (chordTimer.current) clearTimeout(chordTimer.current);
    };
  }, []);
}
