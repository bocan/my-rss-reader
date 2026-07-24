import { useCallback, useState } from 'react';

const STORAGE_KEY = 'reader:sidebar-collapsed';

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Sidebar collapse state, persisted per device. Collapsed hides it entirely. */
export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState<boolean>(read);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Display preference only; ignore quota/private-mode failures.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
