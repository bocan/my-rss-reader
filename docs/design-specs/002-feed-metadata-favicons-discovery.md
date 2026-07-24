# SPEC-002: Feed metadata, favicons, and discovery on subscribe

- **Status:** Done
- **Phase:** 1
- **Depends on:** none
- **Estimated size:** M

## Context

Subscribing is currently a metadata-free stub. `POST /feeds`
(`apps/api/src/routes/feeds.ts`) validates the body with `subscribeSchema`,
inserts a `feeds` row with only `feedUrl` set (via
`onConflictDoUpdate` on the `feeds_feed_url_key` unique index, touching just
`updatedAt`), creates a `subscriptions` row with `onConflictDoNothing`, and
replies `201 { subscription, feed }`. Every descriptive column
(`title`, `siteUrl`, `description`, `faviconUrl`) stays `null` until the worker
polls the feed.

The worker (`apps/api/src/worker/poll.ts`, `pollFeed`) is the only thing that
fills metadata in today. On each tick it does a conditional GET with `undici`
`request()`, parses with `rss-parser`, and updates
`title`, `siteUrl` (from `parsed.link`), `description`, `etag`,
`lastModified`, `lastFetchedAt`, `lastError`, `failureCount`, then inserts
articles with `onConflictDoNothing` on `(feedId, guid)`. Note two facts the
first-pass draft got wrong and this spec must respect:

1. `pollFeed` never writes `faviconUrl`. There is no favicon logic anywhere in
   the codebase yet. This spec introduces it.
2. `undici` `request()` does not follow redirects and no global dispatcher is
   configured (`grep -rn setGlobalDispatcher apps/api/src` returns nothing;
   the comment in `poll.ts` claiming a "global dispatcher default" is
   aspirational). Any new fetch that starts from a user-pasted homepage URL
   must pass `maxRedirections` explicitly or it will miss redirect-based feeds.

Consequences for the user: after subscribing, the sidebar row
(`apps/web/src/routes/ReaderPage.tsx`) shows the raw `feedUrl` string with no
title and no icon until the next poll tick (default `FEED_POLL_INTERVAL_SEC`,
900s). And pasting a site homepage instead of the exact feed URL silently
creates a broken feed row that never resolves, because `subscribeSchema.url`
(`z.url()`) is inserted verbatim with no discovery.

The `feeds` table already has every column this spec needs (`title`,
`siteUrl`, `description`, `faviconUrl`, `etag`, `lastModified`,
`lastFetchedAt`, `lastError`, `failureCount`), so no schema change is
required.

## Goal

When a user pastes either a feed URL or a site homepage URL into an "Add
subscription" dialog, the API resolves the real feed, fetches it once
synchronously as part of the request, and returns a `feeds` row that already
has `title`, `siteUrl`, `description`, and `faviconUrl` populated plus the
feed's initial articles stored. The sidebar shows the real title and favicon
immediately, with no worker tick required. If a homepage exposes more than one
feed, the user picks one before the subscribe completes.

## Non-goals

- Caching or proxying favicon bytes through the API. `faviconUrl` stores the
  resolved external URL and the browser fetches it directly. Proxying is a
  future option (see Implementation notes).
- Folder assignment UI, unsubscribe, reorder, rename, or any subscription
  management beyond create. That is SPEC-007. (The `folderId` and `title`
  fields already accepted by `subscribeSchema` continue to pass through
  untouched.)
- OPML import (SPEC-009). SPEC-009 will call the exact functions built here
  (`discoverFeedCandidates`, `fetchAndStoreFeed`) but is out of scope now.
- SSRF hardening (blocking private-IP / link-local targets). Called out as a
  follow-up below; the fetch surface is no larger than the worker already has.

## Data model changes

None. `feeds.title`, `siteUrl`, `description`, `faviconUrl`, `etag`,
`lastModified`, `lastFetchedAt`, `lastError`, `failureCount` all already exist
in `apps/api/src/db/schema.ts` and are sufficient.

Do not add an `iconResolvedAt` column in this spec. Favicon staleness is not a
concern yet, and a favicon-refresh job is out of scope. If a future spec needs
it, that spec owns the migration.

## API changes

