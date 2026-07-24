# SPEC-005: Read / unread / star state and mark-all-read

- **Status:** Done
- **Phase:** 1
- **Depends on:** SPEC-003
- **Estimated size:** M

## Context

The read/starred data model already exists and is correct; this spec wires it
into bulk actions, unread counts, and optimistic UI. Verified against the code:

- `articleStates` (`apps/api/src/db/schema.ts:122`) has a composite primary key
  `(userId, articleId)` and columns `read` (bool, default false), `starred`
  (bool, default false), `readAt` (timestamptz, nullable), `starredAt`
  (timestamptz, nullable). There is a `article_states_starred_idx` on
  `(userId, starred)`. A missing row means "never touched": unread and
  unstarred.
- `PATCH /api/articles/:id/state` (`apps/api/src/routes/articles.ts:68`)
  already upserts a single state row via `updateArticleStateSchema`
  (`packages/shared/src/schemas/article.ts:21`). Its `onConflictDoUpdate`
  only writes the fields present in the body, so toggling `read` never
  clobbers `starred` and vice versa. Keep this route as-is.
- `markReadSchema` (`packages/shared/src/schemas/article.ts:28`,
  `{ feedId?, folderId?, before? }`) is exported but has **no route** wired to
  it yet. This spec adds one.
- `GET /api/feeds` (`apps/api/src/routes/feeds.ts:12`) lists subscriptions
  with feed metadata but returns **no unread counts**, so the sidebar has
  nothing to badge. This spec adds counts.
- `GET /api/articles` (`apps/api/src/routes/articles.ts:13`) resolves target
  feeds from `subscriptions` scoped to the user, but only honors `feedId`, not
  `folderId` (the `folderId` field in `articleQuerySchema` is currently
  ignored by the route). So folder-to-feed resolution is **new logic** this
  spec must write; it is not something to "reuse" from `GET /articles`.
- Routes are registered under the `/api` prefix in
  `apps/api/src/routes/index.ts`. Every route in this spec requires auth via
  `{ preHandler: app.requireAuth }`; `request.user!.id` is the current user.
- Web uses TanStack Query for all server state. The subscriptions query key is
  `['feeds']` (`apps/web/src/routes/ReaderPage.tsx:17`). Mutation hooks live
  next to their data in `apps/web/src/lib/` (see `auth.ts`). The article list
  (keyset pagination + infinite scroll) is built in SPEC-003 and its cache is
  a `useInfiniteQuery` with data shape `{ pages: Paginated<Article>[],
  pageParams }`.

## Goal

Toggling read or starred is instant and durable. Opening an article marks it
read automatically, exactly once. A user can mark every article in the current
view (a feed, a folder, or everything) as read in one action. The sidebar shows
an unread count per feed and per folder that stays correct as the user reads,
with no polling.

## Non-goals

- **Mark-read-on-scroll** as a distinct behavior. SPEC-011 adds it as a user
  preference. This spec implements only mark-on-open, and factors the trigger
  behind a `markReadOnOpen(article)` helper so SPEC-011 can swap it later.
- **The reading pane UI itself** (SPEC-004). This spec only provides the
  mutation the pane calls when an article opens.
- **Keyboard shortcuts** for read/star (SPEC-008). This spec builds the exact
  mutation hooks those shortcuts will call.
- **Nested-folder rollups.** Folders can nest (`folders.parentId`), but folder
  scoping here means *direct* membership only (subscriptions whose `folderId`
  equals the target). Descendant-folder aggregation is deferred to SPEC-007,
  which owns the folder UI.
- **Materialized or cached counts** (a counts table, Redis, a trigger).
  Compute on read with a grouped query; this is fine at self-hosted scale. Add
  an index or cache later only if a real slow-query log shows it.

## Data model changes

**None.** `articleStates` already has every column needed, and a row's absence
already means "unread and unstarred". No migration.

