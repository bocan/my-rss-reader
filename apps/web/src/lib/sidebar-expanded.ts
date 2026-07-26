import { useSyncExternalStore } from 'react';

/**
 * Which sidebar folders are expanded. Shared across the tree (which toggles it)
 * and the keyboard layer (which walks only visible feeds), so both agree on what
 * is on screen. Backed by localStorage; a module-level store keeps every consumer
 * in sync on toggle without prop-drilling.
 */
const STORAGE_KEY = 'reader:sidebar-expanded';

function load(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// Reassigned (not mutated) on every change so useSyncExternalStore sees a new
// identity and re-renders; a render with no toggle returns the same Set.
let snapshot = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...snapshot]));
  } catch {
    // display preference only; ignore quota/private-mode failures
  }
}

export function toggleFolderExpanded(id: string): void {
  const next = new Set(snapshot);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  snapshot = next;
  persist();
  listeners.forEach((notify) => notify());
}

export function useExpandedFolders(): Set<string> {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
  );
}
