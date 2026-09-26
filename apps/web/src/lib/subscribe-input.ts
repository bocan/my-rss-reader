/**
 * What the subscribe box accepts (SPEC-023), turned into a URL for the API:
 *
 * - A URL with a scheme stays as it is, except `feed://host/...` (the scheme
 *   browsers use for feed links), which becomes `https://host/...`.
 * - A fediverse handle, `@user@instance.tld` or `user@instance.tld`, becomes
 *   `https://instance.tld/@user`, the Mastodon-style profile URL. The server
 *   then finds `<profile>.rss`. This is a plain rewrite, not a WebFinger
 *   lookup: a host that is not Mastodon-style fails the probe, and generic
 *   discovery of that page takes over. The no-@ form looks like an email, but
 *   this box only subscribes, so it is read as a handle too.
 * - A bare domain, with an optional port and path (`example.com/blog`), gets
 *   `https://`.
 * - Anything else is returned trimmed, and the caller says it is not valid.
 */
const HANDLE = /^@?([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i;

export function normalizeSubscribeInput(raw: string): string {
  const input = raw.trim();
  if (/^feed:\/\//i.test(input)) return `https://${input.slice('feed://'.length)}`;
  if (HAS_SCHEME.test(input)) return input;
  const handle = input.match(HANDLE);
  if (handle) return `https://${handle[2]!.toLowerCase()}/@${handle[1]}`;
  if (BARE_DOMAIN.test(input)) return `https://${input}`;
  return input;
}

/** True when the value is an http(s) URL the API can take. */
export function isSubscribableUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
