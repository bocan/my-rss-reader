/**
 * Plain words for a feed's stored fetch error (#29). The worker stores the raw
 * error message (`feeds.last_error`). The web shows `summary` next to it, and
 * the worker uses `transient` to retry soon instead of waiting a full poll
 * interval. One rule for both, so the UI and the retry never disagree.
 */
export interface FeedErrorInfo {
  summary: string;
  /** A short network problem that usually clears by itself. */
  transient: boolean;
}

const RULES: { test: RegExp; summary: string; transient: boolean }[] = [
  {
    test: /EAI_AGAIN/,
    summary: 'Could not look up the site. This is often a short network problem.',
    transient: true,
  },
  { test: /ENOTFOUND/, summary: 'The site address does not exist.', transient: false },
  { test: /ECONNREFUSED/, summary: 'The site refused the connection.', transient: true },
  {
    test: /ECONNRESET|EPIPE|socket hang up|other side closed|UND_ERR_SOCKET/i,
    summary: 'The connection dropped.',
    transient: true,
  },
  {
    test: /timeout|timed out|ETIMEDOUT/i,
    summary: 'The site took too long to answer.',
    transient: true,
  },
  {
    test: /certificate|CERT_|SSL|TLS/i,
    summary: 'The site has a security certificate problem.',
    transient: false,
  },
  { test: /^HTTP (404|410)\b/, summary: 'The feed is not at this address any more.', transient: false },
  { test: /^HTTP (401|403)\b/, summary: 'The site does not allow access to the feed.', transient: false },
  { test: /^HTTP 429\b/, summary: 'The site asks for fewer requests.', transient: false },
  { test: /^HTTP (502|503|504)\b/, summary: 'The site is down or busy.', transient: true },
  { test: /^HTTP 5\d\d\b/, summary: 'The site had a server error.', transient: false },
  {
    // rss-parser and sax errors for a page that is not a feed.
    test: /not recognized as RSS|Feed not recognized|Non-whitespace before first tag|Unexpected close tag|Unclosed root tag|Invalid character|Attribute without value/i,
    summary: 'The address does not give a valid feed.',
    transient: false,
  },
];

export function describeFeedError(message: string): FeedErrorInfo {
  const rule = RULES.find((r) => r.test.test(message));
  return rule
    ? { summary: rule.summary, transient: rule.transient }
    : { summary: 'The feed could not be updated.', transient: false };
}

/**
 * When to try a transient failure again, in seconds, by how many failures in a
 * row there have been: 2 minutes, then 10, then back to the normal interval.
 * Null means no early retry.
 */
export const TRANSIENT_RETRY_DELAYS_SEC = [120, 600] as const;

export function transientRetryDelaySec(message: string, failureCount: number): number | null {
  if (!describeFeedError(message).transient) return null;
  return TRANSIENT_RETRY_DELAYS_SEC[failureCount - 1] ?? null;
}
