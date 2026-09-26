/**
 * Query options for data that should keep up by itself while the tab is open
 * (#30): the sidebar counts, the feed list, and the "N new articles" check.
 *
 * - Every 3 minutes, but only while the tab is visible: TanStack Query skips
 *   the interval in a background tab (`refetchIntervalInBackground` is off).
 * - At once when the window gets focus again.
 * - Never while offline: the default `networkMode: 'online'` pauses the fetch
 *   until the connection returns.
 */
export const LIVE_REFRESH_MS = 3 * 60 * 1000;

export const liveQueryOptions = {
  refetchInterval: LIVE_REFRESH_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;
