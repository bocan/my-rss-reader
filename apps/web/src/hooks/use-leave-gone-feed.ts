import { useEffect, useRef } from 'react';

/**
 * When the feed in view is no longer subscribed (unsubscribed here, in another
 * tab, or its URL changed), call `leave` once so the reader goes to All items
 * instead of an empty "Feed" scope (#16). Waits for a loaded feed list
 * (`feedIds` undefined while loading), so a cold start never bounces.
 */
export function useLeaveGoneFeed(
  feedId: string | undefined,
  feedIds: ReadonlySet<string> | undefined,
  leave: () => void,
): void {
  const gone = feedId !== undefined && feedIds !== undefined && !feedIds.has(feedId);
  // Latest callback, so the effect runs on the change of `gone` alone.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    if (gone) leaveRef.current();
  }, [gone]);
}
