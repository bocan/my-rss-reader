# SPEC-023: Subscribe to social-web profiles (Mastodon, Bluesky, fediverse handles)

- **Status:** Todo
- **Phase:** 4
- **Depends on:** SPEC-002 (Done)
- **Estimated size:** S

## Context

The "RSS is dead, the fediverse won" crowd misses a delightful fact: the new
social web speaks RSS too. Every Mastodon profile serves a feed at
`<profile URL>.rss`, and Bluesky serves one at
`https://bsky.app/profile/<handle>/rss`. YouTube channel pages even advertise
theirs via `<link rel="alternate" type="application/rss+xml">`, which our
generic discovery already understands. So a user should be able to paste a
profile URL (or a fediverse `@user@instance` handle) into the subscribe box
and just get the feed.

Discovery today (`discoverFeedCandidates()` in
`apps/api/src/lib/feed-fetch.ts`) does: fetch the URL; if it parses as a feed
or has a feed content-type, done; else scrape `<link rel="alternate">` from
the HTML; else probe `FALLBACK_PATHS` (`/feed`, `/rss.xml`, ...). This fails
for exactly two interesting cases:

- **Bluesky**: `bsky.app` is a JS-only SPA; the served HTML contains no
  `<link rel="alternate">`, and none of the fallback paths exist.
- **Mastodon**: profile HTML does carry the link tag on most instances, but
  probing `<url>.rss` directly is faster, works on instances that strip the
  tag, and avoids parsing a large HTML page.

The client side is `subscribe-dialog.tsx`
(`apps/web/src/components/subscribe-dialog.tsx`), which calls
`GET /api/feeds/discover` and `POST /api/feeds` (which itself re-runs
discovery for non-feed URLs and returns 409 `ambiguous_feed` with candidates
when several match).

## Goal

Pasting a Mastodon profile URL, a `@user@instance.tld` handle, or a Bluesky
profile URL into the subscribe dialog resolves to the right feed with no
extra clicks. YouTube channels keep working via generic discovery, now
verified by a test.

## Non-goals

- Anything protocol-native (ActivityPub inboxes, AT Protocol firehose).
  This spec is 100% "their pages are already feeds".
- Following hashtags or lists (Mastodon serves `.rss` for tags too; it works
  by pasting the tag URL today via the generic path; no special casing).
- Nitter/Twitter, Instagram, or other platforms without first-party feeds.
  No scraping proxies.
- Webfinger resolution of `@user@instance` (a plain URL rewrite covers the
  overwhelmingly common Mastodon-style case; see Implementation notes for
  the accepted imprecision).

## Data model changes

None.

## API changes

No new routes and no schema changes. `GET /api/feeds/discover` and
`POST /api/feeds` transparently gain the new resolution behavior through
`discoverFeedCandidates()`.

### Platform matchers (`lib/feed-fetch.ts`)

Introduce a small matcher table that runs **before** the generic fetch:

