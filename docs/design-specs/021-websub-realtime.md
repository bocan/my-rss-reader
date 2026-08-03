# SPEC-021: WebSub realtime delivery (subscriber side)

- **Status:** Done
- **Phase:** 4
- **Depends on:** none (SPEC-002 is Done; shares the `PUBLIC_URL` env var introduced by SPEC-019, see Implementation notes)
- **Estimated size:** L

## Context

The worker (`apps/api/src/worker/index.ts`) polls on a fixed tick:
`findDueFeeds()` in `apps/api/src/worker/poll.ts` selects feeds whose
`lastFetchedAt` is older than their effective interval
(`coalesce(feeds.fetchIntervalSec, app_settings.defaultPollIntervalSec)`), and
`fetchAndStoreFeed()` in `apps/api/src/lib/feed-fetch.ts` does the conditional
GET, parse, and insert. Polling means new articles arrive minutes-to-hours
late, and every subscribed blog gets hit on a timer whether it published or
not.

[WebSub](https://www.w3.org/TR/websub/) (the W3C standard that grew out of
PubSubHubbub) fixes both: a feed advertises a **hub**, the reader subscribes
once with a callback URL, and the hub POSTs new content to us the moment it is
published. WordPress.com, Blogger, Micro.blog, many Ghost and FreshRSS-adjacent
blogs, and every feed fronted by Superfeedr advertise a hub today. Polling
stays as the fallback for the majority of feeds that do not.

This spec implements the **subscriber** role only: discover hubs, subscribe,
verify, receive signed content pushes, renew leases, and back off polling for
feeds with an active push subscription.

Relevant existing pieces:

- `fetchAndParseFeed()` already returns response headers upward only as
  `etag` / `lastModified`; it will additionally need to surface hub/self links.
- `feedArticleRows(feedId, parsed)` is a pure mapper from a parsed feed to
  sanitized article insert rows; a pushed feed document goes through the exact
  same function, so sanitization (SPEC-001) and search text (SPEC-006) are
  inherited for free.
- Routes are registered under the `/api` prefix in `apps/api/src/app.ts`; the
  callback endpoint lives there too (it is an API endpoint, just an
  unauthenticated one).

## Goal

A feed that advertises a WebSub hub delivers new articles within seconds of
publication, with no user-visible configuration. Feeds without a hub behave
exactly as today. The feed settings dialog shows whether realtime delivery is
active.

## Non-goals

- Acting as a WebSub **hub** or **publisher** (our own shared-item feeds from
  SPEC-019 do not advertise a hub; noted there as an open question).
- WebSub for HTML topics or any non-feed content type.
- Per-user control over WebSub. Feeds are global; the subscription to the hub
  is a property of the feed row, invisible to individual users.
- Retrying failed subscribe requests on a dedicated schedule. The worker
  re-attempts on its normal tick cadence (see Implementation notes), which is
  plenty; a hub that is down just means we keep polling.
- Removing or lengthening the polling fallback beyond the single floor
  constant defined below. Polling remains the integrity backstop
  (hubs drop subscriptions, miss pings, and go away).

## Data model changes

Six columns on `feeds` in `apps/api/src/db/schema.ts`, declared after
`fetchIntervalSec`:

```ts
// WebSub subscriber state (SPEC-021). hubUrl/topicUrl come from feed
// discovery (Link headers or atom:link). State machine:
// inactive -> pending (subscribe sent) -> active (hub verified) and back to
// inactive when a feed stops advertising a hub; 'denied' is terminal until
// the hub/topic changes.
websubHubUrl: text(),
websubTopicUrl: text(),
websubSecret: text(),
websubCallbackToken: text(),
websubLeaseExpiresAt: timestamp({ withTimezone: true }),
websubState: text().notNull().default('inactive'),
```

Plus one index (the callback route resolves feeds by token):

```ts
uniqueIndex('feeds_websub_callback_token_key').on(t.websubCallbackToken),
```

Postgres allows multiple NULLs in a unique index, so feeds that never
subscribed coexist fine.