Both routes live in `apps/api/src/routes/feeds.ts`, inside `feedRoutes`, and
are registered under the `/api` prefix (`apps/api/src/routes/index.ts`), so the
public paths are `/api/feeds/discover` and `/api/feeds`. Both require auth via
the existing `const auth = { preHandler: app.requireAuth }` already defined at
the top of `feedRoutes`.

### `GET /feeds/discover?url=` (new)

Pure discovery. Writes nothing to the database.

- Validate the query string:
  `const { url } = discoverFeedsQuerySchema.parse(request.query)`.
- Call `discoverFeedCandidates(url)` from the new `lib/feed-fetch.ts` (below).
- Reply `200 { candidates }` where `candidates` is
  `FeedCandidate[]` (possibly empty). Return `200` with an empty array when
  nothing is found, never `404`, so the client renders "no feed found" without
  special-casing the HTTP status.
- On a network failure reaching the URL, `discoverFeedCandidates` returns `[]`
  rather than throwing, so discovery of an unreachable host is an empty result,
  not a 500.

Handler shape:

```ts
app.get('/feeds/discover', auth, async (request) => {
  const { url } = discoverFeedsQuerySchema.parse(request.query);
  const candidates = await discoverFeedCandidates(url);
  return { candidates };
});
```

### `POST /feeds` (existing route, behavior change)

`subscribeSchema` is unchanged: `url` (`z.url()`) already accepts both a feed
URL and a homepage URL, and `folderId` / `title` still pass through. Only the
handler body and the response contents change (the envelope
`{ subscription, feed }` and the `201` status stay the same).

New flow:

1. `const input = subscribeSchema.parse(request.body)` and
   `const userId = request.user!.id` (as today).
2. **Fast path / dedup on the pasted URL.** Look up an existing feed:
   `db.select().from(feeds).where(eq(feeds.feedUrl, input.url))`. If one
   exists, skip all discovery and fetching, reuse its stored metadata, jump to
   step 6 with that row. This keeps re-subscribes cheap and avoids re-hitting a
   feed for every new subscriber.
3. **Discover.** Otherwise call `discoverFeedCandidates(input.url)`:
   - `0` candidates: reply
     `422 { error: 'no_feed_found', message: 'No feed found at that URL.', statusCode: 422 }`.
     Create nothing.
   - `> 1` candidates: reply
     `409 { error: 'ambiguous_feed', message: 'Multiple feeds found; choose one.', statusCode: 409, candidates }`.
     Create nothing. The client re-`POST`s with the chosen `feedUrl`, which is
     a direct feed URL and resolves to exactly one candidate on the next call.
     The body is a superset of `ApiError` (it still has `error` / `message` /
     `statusCode`) so it survives the web `ApiRequestError` wrapper while
     carrying `candidates` on `err.body`. Send it with
     `reply.code(409).send({...})` directly; do not `throw`, because the global
     error handler in `apps/api/src/app.ts` would drop the `candidates` field.
   - exactly `1` candidate: continue with `candidate.feedUrl`.
4. **Insert the resolved feed row** (dedup again on the resolved URL, which may
   differ from `input.url` when a homepage was pasted):

   ```ts
   const [feed] = await db
     .insert(feeds)
     .values({ feedUrl: candidate.feedUrl })
     .onConflictDoUpdate({ target: feeds.feedUrl, set: { updatedAt: new Date() } })
     .returning();
   ```

5. **Populate synchronously.** `await fetchAndStoreFeed(feed!)`. This does the
   one real feed fetch, updates the row's metadata columns and favicon, and
   inserts initial articles. It records fetch errors on the row (sets
   `lastError`, bumps `failureCount`) instead of throwing, so a feed that is
   temporarily down still results in a successful subscribe. Re-select the row
   afterward so the response reflects the populated values:
   `const [populated] = await db.select().from(feeds).where(eq(feeds.id, feed!.id))`.
6. **Create the subscription** (unchanged from today):

   ```ts
   const [subscription] = await db
     .insert(subscriptions)
     .values({
       userId,
       feedId: feedRow.id,
       folderId: input.folderId ?? null,
       customTitle: input.title ?? null,
     })
     .onConflictDoNothing({ target: [subscriptions.userId, subscriptions.feedId] })
     .returning();
   return reply.code(201).send({ subscription: subscription ?? null, feed: feedRow });
   ```

   where `feedRow` is the re-selected populated row (step 5) or the reused
   existing row (step 2).

