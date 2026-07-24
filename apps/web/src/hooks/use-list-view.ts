import { VIEW_MODES, type ViewMode } from '@rss/shared';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'reader.listView';
const DEFAULT_VIEW: ViewMode = 'list';

function read(): ViewMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return VIEW_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * Active article-list layout, persisted per device.
 *
 * SPEC-011 replaces this with a server-persisted preference plus a per-folder
 * override; keeping both reads and writes behind this hook means only the hook
 * changes then.
 */
export function useListView(): [ViewMode, (view: ViewMode) => void] {
  const [view, setViewState] = useState<ViewMode>(read);

  const setView = useCallback((next: ViewMode) => {
    setViewState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Display preference only; ignore quota/private-mode failures.
    }
  }, []);

  return [view, setView];
}