`websubState` values: `'inactive' | 'pending' | 'active' | 'denied'`. Kept as
free-form text (matching the SPEC-011 convention for evolving vocabularies)
with a `WEBSUB_STATES` const in `@rss/shared`'s `types.ts` and a unit test in
the style of `apps/api/src/db/enums.test.ts` if desired; a pgEnum is fine too
but text is less migration churn if states evolve.

Migration: `pnpm db:generate` from `apps/api`, next free prefix after
`0010_flippant_energizer.sql`. Six nullable/default-bearing `ALTER TABLE feeds
ADD COLUMN`s plus the unique index; no table rewrite concerns.

## API changes

### Env (`apps/api/src/env.ts`)

```ts
// Public base URL of this instance (scheme + host, no trailing slash).
// Required for WebSub (the hub must reach our callback) and used by SPEC-019
// public pages for absolute links. When unset, WebSub stays dormant.
PUBLIC_URL: z.url().optional(),
```

If SPEC-019 already added `PUBLIC_URL`, reuse it verbatim. Document in
`.env.example`: `PUBLIC_URL=https://reader.example.com`.

Two module constants (in the new `apps/api/src/lib/websub.ts`, not env vars):
`LEASE_SECONDS_REQUESTED = 604_800` (7 days; hubs may shorten it) and
`WEBSUB_ACTIVE_POLL_FLOOR_SEC = 21_600` (6 hours; how lazily we poll a feed
that has an active push subscription).

### Discovery plumbing (`apps/api/src/lib/feed-fetch.ts`)

Extend `FetchFeedResult`'s `ok` variant with hub discovery:

```ts
| { status: 'ok'; parsed: ParsedFeed; etag?: string; lastModified?: string;
    hubUrl: string | null; topicUrl: string | null }
```

Add a pure helper (exported for tests) in the new `apps/api/src/lib/websub.ts`:

```ts
/** Extract rel=hub / rel=self from HTTP Link headers and the feed XML.
 *  Returns absolute URLs resolved against feedUrl; topicUrl falls back to
 *  feedUrl when the feed declares no rel=self. */
export function discoverWebSubLinks(
  linkHeader: string | string[] | undefined,
  xmlBody: string,
  feedUrl: string,
): { hubUrl: string | null; topicUrl: string } 
```

Two sources, header wins on conflict:

1. **HTTP `Link` header.** Format: `<https://hub.example>; rel="hub",
   <https://blog.example/feed>; rel="self"`. Write a small parser (split on
   commas outside `<>`, match `<(.*?)>` and `rel="?([^";]+)"?`, rel is a
   space-separated token list). No new dependency.
2. **In-document links.** Parse the raw XML with `fast-xml-parser` (already a
   dependency via `apps/api/src/lib/opml.ts`) with `ignoreAttributes: false`.
   Look at `feed.link` (Atom) and `rss.channel['atom:link']` (RSS with the
   Atom namespace), each an object or array; take entries whose `@_rel` is
   `hub` / `self` and read `@_href`. Resolve relative hrefs against `feedUrl`
   with `new URL(href, feedUrl)`.

`fetchAndParseFeed()` calls this with `res.headers['link']`, `res.body`, and
the feed URL, and passes the result through. A `304 not-modified` response
carries no body; the `not-modified` variant stays unchanged (hub links persist
from the last full fetch).

### Callback routes (new `apps/api/src/routes/websub.ts`)

Registered in `apps/api/src/routes/index.ts` like every other route module.
Both routes are **unauthenticated** (hubs cannot log in); the random 32-hex
`websubCallbackToken` in the path is the capability. Register both with
`config: { rateLimit: false }` so a burst of legitimate pings from a big hub
does not eat the global 300/min budget (`@fastify/rate-limit` honors per-route
config).