### Zod schemas: `packages/shared/src/schemas/feed.ts`

Add the following. `subscribeSchema` and the other existing exports stay as
they are. This is a source-only package (no build step), exported through
`packages/shared/src/schemas/index.ts` which already re-exports `./feed.js`, so
no index edit is needed.

```ts
/** Query for GET /feeds/discover. */
export const discoverFeedsQuerySchema = z.object({ url: z.url() });
export type DiscoverFeedsQuery = z.infer<typeof discoverFeedsQuerySchema>;

/** One discoverable feed, returned by discovery and echoed in a 409 body. */
export const feedCandidateSchema = z.object({
  feedUrl: z.url(),
  title: z.string().nullable(),
});
export type FeedCandidate = z.infer<typeof feedCandidateSchema>;

/** Response body for GET /feeds/discover. */
export const discoverFeedsResponseSchema = z.object({
  candidates: z.array(feedCandidateSchema),
});
export type DiscoverFeedsResponse = z.infer<typeof discoverFeedsResponseSchema>;

/**
 * 409 body from POST /feeds when a homepage exposes multiple feeds. A superset
 * of ApiError so it flows through the client's typed error wrapper.
 */
export const ambiguousFeedErrorSchema = z.object({
  error: z.literal('ambiguous_feed'),
  message: z.string(),
  statusCode: z.literal(409),
  candidates: z.array(feedCandidateSchema),
});
export type AmbiguousFeedError = z.infer<typeof ambiguousFeedErrorSchema>;
```

Zod is v4 in this repo (`z.url()`, `z.uuid()` are top-level, matching the
existing `subscribeSchema`). Do not use `z.string().url()`.

## Web / UI changes

All under `apps/web/src`. Styling is Tailwind v4 + shadcn-style components;
reuse tokens (`bg-accent`, `text-muted-foreground`, `border`, `bg-primary`,
etc.) and the existing `Button` (`@/components/ui/button`). TanStack Query owns
all server state; no new global store. The web `api()` helper
(`@/lib/api`) throws `ApiRequestError` (fields `.status: number`,
`.body: ApiError | null`) on non-2xx.

### Subscribe dialog: `apps/web/src/components/subscribe-dialog.tsx`

No `Dialog` primitive exists yet (only `button.tsx` is in `components/ui`) and
`@radix-ui/react-dialog` is not a dependency. To avoid adding a dependency,
build a minimal controlled modal: a fixed full-screen overlay
(`fixed inset-0 z-50 bg-black/50`) with a centered panel
(`bg-background rounded-lg border p-4 shadow-lg`), closing on Escape, backdrop
click, and a Cancel button. Props: `{ open: boolean; onOpenChange: (open: boolean) => void }`.

Behavior:

- A single URL text input plus a submit button. Submit calls a `useMutation`
  (see hook below) that `POST`s `{ url }` to `/feeds`.
- **Success** (`201`): close the dialog, clear the input, and
  `qc.invalidateQueries({ queryKey: ['feeds'] })` so the sidebar refetches. The
  new row appears with title and favicon already populated.
- **`409 ambiguous_feed`**: read `err.body.candidates` off the caught
  `ApiRequestError`, render the candidates as a selectable list (each showing
  `title ?? feedUrl` and the `feedUrl` beneath in muted text), and on pick
  re-run the same mutation with `{ url: candidate.feedUrl }`. That second call
  resolves to a single candidate and completes.
- **`422 no_feed_found`** and other errors: show `err.body?.message` (falls
  back to `err.message`) inline near the input in `text-destructive`.
- Keep local component state only (input value, selected-candidate list, error
  message). Disable the submit button while `mutation.isPending`.

### Subscribe mutation hook

Add either in the dialog file or a small `apps/web/src/lib/feeds.ts`:

```ts
import type { ApiError } from '@rss/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api<{ subscription: unknown; feed: unknown }>('/feeds', {
        method: 'POST',
        body: { url },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  });
}
```