```ts
/** Candidate feed URLs to probe for well-known social profile URLs.
 *  Pure URL rewriting; every candidate is still verified by fetching and
 *  parsing before it is offered. */
export function socialFeedProbes(url: string): string[] {
  let u: URL;
  try { u = new URL(url); } catch { return []; }

  // Bluesky: https://bsky.app/profile/<handle or did> -> .../rss
  if (u.hostname === 'bsky.app') {
    const m = u.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if (m) return [`https://bsky.app/profile/${m[1]}/rss`];
  }
  // Mastodon-style: https://instance/@user (any host) -> https://instance/@user.rss
  if (/^\/@[^/@]+\/?$/.test(u.pathname)) {
    return [`${u.origin}${u.pathname.replace(/\/$/, '')}.rss`];
  }
  return [];
}
```

In `discoverFeedCandidates()`, before the initial `httpGet(url)`:

```ts
for (const probeUrl of socialFeedProbes(url)) {
  try {
    const probe = await httpGet(probeUrl);
    if (probe.statusCode < 400) {
      const parsed = await parsesAsFeed(probe.body);
      if (parsed) return [{ feedUrl: probeUrl, title: parsed.title ?? null }];
    }
  } catch {
    // fall through to generic discovery
  }
}
```

A failed probe costs one request and falls back to today's behavior, so a
non-Mastodon site whose URLs happen to look like `/@handle` (some Medium
blogs!) still resolves via the generic path. Note Medium specifically:
`medium.com/@user` serves a real feed at `medium.com/feed/@user`, and its
page HTML advertises it via `link rel=alternate`, so generic discovery
catches it after the probe misses; add a test pinning that.

## Web / UI changes

All in `subscribe-dialog.tsx`:

1. **Handle normalization (client-side, before calling the API).** The
   subscribe input currently requires a URL (`subscribeSchema`'s
   `z.url()`). Pre-process the raw input:

   ```ts
   /** '@user@instance.tld' or 'user@instance.tld' -> 'https://instance.tld/@user'.
    *  Anything else returns the input unchanged. */
   export function normalizeSubscribeInput(raw: string): string
   ```

   Rules: trim; if it matches
   `/^@?([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i` **and** does not look
   like a bare email the user meant to paste elsewhere (heuristic: handles
   almost always arrive with the leading `@`; accept the no-leading-@ form
   too since the dialog only ever subscribes), rewrite to
   `https://$2/@$1`. If the input already parses as a URL or starts with
   `http`, leave it alone; if it is a bare domain (`example.com`), keep the
   existing behavior (the dialog already prefixes a scheme if it does so
   today; if not, `https://` it in the same helper).

   Put the helper in `apps/web/src/lib/` (pure, unit-tested) and call it in
   the dialog's submit and discover paths.
2. **Placeholder + helper text.** Input placeholder becomes
   `"Site, feed, or profile URL"`; the hint line below mentions
   "Works with blogs, podcasts, YouTube channels, Mastodon and Bluesky
   profiles (@user@instance works too)."

## Implementation notes

- Order: `socialFeedProbes` + wiring + API tests, then the client helper +
  copy.
- The Mastodon rewrite is intentionally naive: it treats any
  `host/@user` URL and any `user@host` handle as Mastodon-style. Pleroma,
  Akkoma, and GoToSocial follow the same `.rss` convention or fail the
  probe harmlessly. Misskey does not serve `.rss` (probe fails, generic
  discovery picks up its `<link rel="alternate">` where offered). This
  imprecision is fine because **every candidate is verified by parsing an
  actual feed before being shown**.
- Bluesky's RSS omits reply/like context and serves posts only; that is
  what users expect from following someone.
- `httpGet` already follows redirects (undici redirect interceptor), which
  matters for instances behind `www.` or apex redirects.
- No SSRF surface change: discovery already fetches arbitrary
  user-supplied URLs by design (same class as SPEC-021's note).

## Acceptance criteria

- [ ] Pasting `https://bsky.app/profile/somebody.bsky.social` discovers
      exactly one candidate, `https://bsky.app/profile/somebody.bsky.social/rss`
      (mocked in tests), and subscribes cleanly end to end.
- [ ] Pasting `https://hachyderm.io/@someone` discovers
      `https://hachyderm.io/@someone.rss` without fetching the profile
      HTML (assert one request in the mocked test).
- [ ] Typing `@someone@hachyderm.io` (and `someone@hachyderm.io`) in the
      dialog produces the same result as pasting the profile URL.
- [ ] A `/@user`-shaped URL whose `.rss` probe 404s (Medium fixture) falls
      back to generic discovery and still finds the real feed.
- [ ] A YouTube channel page fixture resolves via the existing
      `<link rel="alternate">` path (regression pin).
- [ ] Plain blogs, direct feed URLs, and ambiguous-multi-feed homepages
      behave exactly as before (existing `feeds.int.test.ts` and
      `feed-fetch.test.ts` stay green).

## Testing

- **Unit (`feed-fetch.test.ts`).** `socialFeedProbes` URL table: bsky
  profile with/without trailing slash and with a DID, Mastodon-style at
  arbitrary hosts, non-matching paths (`/@user/posts`, `/profile/x/feed`),
  garbage input. Mocked-fetch discovery: probe hit short-circuits, probe
  miss falls through, Medium fixture.
- **Unit (web).** `normalizeSubscribeInput` table: `@user@host`,
  `user@host`, full URLs untouched, bare domains, whitespace, uppercase
  hosts.
- **Manual.** One real Mastodon account, one real Bluesky account, one
  YouTube channel, subscribed through the dialog against the live network.

## Open questions

- Surface a small platform icon (Mastodon/Bluesky glyph) on candidates in
  the ambiguous-feed picker? Pure polish; the title usually says it.
- `@user@host` handles for Bluesky custom domains (webfinger-less) are
  ambiguous with Mastodon handles; today the Mastodon rewrite wins and the
  probe fails over to generic discovery of the domain. Acceptable; revisit
  if users report friction.
