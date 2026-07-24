/**
 * One data-driven registry of keyboard shortcuts. The dispatcher and the help
 * overlay both read this array, so behavior and documentation cannot drift.
 */

export type ShortcutContextName = 'list' | 'reader' | 'global';

/** Live action handle supplied by ReaderPage; the shortcut layer holds no state. */
export interface ShortcutActions {
  selectNext(): void;
  selectPrev(): void;
  openFocused(): void;
  closeReader(): void;
  toggleRead(): void;
  markUnread(): void;
  toggleStar(): void;
  markAllRead(): void;
  refresh(): void;
  focusSearch(): void;
  nextFeed(): void;
  prevFeed(): void;
  gotoTop(): void;
  toggleOverlay(): void;
  toggleSidebar(): void;
}

export interface Shortcut {
  /** Literal event.key values (case-sensitive, so `?` and `/` stay distinct). */
  keys: string[];
  /** Two-key sequence, e.g. ['g','g']. Mutually exclusive with a bare key match. */
  chord?: [string, string];
  contexts: ShortcutContextName[];
  group: string;
  label: string;
  run: (a: ShortcutActions) => void;
}

export const SHORTCUTS: Shortcut[] = [
  // Navigation
  {
    keys: ['j'],
    contexts: ['list'],
    group: 'Navigation',
    label: 'Next article',
    run: (a) => a.selectNext(),
  },
  {
    keys: ['k'],
    contexts: ['list'],
    group: 'Navigation',
    label: 'Previous article',
    run: (a) => a.selectPrev(),
  },
  {
    keys: ['o', 'Enter'],
    contexts: ['list'],
    group: 'Navigation',
    label: 'Open selected article',
    run: (a) => a.openFocused(),
  },
  {
    // Global so it still dismisses on lg+, where the context stays `list`.
    keys: ['Escape'],
    contexts: ['global'],
    group: 'Navigation',
    label: 'Close reader / dismiss overlay',
    run: (a) => a.closeReader(),
  },
  {
    keys: ['n'],
    contexts: ['global'],
    group: 'Navigation',
    label: 'Next feed',
    run: (a) => a.nextFeed(),
  },
  {
    keys: ['p'],
    contexts: ['global'],
    group: 'Navigation',
    label: 'Previous feed',
    run: (a) => a.prevFeed(),
  },
  {
    chord: ['g', 'g'],
    keys: [],
    contexts: ['global'],
    group: 'Navigation',
    label: 'Jump to top',
    run: (a) => a.gotoTop(),
  },

  // Article actions
  {
    keys: ['m'],
    contexts: ['global'],
    group: 'Article',
    label: 'Toggle read',
    run: (a) => a.toggleRead(),
  },
  {
    keys: ['u'],
    contexts: ['global'],
    group: 'Article',
    label: 'Mark unread',
    run: (a) => a.markUnread(),
  },
  {
    keys: ['s'],
    contexts: ['global'],
    group: 'Article',
    label: 'Toggle star',
    run: (a) => a.toggleStar(),
  },
  {
    keys: ['a'],
    contexts: ['global'],
    group: 'Article',
    label: 'Mark all read in this view',
    run: (a) => a.markAllRead(),
  },

  // App
  {
    keys: ['r'],
    contexts: ['global'],
    group: 'App',
    label: 'Refresh',
    run: (a) => a.refresh(),
  },
  {
    keys: ['/'],
    contexts: ['global'],
    group: 'App',
    label: 'Focus search',
    run: (a) => a.focusSearch(),
  },
  {
    keys: ['['],
    contexts: ['global'],
    group: 'App',
    label: 'Toggle sidebar',
    run: (a) => a.toggleSidebar(),
  },
  {
    keys: ['?'],
    contexts: ['global'],
    group: 'App',
    label: 'Show keyboard shortcuts',
    run: (a) => a.toggleOverlay(),
  },
];

function inContext(shortcut: Shortcut, active: ShortcutContextName): boolean {
  return shortcut.contexts.includes('global') || shortcut.contexts.includes(active);
}

/**
 * Find the shortcut for a key press. When `pendingChord` is set, only chord
 * entries whose first key matches it are considered.
 */
export function resolveShortcut(
  key: string,
  active: ShortcutContextName,
  pendingChord?: string | null,
): Shortcut | undefined {
  if (pendingChord) {
    return SHORTCUTS.find(
      (s) => s.chord && s.chord[0] === pendingChord && s.chord[1] === key && inContext(s, active),
    );
  }
  return SHORTCUTS.find((s) => !s.chord && s.keys.includes(key) && inContext(s, active));
}

/** True when `key` starts a defined chord (e.g. the first `g` of `g g`). */
export function startsChord(key: string, active: ShortcutContextName): boolean {
  return SHORTCUTS.some((s) => s.chord?.[0] === key && inContext(s, active));
}

/**
 * Shortcuts must never fire while the user is typing. Escape is handled by the
 * caller so a focused field can still be dismissed.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}