The candidate list on a `409` is handled in the component from the thrown
`ApiRequestError` (its `.body` carries `candidates`); it does not need its own
query. Optionally add a typed `AmbiguousFeedError` import from `@rss/shared`
for the `err.body` cast.

### Sidebar wiring: `apps/web/src/routes/ReaderPage.tsx`

- Add an "Add subscription" trigger to the "Feeds" section header (a small
  `Button variant="ghost" size="icon"` with a `Plus` icon from `lucide-react`)
  that sets local `open` state and renders `<SubscribeDialog open onOpenChange />`.
- Render the favicon in each feed row. The existing `SubscriptionRow` interface
  already includes `faviconUrl: string | null`; the `/feeds` list query already
  selects `feeds.faviconUrl` (see `apps/api/src/routes/feeds.ts` `GET /feeds`),
  so no API list change is needed. Render a 16px `<img>` when `faviconUrl` is
  set, with an `onError` handler that swaps to a generic `Rss` lucide icon
  (or hides the img and shows the icon), and show the `Rss` icon as the default
  when `faviconUrl` is null:

  ```tsx
  {s.faviconUrl ? (
    <img
      src={s.faviconUrl}
      alt=""
      className="size-4 shrink-0 rounded-sm"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  ) : (
    <Rss className="size-4 shrink-0 text-muted-foreground" />
  )}
  ```

  Keep the existing `title` fallback chain (`customTitle ?? title ?? feedUrl`)
  for the label.

## Implementation notes

### New dependency

Add `node-html-parser` to `apps/api` (`pnpm --filter @rss/api add
node-html-parser`). It is a lightweight, dependency-free HTML parser (no jsdom,
no DOM globals) suitable for extracting `<link>` tags server-side. Import as
`import { parse } from 'node-html-parser'`.

### New module: `apps/api/src/lib/feed-fetch.ts`

Extract the fetch-parse-store logic currently inline in `pollFeed` into
reusable functions here. ESM with `.js` import specifiers per repo convention.
Reuse the single shared `new Parser({ timeout: 15_000 })` instance (either move
it here and import it into `poll.ts`, or export it). Move the existing private
`firstHeader(value: string | string[] | undefined)` helper here too.

Define a shared low-level fetch used by every function below so the
`user-agent`, `maxRedirections`, and timeout are consistent:

```ts
const USER_AGENT = 'rss-reader/0.1 (+https://github.com/your/rss-reader)';

async function httpGet(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string; finalUrl: string }> {
  const res = await request(url, {
    headers: { 'user-agent': USER_AGENT, ...extraHeaders },
    maxRedirections: 5, // undici does NOT follow redirects without this
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: await res.body.text(),
    finalUrl: url, // undici request() does not expose the post-redirect URL; keep the requested URL for href resolution
  };
}
```

Functions to export:

1. `fetchAndParseFeed(feedUrl, opts?: { etag?: string | null; lastModified?: string | null }): Promise<FetchFeedResult>`
   - Builds conditional-GET headers exactly as `pollFeed` does today
     (`if-none-match` from `etag`, `if-modified-since` from `lastModified`).
   - Returns a discriminated result so callers keep the 304 behavior:
     `{ status: 'not-modified' }` |
     `{ status: 'ok'; parsed: Parser.Output<Record<string, unknown>>; etag?: string; lastModified?: string }`.
   - Throws on `statusCode >= 400` with `new Error('HTTP ' + statusCode)` and
     lets network errors propagate, matching current `pollFeed` error text so
     `lastError` values stay stable. No DB access.

2. `feedArticleRows(feedId: string, parsed): NewArticleInsert[]` - pure mapping
   of `parsed.items` to insert rows, lifted verbatim from `pollFeed`
   (guid = `item.guid ?? item.link ?? item.id`, drop items with no guid,
   `contentHtml = item['content:encoded'] ?? item.content ?? null`, etc.). Keep
   the existing `// TODO: sanitize HTML` comment; sanitization is SPEC-001.

