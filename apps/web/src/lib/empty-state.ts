/**
 * Why the article list is empty, so each case gets its own message and next
 * step (#35), not one "Nothing to read here yet" for all of them.
 */
export type EmptyReason =
  /** No subscriptions at all: the first run. */
  | { kind: 'welcome' }
  /** A search found nothing. */
  | { kind: 'search'; query: string; scope: string; allFeeds: boolean; unreadOnly: boolean }
  /** Unread only, and everything here is read. */
  | { kind: 'caught-up' }
  | { kind: 'starred' }
  | { kind: 'shared' }
  /** One feed with no articles at all. */
  | { kind: 'feed'; lastFetchedAt: string | null }
  | { kind: 'none' };

export function emptyReason(input: {
  hasSubscriptions: boolean;
  query: string;
  scope: string;
  allFeeds: boolean;
  unreadOnly: boolean;
  starred: boolean;
  shared: boolean;
  /** The feed in view, if the scope is one feed. */
  feed: { lastFetchedAt: string | null } | undefined;
}): EmptyReason {
  const { query, scope, allFeeds, unreadOnly } = input;
  if (!input.hasSubscriptions) return { kind: 'welcome' };
  if (query) return { kind: 'search', query, scope, allFeeds, unreadOnly };
  if (unreadOnly) return { kind: 'caught-up' };
  if (input.starred) return { kind: 'starred' };
  if (input.shared) return { kind: 'shared' };
  if (input.feed) return { kind: 'feed', lastFetchedAt: input.feed.lastFetchedAt };
  return { kind: 'none' };
}

/**
 * The first feed after `current` in sidebar order that has unread articles,
 * wrapping around. Never `current` itself.
 */
export function nextUnreadFeed(
  order: string[],
  current: string | undefined,
  unread: Map<string, number>,
): string | undefined {
  const start = current ? order.indexOf(current) : -1;
  for (let i = 1; i <= order.length; i++) {
    const id = order[(start + i + order.length) % order.length];
    if (id !== undefined && id !== current && (unread.get(id) ?? 0) > 0) return id;
  }
  return undefined;
}