Invariant to preserve everywhere: **never delete a state row to "unmark"
something.** Always upsert. Deleting would drop the other half of the state
(e.g. clearing `read` on a starred article must not lose `starred`). The bulk
mark-read route below only ever writes `read`/`readAt`, never `starred`.

## API changes

### 1. `PATCH /api/articles/:id/state` (existing, unchanged)

Keep exactly as written. It is the single-article upsert and it already
preserves the untouched half of the state.

### 2. `POST /api/articles/mark-read` (new, auth required)

Body is the existing `markReadSchema` (`{ feedId?, folderId?, before? }`). All
fields optional. Semantics:

- **Scope precedence:** if `feedId` is present, mark that one feed (still
  scoped to the user's subscription to it). Else if `folderId` is present, mark
  every feed directly in that folder. Else (neither present) mark every feed
  the user is subscribed to. If both `feedId` and `folderId` are somehow sent,
  `feedId` wins (document this in a route comment).
- **`before` cutoff:** when present, additionally restrict to articles whose
  effective date is strictly before the timestamp, using
  `coalesce(published_at, fetched_at) < before`. Every article has a non-null
  `fetchedAt` (schema default `now()`), so undated articles fall back to their
  fetch time rather than being silently always-included or always-excluded.
  This is deterministic and testable. `before` is an ISO string; cast it to
  `timestamptz` in SQL.

Implementation: resolve target `feedId`s with the shared helper (below), then
do the mark in **one** statement, not a per-row loop:

```ts
// apps/api/src/routes/articles.ts
app.post('/articles/mark-read', auth, async (request, reply) => {
  const input = markReadSchema.parse(request.body);
  const userId = request.user!.id;

  // feedId wins over folderId; neither => all subscribed feeds.
  const feedIds = await resolveSubscribedFeedIds(userId, {
    feedId: input.feedId,
    folderId: input.folderId,
  });
  if (feedIds.length === 0) return reply.code(204).send(); // empty folder / no subs: no-op

  // Undated articles fall back to fetched_at so `before` is deterministic.
  const beforeClause = input.before
    ? sql`and coalesce(a.published_at, a.fetched_at) < ${input.before}::timestamptz`
    : sql``;

  await db.execute(sql`
    insert into article_states (user_id, article_id, read, read_at)
    select ${userId}::uuid, a.id, true, now()
    from articles a
    where a.feed_id = any(${feedIds}::uuid[]) ${beforeClause}
    on conflict (user_id, article_id) do update
      set read = true, read_at = now()
      where article_states.read = false
  `);

  return reply.code(204).send();
});
```

Notes:
- The `set` clause touches only `read`/`read_at`; existing `starred`/
  `starred_at` on any conflicting row survive untouched.
- The `where article_states.read = false` on the conflict branch makes the
  operation idempotent: an already-read article is left alone, so re-running
  mark-read does not rewrite `read_at`. New rows and unread rows are marked.
- Empty `feedIds` (no subscriptions, or an empty folder) returns `204`, not an
  error.
- Prefer the raw `db.execute(sql\`...\`)` form above over Drizzle's
  insert-from-select builder: in drizzle-orm 0.45.2 the builder's interaction
  with `onConflictDoUpdate ... where` is fiddly, and raw SQL keeps the whole
  set-based statement legible. Columns are snake_case in raw SQL (the app maps
  camelCase elsewhere via `casing: 'snake_case'`).

### 3. `GET /api/feeds` (response change)

Add `unreadCount: number` to each subscription row. Do **not** inline a second
`GROUP BY` into the existing subscriptions query; instead call the shared
`getUnreadCountsByFeed(userId)` helper and merge its results in application
code by `feedId` (each user has at most one subscription per feed, enforced by
`subscriptions_user_feed_key`, so `feedId` is a unique merge key). Feeds absent
from the helper result (zero articles) get `unreadCount: 0`.

Resulting row shape gains one field; existing fields are unchanged.

### 4. `GET /api/counts` (new, auth required)

One round trip for the whole sidebar. New route file
`apps/api/src/routes/counts.ts`, registered in
`apps/api/src/routes/index.ts`. Response:

```ts
// UnreadCounts, added to packages/shared/src/types.ts
export interface UnreadCounts {
  feeds: { feedId: string; unreadCount: number }[];
  folders: { folderId: string; unreadCount: number }[];
  total: number;
}
```

Implementation:
1. `getUnreadCountsByFeed(userId)` -> `[{ feedId, unreadCount }]` (the same
   helper `GET /feeds` uses, so the two never drift).
2. Fetch `{ feedId, folderId }` for the user's subscriptions (one small query).
3. Roll up in application code: sum each feed's count into its subscription's
   `folderId` bucket (skip subscriptions with a null `folderId`); sum all feed
   counts into `total`. No second aggregate round trip.

### 5. Shared helpers (new)

**`apps/api/src/lib/feed-scope.ts`**

```ts
export async function resolveSubscribedFeedIds(
  userId: string,
  scope: { feedId?: string; folderId?: string },
): Promise<string[]>;
```

Returns the user's subscribed `feedId`s, optionally narrowed. `feedId` wins
over `folderId`. `feedId` narrows to that single subscription (empty array if
the user is not subscribed to it). `folderId` narrows to subscriptions with
that exact `folderId`. Neither returns all of the user's subscribed feeds.
Always scoped to `userId`. This centralizes the feed-scoping logic that
`GET /articles` currently open-codes for `feedId` only; wiring `GET /articles`
onto this helper (and thereby giving it `folderId` support) is optional here
and otherwise belongs to SPEC-003, but the helper must exist for this spec.

**`apps/api/src/lib/unread-counts.ts`**

```ts
export async function getUnreadCountsByFeed(
  userId: string,
): Promise<{ feedId: string; unreadCount: number }[]>;
```

A single grouped join, "missing state row = unread":

```sql
select s.feed_id as "feedId",
       count(a.id) filter (where coalesce(st.read, false) = false)::int
         as "unreadCount"
from subscriptions s
join articles a on a.feed_id = s.feed_id
left join article_states st
  on st.article_id = a.id and st.user_id = s.user_id
where s.user_id = ${userId}::uuid
group by s.feed_id
```

The `left join` plus `coalesce(st.read, false) = false` is what counts
articles that have no state row as unread. The `count(...) filter (...)` counts
only unread articles per feed. Cast the count to `int` so it deserializes as a
number, not a string.

No new Zod schema is required (`markReadSchema` already exists). Only the
`UnreadCounts` TypeScript type is added to `packages/shared/src/types.ts` and
exported via the barrel, shared by API and web.

## Web / UI changes

All hooks go in `apps/web/src/lib/` beside `auth.ts`, using the same
`api<T>(path, { method, body })` wrapper and `useQueryClient` pattern.

### Query keys

- Subscriptions: `['feeds']` (existing).
- Article list: `['articles', filters]` (a `useInfiniteQuery` from SPEC-003;
  `filters` is the serialized `{ feedId?, folderId?, unread?, starred?,
  sort }`).
- Counts: `['counts']`.

### Hooks

- **`useUnreadCounts()`** - `useQuery({ queryKey: ['counts'], queryFn: () =>
  api<UnreadCounts>('/counts') })`. No polling; kept fresh by the optimistic
  writes below and `onSettled` invalidation.
- **`useToggleArticleState(articleId)`** - `useMutation` over `PATCH
  /articles/:id/state`, body `{ read?: boolean; starred?: boolean }`.
- **`useMarkRead()`** - `useMutation` over `POST /articles/mark-read`, variables
  `{ feedId?; folderId?; before? }`.

### Optimistic single toggle (`useToggleArticleState`)

- `onMutate(vars)`: `await qc.cancelQueries` for `['articles']` and
  `['counts']`. Snapshot both with `getQueryData`. Then:
  - In the `['articles', ...]` infinite-query cache, map over `data.pages` and
    each page's `items`, updating the matching article's `read`/`starred`.
  - Only a `read` change adjusts counts: read `false -> true` decrements the
    article's feed bucket, its folder bucket, and `total` by 1; `true -> false`
    increments them by 1. A `starred` change never touches counts. Never let a
    bucket go below 0 (clamp).
  - Return `{ prevArticles, prevCounts }` for rollback.
- `onError(_e, _vars, ctx)`: restore both snapshots via `setQueryData`.
- `onSettled()`: `invalidateQueries` for `['articles']` and `['counts']` so the
  server values reconcile.

### Optimistic bulk mark-read (`useMarkRead`)

- `onMutate(scope)`: same cancel + snapshot. Then:
  - Zero the affected count bucket(s): a `feedId` scope zeroes that feed and
    subtracts its old value from `total`; a `folderId` scope zeroes that folder
    and every feed in it and subtracts from `total`; no scope zeroes every feed,
    every folder, and `total`.
  - Mark matching cached articles `read: true` across all pages.
  - **Exception - `before` cutoff:** the exact set marked is not knowable from a
    partial (infinite-scroll) cache, so do **not** locally zero or mutate counts
    when `scope.before` is set. Skip the optimistic write and rely on
    `onSettled` invalidation to refetch the truth.
- `onError` / `onSettled`: identical to the single toggle (restore, then
  invalidate `['articles']` and `['counts']`).

### Auto mark-read on open

- The article detail view (SPEC-004) calls a `markReadOnOpen(article)` helper
  when an article is opened. The helper fires
  `useToggleArticleState(article.id).mutate({ read: true })` **only if the
  cached article is not already `read`**, so re-renders and reopening an
  already-read article do not send a redundant PATCH and do not double-decrement
  the badge.
- Isolating this in `markReadOnOpen` gives SPEC-011 a single seam to later swap
  the trigger (open vs scroll) behind a preference.

### Sidebar badges

- `useUnreadCounts()` feeds per-feed and per-folder badges in the sidebar
  (`ReaderPage.tsx` sidebar `<nav>`). Render `unreadCount` next to each feed row
  and each folder header; hide the badge when the count is 0. Because the same
  optimistic writes update `['counts']`, badges move the instant a user reads,
  with no refetch.

### Mark-all-read action

- A "Mark all read" control in the article-list header, scoped to the current
  view: pass the active `feedId` or `folderId`, or neither for the "All items"
  view. It calls `useMarkRead().mutate({ ... })`.
- If the current view has more than ~20 unread items (read the count from
  `['counts']`), confirm before firing; otherwise fire immediately.

## Implementation notes

- Suggested order: (1) `resolveSubscribedFeedIds` + `getUnreadCountsByFeed`
  helpers with unit/integration tests; (2) `POST /articles/mark-read`;
  (3) `GET /counts` and the `GET /feeds` count merge; (4) `UnreadCounts` type in
  shared; (5) web hooks and optimistic wiring; (6) sidebar badges and the
  mark-all-read control.
- Benchmark the `INSERT ... SELECT ... ON CONFLICT` against a locally seeded
  Postgres with a few thousand articles to confirm it is one set-based
  statement, not a hidden per-row loop. It is the only performance-sensitive
  query here.
- Idempotency is load-bearing in two places: the bulk route's
  `where article_states.read = false` conflict guard, and the mark-on-open
  "only if not already read" check. Both exist to make the badge decrement
  happen exactly once.
- Security: every route guards with `app.requireAuth` and scopes every query by
  `request.user!.id`. `resolveSubscribedFeedIds` must never return a feed the
  user is not subscribed to, so a crafted `feedId`/`folderId` in a mark-read
  body cannot mark articles in feeds the user cannot see. All array/timestamp
  values go through parameterized `sql` bindings, never string interpolation.
- No em dashes or en dashes anywhere in code or comments; plain hyphens only.

## Acceptance criteria

- [ ] Toggling read or starred updates the UI instantly and survives a full
      page reload (the server value matches after refetch).
- [ ] An API failure on a toggle rolls both the article list and the counts
      back to their pre-mutation values and surfaces an error.
- [ ] Opening an article marks it read in the same interaction, and the feed,
      folder, and total badges each decrement by exactly one, exactly once,
      even if the article is opened or re-rendered multiple times.
- [ ] Mark-all-read scoped to a `feedId` marks only that feed; scoped to a
      `folderId` marks every feed directly in that folder; scoped to neither
      marks the whole subscription set. `feedId` takes precedence over
      `folderId` if both are sent.
- [ ] `POST /articles/mark-read` with `before` marks only articles whose
      `coalesce(published_at, fetched_at)` is strictly before the timestamp,
      leaving newer articles unread.
- [ ] Marking read never changes `starred`/`starred_at`, and starring never
      changes `read`/`read_at` or any unread count.
- [ ] Re-running mark-read (or PATCH with the same value) does not throw, does
      not change an already-read article's `read_at`, and does not double-count.
- [ ] `GET /api/feeds` `unreadCount` values and `GET /api/counts` per-feed
      values agree with each other and with a manual count against
      `article_states`; folder totals equal the sum of their feeds and `total`
      equals the sum across all subscribed feeds.
- [ ] Articles with no `article_states` row are counted as unread everywhere:
      list filters, per-feed counts, per-folder counts, and total.
- [ ] Mark-all-read on an empty folder (or a user with no subscriptions)
      returns `204` and changes nothing.

## Testing

- **Unit - `resolveSubscribedFeedIds`:** no scope (all subscribed feeds), a
  `feedId` the user is subscribed to (single element), a `feedId` the user is
  not subscribed to (empty array), a `folderId` with feeds (its feeds), a
  `folderId` with zero feeds (empty array), and both `feedId` and `folderId`
  together (feedId wins).
- **Integration - `POST /articles/mark-read`:** feed, folder, all, and `before`
  scopes, asserted against resulting `article_states` rows. Seed articles that
  already have a state row (e.g. `starred: true, read: false`) and confirm
  `starred`/`starred_at` are untouched after the mark. Include an undated
  article (`published_at` null) and assert it is marked based on `fetched_at`
  relative to `before`. Assert marking twice is idempotent and leaves the first
  `read_at` unchanged.
- **Integration - counts:** seed a mix of no-state-row, `read: true`, and
  `read: false` articles across feeds in and out of a folder; assert exact
  `getUnreadCountsByFeed`, `GET /feeds` `unreadCount`, and `GET /counts`
  per-feed / per-folder / total values, and that `GET /feeds` and `GET /counts`
  agree.
- **Integration - `PATCH /articles/:id/state`:** called twice with the same
  value is idempotent and never throws; toggling one of `read`/`starred` leaves
  the other and its timestamp untouched.
- **Web - single toggle:** the article-list and counts caches update
  synchronously in `onMutate`, and both roll back on a mocked API error.
- **Web - mark-on-open:** fires at most once per article per session, and not at
  all for an already-read article.
- **Web - bulk with `before`:** confirms no optimistic count write happens and
  that `onSettled` invalidation is what refreshes the badges.
- **Manual:** mark-all-read on a folder with several feeds; every feed badge and
  the folder badge drop to zero without a manual refresh, and a reload shows the
  same zeros.

## Open questions

- Should the mark-all-read confirmation threshold (~20) be a constant or a user
  preference? Treated here as a constant; revisit with SPEC-011 if users ask.
- When `GET /articles` is migrated onto `resolveSubscribedFeedIds` (gaining
  `folderId` support), does that belong to this spec or SPEC-003? Left to
  SPEC-003; this spec only requires the helper to exist.