**`GET /api/websub/callback/:token`** - subscription verification
([spec 5.3](https://www.w3.org/TR/websub/#hub-verifies-intent)). Query params
arrive as `hub.mode`, `hub.topic`, `hub.challenge`, `hub.lease_seconds`.
Validate with a Zod schema over `request.query` (note the literal dots in the
keys: `z.object({ 'hub.mode': z.enum([...]), ... })`).

- Token resolves to no feed: `404`.
- `hub.mode === 'subscribe'`: require `hub.topic === feed.websubTopicUrl` and
  `feed.websubState` in `('pending', 'active')`; on match, set
  `websubState = 'active'`,
  `websubLeaseExpiresAt = now() + hub.lease_seconds` (integer seconds; Zod
  `z.coerce.number().int().positive()`), and reply `200` with
  `content-type: text/plain` and the **raw `hub.challenge` string as the
  body**. Anything else: `404` (this is how a subscriber refuses).
- `hub.mode === 'unsubscribe'`: echo the challenge only if we actually want
  out (state is `inactive`); otherwise `404`.
- `hub.mode === 'denied'` ([spec 5.2](https://www.w3.org/TR/websub/#subscription-validation)):
  set `websubState = 'denied'`, clear `websubLeaseExpiresAt`, reply `200`.
  Denied is terminal until the feed's advertised hub or topic changes (see
  worker logic).

**`POST /api/websub/callback/:token`** - content distribution
([spec 7](https://www.w3.org/TR/websub/#content-distribution)).

- Needs the **raw body** for signature verification. Inside this route module
  register a scoped content-type parser (Fastify content-type parsers are
  encapsulated per plugin, so this cannot leak):

  ```ts
  app.addContentTypeParser(
    ['application/rss+xml', 'application/atom+xml', 'application/xml',
     'text/xml', 'application/rdf+xml'],
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (req, body, done) => done(null, body),
  );
  ```

- Token resolves to no feed: **`410 Gone`** (per spec 7, a 410 tells the hub
  to drop the subscription; this is exactly right for a feed row that was
  deleted while a lease was still live).
- Signature: we always subscribe with a secret, so require
  `x-hub-signature: sha256=<hex>`. Compute
  `createHmac('sha256', feed.websubSecret).update(rawBody)` and compare with
  `timingSafeEqual`. **On missing or invalid signature, reply `200` and do
  nothing else** (spec 7.1: subscribers MUST still return 2xx so the hub does
  not retry, and MUST NOT process the payload). Log a warning with the feed id.
- Valid signature: `parser.parseString(body.toString('utf8'))` (export a
  parse-only helper from `feed-fetch.ts` or import its shared `Parser`
  instance), then `feedArticleRows(feed.id, parsed)` and the same
  `insert ... onConflictDoNothing({ target: [articles.feedId, articles.guid] })`
  as `fetchAndStoreFeed`. Update `lastFetchedAt = now()`, `lastError = null`,
  `failureCount = 0`. Reply `200`.
- Body fails to parse (some hubs send thin or mangled pings): reply `200` and
  set `lastFetchedAt = null`, which makes `findDueFeeds()` pick the feed up on
  the very next worker tick (its `isNull(feeds.lastFetchedAt)` arm). The ping
  still bought us near-realtime freshness.

### Feed metadata for the client

`GET /api/feeds` (`apps/api/src/routes/feeds.ts`) and the `subscriptionRow()`
helper add two fields to their select: `websubState: feeds.websubState` and
`websubLeaseExpiresAt: feeds.websubLeaseExpiresAt`. Purely informational for
the UI.

## Web / UI changes

One small addition: `FeedSettingsDialog.tsx`
(`apps/web/src/components/feed/FeedSettingsDialog.tsx`) shows a read-only
"Delivery" line next to the existing poll-interval control:

- `websubState === 'active'`: "Realtime via WebSub (lease renews DATE)" with a
  subtle dot in the success color.
- `'pending'`: "Realtime subscription pending".
- `'denied'`: "Realtime refused by hub; polling instead".
- `'inactive'`: "Polled (this feed does not offer realtime delivery)".

No user controls. The two new fields flow through the existing feeds query
types in `apps/web/src/lib/feeds.ts`.

## Implementation notes

Work order:

1. **Schema + migration.** Columns and index as above; `pnpm db:generate`,
   inspect the SQL, commit.
2. **`lib/websub.ts`.** `discoverWebSubLinks()` (pure, unit-testable),
   `subscribeToHub(feed)` and `unsubscribeFromHub(feed)` (below), the
   constants, and `verifySignature(secret, header, rawBody)`.
3. **Wire discovery.** `fetchAndParseFeed()` returns hub/topic;
   `fetchAndStoreFeed()` persists them when changed. State transitions on
   change: a new hub or topic URL resets `websubState` to `'inactive'` and
   clears the lease (this is also what un-sticks `'denied'`). A feed that
   stops advertising a hub entirely: best-effort `unsubscribeFromHub`, then
   null out hub columns and set `'inactive'`.
4. **`subscribeToHub(feed)`.** Skip unless `env.PUBLIC_URL` is set. Generate
   and persist `websubSecret` (`randomBytes(24).toString('hex')`) and
   `websubCallbackToken` (`randomBytes(16).toString('hex')`) if null. Set
   state `'pending'` (first subscribe) or leave `'active'` (renewal). POST
   `application/x-www-form-urlencoded` to the hub with undici's `request`
   (reuse the redirect-composed dispatcher pattern from `feed-fetch.ts`):
   `hub.mode=subscribe`, `hub.topic=<websubTopicUrl>`,
   `hub.callback=${PUBLIC_URL}/api/websub/callback/${token}`,
   `hub.lease_seconds=604800`, `hub.secret=<secret>`. A 202 (or any 2xx) means
   "verification will follow"; a non-2xx logs and leaves state as-is (next
   tick retries). Never throw.
5. **Worker integration** (`apps/api/src/worker/poll.ts`):
   - After `fetchAndStoreFeed` inside `pollFeed`, if the feed now has a hub
     and `websubState === 'inactive'`, call `subscribeToHub`. (Do it here
     rather than inside `fetchAndStoreFeed` so the synchronous subscribe path
     in `POST /api/feeds` stays fast; first poll after subscribing a new feed
     picks it up within one tick.)
   - New `renewDueWebSubLeases()` called from the worker `tick()` after
     `pollDueFeeds()`: select feeds where `websubState = 'active'` and
     `websubLeaseExpiresAt < now() + interval '12 hours'`, and
     `subscribeToHub` each (bounded by the same concurrency pattern as
     `pollDueFeeds`). An expired lease that somehow slipped through renewal:
     also match `websubLeaseExpiresAt < now()` and treat identically; if the
     hub is gone the state machine self-heals via step 3 on the next poll.
   - **Poll back-off**: in `findDueFeeds()`, the effective interval becomes

     ```sql
     greatest(
       coalesce(fetch_interval_sec, ${defaultPollIntervalSec}),
       case when websub_state = 'active' and websub_lease_expires_at > now()
            then ${WEBSUB_ACTIVE_POLL_FLOOR_SEC} else 0 end
     )
     ```

     so an active push subscription floors polling at 6 hours (still a real
     integrity check) while a lapsed/denied one falls back to the normal
     cadence automatically.
6. **Callback routes** as specified, registered in `routes/index.ts`.
7. **Client display** last; it is cosmetic.

Security notes:

- The callback token is an unguessable capability; the HMAC secret
  additionally authenticates *content* so a leaked callback URL alone cannot
  inject articles. Both live only server-side (never returned by any API).
- `hub.topic` echo-check on verification prevents a malicious hub from
  binding our callback to a topic we never asked for.
- Pushed content flows through `feedArticleRows`, i.e. through
  `sanitizeArticleHtml` (SPEC-001), identical to polled content.
- `subscribeToHub` POSTs to a URL taken from a fetched feed document. That is
  the same SSRF exposure class as feed fetching itself (the worker fetches
  arbitrary user-supplied URLs by design); the readability lib documents the
  private-range block as a follow-up, and the same follow-up covers this.

Gotcha: Fastify parses `hub.mode`-style keys fine (they are just query-string
keys), but `request.query` typing needs the bracket access or a Zod parse; use
the Zod schema and keep the handler typed.

## Acceptance criteria

- [ ] The six `feeds` columns and the unique token index exist via a committed
      migration; `pnpm db:generate` afterwards reports no drift.
- [ ] `discoverWebSubLinks` finds hub/self from (a) a `Link` header, (b) Atom
      `<link rel="hub">`, (c) RSS `<atom:link rel="hub">`, resolves relative
      hrefs, prefers the header on conflict, and falls back `topicUrl` to the
      feed URL when no `rel=self` exists.
- [ ] With `PUBLIC_URL` unset, no subscribe attempt is ever made and behavior
      is byte-identical to today.
- [ ] With `PUBLIC_URL` set, polling a hub-advertising feed transitions it
      `inactive -> pending` and sends a well-formed subscribe POST (mode,
      topic, callback, lease, secret).
- [ ] A correct `GET` verification (matching token + topic, mode subscribe)
      echoes the exact challenge with 200 and stores the lease expiry;
      a mismatched topic or unknown token gets a 404 and no state change.
- [ ] `hub.mode=denied` marks the feed `denied`; a later change of advertised
      hub resets it to `inactive` and allows a fresh attempt.
- [ ] A `POST` with a valid `X-Hub-Signature: sha256=...` inserts exactly the
      new articles (deduplicated by `(feedId, guid)`), sanitized, with
      `lastFetchedAt` updated.
- [ ] A `POST` with a missing or wrong signature returns 200, inserts
      nothing, and logs a warning; an unknown token returns 410.
- [ ] An unparseable signed body returns 200 and nulls `lastFetchedAt`, and
      the next worker tick re-polls the feed.
- [ ] A feed with `websubState='active'` and an unexpired lease is not
      selected by `findDueFeeds()` until 6 hours have passed, while a feed
      with a lapsed lease polls at its normal interval.
- [ ] Leases within 12 hours of expiry are re-subscribed by the worker tick.
- [ ] The feed settings dialog shows the correct delivery line for all four
      states.

## Testing

- **Unit (`lib/websub.test.ts`).** `discoverWebSubLinks` across: Link header
  only, Atom links only, RSS atom:link only, both (header wins), relative
  hrefs, no self link (topic falls back to feed URL), multi-value and
  comma-combined Link headers. `verifySignature` accept/reject/malformed
  header/timing-safe path (assert it never throws on odd input lengths).
- **Integration (callback routes, `websub.int.test.ts` in the SPEC-015
  harness style via `app.inject`).** Seed a feed row with token/secret/topic:
  GET verification happy path (challenge echoed, lease stored), topic
  mismatch 404, unknown token 404, denied flow; POST signed Atom body inserts
  articles once (repeat POST inserts zero), bad signature 200 + no insert,
  unknown token 410, unparseable body 200 + `lastFetchedAt` null.
- **Unit (worker).** `findDueFeeds` SQL: an active-lease feed with a 15-minute
  interval is due only after 6 hours; renewal selection window picks leases
  expiring within 12 hours.
- **Manual.** Subscribe to a WordPress.com blog feed (they advertise
  `websub.rocks`-compatible hubs) on a deployment with a reachable
  `PUBLIC_URL`; publish nothing and confirm state reaches `active`; confirm
  the dialog copy. Optionally run the online websub.rocks subscriber
  conformance suite against the instance.

## Open questions

- Should `POST /api/feeds` (interactive subscribe) also trigger an immediate
  `subscribeToHub` instead of waiting for the first worker tick? Cheap to add
  (fire-and-forget after the 201), skipped here to keep the interactive path
  simple; the tick delay is at most `FEED_POLL_INTERVAL_SEC`.
- Orphaned feeds (zero subscribers after `DELETE /api/feeds/:id`) currently
  keep their rows and keep polling; they would also keep their WebSub lease.
  A general orphan-feed reaper is worth its own tiny spec; when it lands it
  should call `unsubscribeFromHub` before deleting.