3. `resolveFavicon(siteUrl: string, html?: string): string | null` - pure.
   - If `html` is provided, `parse(html)` and take the first matching link:
     `link[rel~="icon"]`, `link[rel="shortcut icon"]`, `link[rel="apple-touch-icon"]`
     (query in that priority order; `rel~="icon"` covers `rel="icon"`). Resolve
     its `href` to absolute with `new URL(href, siteUrl).href` and return it.
   - If no link tag matches, or `html` is omitted, return
     `new URL('/favicon.ico', siteUrl).href` (unverified; a missing favicon
     just fails client-side, handled by the sidebar `onError`).
   - Return `null` only if `siteUrl` is not a parseable absolute URL.

4. `discoverFeedCandidates(url: string): Promise<FeedCandidate[]>` - the shared
   logic behind `GET /feeds/discover` and the `POST /feeds` ambiguity check.
   - `httpGet(url)`. On any thrown network error, return `[]` (discovery of an
     unreachable host is empty, not an exception).
   - **Direct feed:** if the `content-type` header is feed-ish
     (`application/rss+xml`, `application/atom+xml`, `application/xml`,
     `text/xml`, `application/json`, `application/feed+json`) or the body parses
     as a feed (`await parser.parseString(body)` succeeds), return a single
     candidate `[{ feedUrl: url, title: parsed?.title ?? null }]`.
   - **HTML page:** otherwise `parse(body)` and collect
     `link[rel="alternate"]` whose `type` is one of
     `application/rss+xml`, `application/atom+xml`, `application/json`,
     `application/feed+json`. For each, resolve `href` to absolute against `url`
     and take the `title` attribute (or `null`).
   - **Fallback probing:** if the HTML yielded no candidates, probe a small
     fixed list of common paths against the page origin:
     `/feed`, `/feed.xml`, `/rss`, `/rss.xml`, `/atom.xml`, `/index.xml`,
     `/feed/`. For each, `httpGet` and keep it only if the body parses as a
     feed. Do these with bounded concurrency (they are best-effort; wrap each in
     try/catch and ignore failures).
   - Dedup the result by `feedUrl` before returning.

