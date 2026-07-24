import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import { del, get, set } from 'idb-keyval';

// IndexedDB (via idb-keyval) backs the persisted query cache: localStorage is
// far too small to hold article bodies. One key holds the whole dehydrated cache.
export const CACHE_KEY = 'reader-query-cache';

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get(key),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: CACHE_KEY,
  throttleTime: 1000,
});

// Bump when a persisted query's response shape changes (SPEC-004/005 payloads)
// so a stale cache is dropped instead of rendered against new code.
export const PERSIST_BUSTER = 'reader-cache-v1';

// Only content worth reading offline is persisted: lists, opened article bodies,
// the feed tree, and unread counts. Never the session or search results.
const PERSISTED_ROOTS = new Set(['articles', 'article', 'feeds', 'counts']);

export function shouldDehydrateQuery(query: Query): boolean {
  const root = query.queryKey[0];
  return typeof root === 'string' && PERSISTED_ROOTS.has(root);
}