5. `fetchAndStoreFeed(feed: FeedRow): Promise<void>` - the DB-writing half,
   lifted from `pollFeed`. Given a `feeds` row:
   - `const result = await fetchAndParseFeed(feed.feedUrl, { etag: feed.etag, lastModified: feed.lastModified })`.
   - On `not-modified`: update just `lastFetchedAt`, return (as today).
   - On `ok`: compute `siteUrl = result.parsed.link ?? feed.siteUrl`. Resolve
     the favicon only when `feed.faviconUrl` is currently `null` and a
     `siteUrl` is known: fetch the site page HTML once
     (`httpGet(siteUrl)`, ignore failures) and call
     `resolveFavicon(siteUrl, html)`. Skip the extra HTTP call entirely when
     `feed.faviconUrl` is already set, so steady-state polling cost is
     unchanged. Then update the `feeds` row with the same columns `pollFeed`
     sets today (`title`, `siteUrl`, `description`, `etag`, `lastModified`,
     `lastFetchedAt`, `lastError: null`, `failureCount: 0`, `updatedAt`) plus
     `faviconUrl` (only when newly resolved). Insert articles from
     `feedArticleRows(feed.id, result.parsed)` with `onConflictDoNothing({ target: [articles.feedId, articles.guid] })`.
   - Wrap the whole thing in the same try/catch `pollFeed` uses: on error, set
     `lastFetchedAt`, `lastError: message`, `failureCount: sql` + 1`. Do not
     rethrow. This is what lets `POST /feeds` create a subscribable row for a
     feed that is momentarily down.

Then `pollFeed(feed)` becomes a thin wrapper:
`export async function pollFeed(feed: FeedRow) { await fetchAndStoreFeed(feed); }`.
`findDueFeeds` and `pollDueFeeds` in `poll.ts` are unchanged.

### POST /feeds fetch cost

The single-candidate homepage path does two feed-related fetches: one in
`discoverFeedCandidates` (the homepage HTML) and one in `fetchAndStoreFeed`
(the feed itself), plus at most one favicon HTML fetch on first resolution.
This is acceptable for an interactive subscribe. Do not prematurely thread the
already-fetched body through; keep the functions independent and easy to reuse
from SPEC-009. Reuse the existing 15s `rss-parser` timeout so a dead site
cannot hang the request indefinitely.

### Favicon bytes are not cached or proxied

`faviconUrl` stores the external URL as-is; the browser fetches it directly.
Proxy or cache it later if hotlinking becomes a problem (mixed content, hosts
that block hotlinking, or privacy). Out of scope here.

### Security (SSRF)

Discovery and favicon resolution fetch arbitrary user-supplied URLs, the same
surface the worker already exposes, so this adds no new class of exposure. It
does make that surface reachable synchronously from an authenticated request.
For trusted self-hosted single-tenant use this is fine. Flag SSRF protections
(reject private / link-local / loopback targets, cap response size, cap
redirects) as a follow-up before exposing this to untrusted users.

## Acceptance criteria

- [ ] Subscribing with a direct feed URL returns `201 { subscription, feed }`
      with `feed.title`, `feed.siteUrl`, `feed.description`, and
      `feed.faviconUrl` populated in the response, with no worker tick.
- [ ] The feed's initial articles are stored during that same request (a
      subsequent article-list query returns them without waiting for the
      worker).
- [ ] Subscribing with a homepage URL that has exactly one discoverable feed
      link auto-resolves to that feed and subscribes to it.
- [ ] Subscribing with a homepage URL that exposes multiple feed links returns
      `409` with body `{ error: 'ambiguous_feed', message, statusCode: 409, candidates }`
      and creates no `feeds` or `subscriptions` row; the UI lists the
      candidates, and picking one completes the subscribe on re-submit.
- [ ] Subscribing with a homepage URL that has zero discoverable feeds returns
      `422 { error: 'no_feed_found', ... }` and creates no feed.
- [ ] Re-subscribing to an already-stored `feedUrl` reuses the same `feeds`
      row, performs no new feed fetch, and creates (or no-ops) only the
      subscription.
- [ ] `GET /feeds/discover?url=` returns `200 { candidates }` (empty array
      allowed) and writes nothing to `feeds` or `subscriptions`.
- [ ] The sidebar renders the resolved favicon next to each feed title
      immediately after subscribing, falling back to a generic icon when the
      favicon is null or fails to load.
- [ ] `pollFeed` still does the same conditional-GET (304 short-circuit), the
      same error recording (`lastError` / `failureCount`), and the same
      article insertion as before the extraction. Its only new behavior is
      populating `faviconUrl` on the first successful fetch when it was null.

## Testing

Follow the existing `apps/api/src/**/*.test.ts` pattern (vitest,
`buildApp()` + `app.inject`, or direct function calls). Mock outbound HTTP so
tests do not hit the network (stub `undici.request`, or inject fixtures at the
`httpGet` boundary).

- Unit `discoverFeedCandidates`: fixture HTML with (a) multiple
  `<link rel="alternate">` tags, (b) exactly one, (c) none but a fallback path
  that parses as a feed, (d) none and no fallback, (e) a direct feed body
  (content-type feed-ish), (f) an unreachable host (returns `[]`). Assert
  candidate `feedUrl`s are absolute.
- Unit `resolveFavicon`: `<link rel="icon">` present (absolute and relative
  hrefs both resolve correctly), `apple-touch-icon` only, and none present
  (falls back to `/favicon.ico` on the site origin).
- Unit `fetchAndStoreFeed` / `pollFeed` parity: a 304 response updates only
  `lastFetchedAt`; a 200 updates metadata and inserts articles; a failing
  fetch sets `lastError` and increments `failureCount` without throwing.
- Integration `POST /feeds`: direct feed URL (metadata populated in the
  response), single-candidate homepage (auto-resolves), multi-candidate
  homepage (expect `409` with `candidates`), zero-candidate homepage (expect
  `422`), and re-subscribe to an existing `feedUrl` (assert dedup and, via a
  mocked fetch call count, that no new feed fetch happens).
- Integration `GET /feeds/discover`: returns candidates and performs zero DB
  writes (assert `feeds` / `subscriptions` row counts are unchanged).
- Manual: paste a real site homepage with a single RSS `<link>` into the
  subscribe dialog and confirm the title and favicon appear immediately without
  a worker tick.

## Open questions

- Fallback-path probing adds up to seven extra requests for a homepage with no
  `<link>` tags. Acceptable for interactive subscribe; if it proves slow,
  shrink the list or cap total discovery time. Resolve during implementation if
  it becomes a problem.
