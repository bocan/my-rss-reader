# SPEC-022: Attention tiers (firehose / normal / precious)

- **Status:** Done
- **Phase:** 4
- **Depends on:** SPEC-005 (Done), SPEC-007 (Done), SPEC-018 (Done)
- **Estimated size:** M

## Context

The single biggest reason people abandon feed readers is unread-count guilt:
a high-volume feed (a news wire, a subreddit feed, Hacker News) buries the
count badge in four digits, and the friend who posts twice a year drowns in
the noise. Fraidycat's core insight applies: **not every feed deserves the
same attention contract**. Some feeds should never accumulate guilt; some
should never be missable.

Today every subscription is treated identically. Unread counts come from
`getUnreadCountsByFeed()` (`apps/api/src/lib/unread-counts.ts`, one grouped
query over `subscriptions x articles x article_states`), rolled up by
`GET /api/counts` (`apps/api/src/routes/counts.ts`), which already excludes
`hideFromAll` feeds from the All-items `total` (SPEC-018). The list route
(`apps/api/src/routes/articles.ts`) filters unread via
`coalesce(article_states.read, false) = false`. Per-subscription options
(`viewMode`, `articleView`, `hideFromAll`) live on `subscriptions`, are
edited in `FeedSettingsDialog.tsx`, and flow through
`updateSubscriptionSchema` -> `PATCH /api/feeds/:id`.

This spec adds a per-subscription **attention tier** with query-time
semantics only: no background jobs, no mass writes of state rows.

## Goal

Each subscription is `firehose`, `normal`, or `precious`. Firehose feeds
stop generating unread pressure (no badges, no contribution to totals, and
their unread items quietly expire after two weeks). Precious feeds become
unmissable: a dedicated sidebar node and an accent treatment. Nothing about
`normal` feeds changes.

## Non-goals

- Writing `article_states` rows to expire firehose items. Expiry is a
  predicate, not a mutation: cheap, reversible, and retroactive by
  definition.
- Per-feed expiry windows or a user-tunable window (constant 14 days for
  now; see Open questions).
- Auto-classification (posting-frequency heuristics suggesting tiers).
  Good future polish, out of scope.
- Changing what appears in the All-items **list**. Tiers shape counts,
  badges, and expiry; `hideFromAll` (SPEC-018) already exists for removing
  a feed's items from the firehose list and composes freely with tiers.
- Digest/rollup rendering of firehose feeds in the list (open question).

## Data model changes

One column on `subscriptions` (`apps/api/src/db/schema.ts`), after
`hideFromAll`:

```ts
// Attention tier (SPEC-022): 'firehose' | 'normal' | 'precious'.
// Free-form text by the SPEC-011 convention; vocabulary in @rss/shared.
attention: text().notNull().default('normal'),
```

Migration: one additive `ALTER TABLE`; `pnpm db:generate`, inspect, commit.

In `packages/shared/src/types.ts`:

```ts
/** Per-subscription attention contract (SPEC-022). */
export const ATTENTION_TIERS = ['firehose', 'normal', 'precious'] as const;
export type AttentionTier = (typeof ATTENTION_TIERS)[number];
```

Server-side constant (exported from `lib/unread-counts.ts` so both call
sites share it): `FIREHOSE_EXPIRY_DAYS = 14`.

## API changes

### Schemas

- `updateSubscriptionSchema` (`schemas/feed.ts`):
  `attention: z.enum(ATTENTION_TIERS).optional()`.
- `articleQuerySchema` (`schemas/article.ts`):
  `attention: z.enum(ATTENTION_TIERS).optional()` - scopes the list to
  subscriptions of that tier (powers the Precious node).

### `PATCH /api/feeds/:id` and `GET /api/feeds` (`routes/feeds.ts`)

Copy `input.attention` into `changes` like `hideFromAll`; add
`attention: subscriptions.attention` to the `GET /feeds` and
`subscriptionRow()` selects. `SubscriptionRow` on the client
(`apps/web/src/lib/folders.ts`) gains `attention: AttentionTier`.

### Unread counts (`lib/unread-counts.ts`)

Two changes to the grouped query:

```sql
select s.feed_id as "feedId",
       s.attention,
       count(a.id) filter (
         where coalesce(st.read, false) = false
           and not (
             s.attention = 'firehose'
             and coalesce(a.published_at, a.fetched_at)
                 < now() - make_interval(days => ${FIREHOSE_EXPIRY_DAYS})
           )
       )::int as "unreadCount"
from subscriptions s
join articles a on a.feed_id = s.feed_id
left join article_states st
  on st.article_id = a.id and st.user_id = s.user_id
where s.user_id = ${userId}::uuid
group by s.feed_id, s.attention
```

Return type becomes
`{ feedId: string; attention: string; unreadCount: number }[]`. The callers
in `routes/feeds.ts` ignore `attention` (they key by feedId); update the
merge sites mechanically.

### Counts rollup (`routes/counts.ts`)

`GET /api/counts` already fetches `subscriptions` for the
folder/hidden-feed maps; select `attention` too and treat
`attention = 'firehose'` like `hideFromAll` **for the rollups only**:
firehose feeds contribute to neither `total` nor their folder's badge. Their
per-feed `unreadCount` (already expiry-adjusted by the query above) is still
returned so the feed's own header shows an honest number when opened.

### List route (`routes/articles.ts`)

Two additions to `GET /api/articles`:

1. **Tier scope.** When `query.attention` is present, push
   `eq(subscriptions.attention, query.attention)` into `subFilters` (the
   subscription-resolution query at the top of the handler), and include
   `!query.attention` in the `isAllItems` conjunction so tier scopes see
   hidden feeds, matching starred/search behavior (SPEC-018).
2. **Firehose expiry under the unread filter.** When
   `query.unread === true`, expired firehose items must not appear. Resolve
   the caller's firehose feed ids in the same subscription query
   (`select feedId, attention`), and when any exist add:

   ```ts
   const fhArray = `{${firehoseFeedIds.join(',')}}`; // db-sourced uuids
   filters.push(sql`not (
     ${articles.feedId} = any(${fhArray}::uuid[])
     and coalesce(${articles.publishedAt}, ${articles.fetchedAt})
         < now() - make_interval(days => ${FIREHOSE_EXPIRY_DAYS})
   )`);
   ```

   (Same array-literal binding trick as the mark-read route.) The plain
   list (`unread` unset) still shows old firehose items: expiry means "no
   longer owed", not "erased". They render as read (see next line).
3. **Read presentation of expired items.** So rows agree with counts, the
   list select's `read` field becomes, for firehose feeds only,
   `read OR expired`:

   ```ts
   read: sql<boolean>`coalesce(${articleStates.read}, false)
     or (${articles.feedId} = any(${fhArray}::uuid[])
         and coalesce(${articles.publishedAt}, ${articles.fetchedAt})
             < now() - make_interval(days => ${FIREHOSE_EXPIRY_DAYS}))`,
   ```

   Apply the same expression in `loadArticleDetail` is NOT needed: opening
   an article marks it read anyway (`ReadingPane`'s mark-on-open), and the
   detail pane does not render a read badge.

`POST /api/articles/mark-read` and `markReadOnScroll` are untouched: they
write real state rows and compose fine with the predicate.

## Web / UI changes

### Feed settings dialog

`FeedSettingsDialog.tsx` gains an "Attention" three-way segmented control
(reuse the `Segmented` pattern from `SettingsPage.tsx` or a matching
`<select>` beside List view / Opens in), saved through
`useUpdateSubscription` with the other fields. Helper copy, one line per
tier:

- Firehose: "No unread pressure. Items quietly expire after 14 days."
- Normal: "Counts and badges as usual."
- Precious: "Never miss a post. Highlighted and pinned to the Precious
  shelf."

### Sidebar (`ReaderPage.tsx` + `folder-tree.tsx`)

- **Precious node.** In `sidebarInner`, under "Starred" (and SPEC-019's
  nodes if present): a "Precious" entry (icon `Gem`), rendered only when
  the user has at least one precious subscription (derivable from
  `useSubscriptions()`), selecting
  `filters = { attention: 'precious', sort: 'newest' }` (add
  `attention?: AttentionTier` to `ArticleFilters` and `buildQuery` in
  `use-articles.ts`). Badge: sum of `countByFeed` over precious feed ids,
  computed client-side, styled with the accent color rather than the muted
  badge.
- **Tree styling.** `FeedNode` (`folder-tree.tsx`) receives the
  subscription's tier (it already gets feed metadata): firehose feeds
  render **no count badge at all** (even when `countByFeed` has a number)
  and slightly muted (`text-muted-foreground`); precious feeds get a small
  accent dot before the title and their badge in the accent color. The
  `hideRead` behavior (unread-only toggle) treats a firehose feed as
  read-empty when its expiry-adjusted count is zero, which falls out of the
  server-side count automatically.

### Top bar

No change: the scope unread count reads from the same `counts` data, which
is already expiry-adjusted per feed and tier-adjusted in `total`.

## Implementation notes

Order: schema + shared consts -> unread-counts SQL (+ its callers) ->
counts rollup -> list-route predicate + tier scope -> feeds routes/schema
plumbing -> dialog control -> sidebar node + tree styling.

- Keep `FIREHOSE_EXPIRY_DAYS` in exactly one exported const; the three SQL
  sites must all interpolate it as a bound parameter.
- The expiry predicate uses `coalesce(published_at, fetched_at)`, the same
  effective date as the sort key, so an undated article expires 14 days
  after fetch, deterministically.
- Optimistic count adjustments in `apps/web/src/lib/articles.ts`
  (`adjustCounts`) operate on whatever the server returned; marking an
  unexpired firehose article read still decrements its per-feed count.
  `adjustCounts` also patches `total`; teach it the set of firehose (and
  existing hidden) feed ids from the feeds cache so a firehose read does
  not decrement `total` (it never contributed). `folderForFeed` already
  handles the folder map; extend the same lookup.
- Precious styling should come from existing tokens (`--accent`,
  `--muted-foreground`); no new tokens.

## Acceptance criteria

- [ ] `subscriptions.attention` exists via a committed migration, defaults
      to `normal`, and round-trips through `PATCH /api/feeds/:id` and
      `GET /api/feeds`.
- [ ] For a firehose subscription: items older than 14 days are absent
      from `?unread=true` lists, counted as read in per-feed counts,
      render with `read: true` in plain lists, and never appear in
      `total`/folder rollups (regardless of age).
- [ ] Items younger than 14 days on a firehose feed behave normally except
      for badge suppression and rollup exclusion.
- [ ] Marking an expired firehose item explicitly unread makes it appear
      in unread lists again only if it is younger than the window;
      otherwise the predicate keeps it expired (document this in the
      dialog copy test... it is the intended contract: firehose items
      cannot be resurrected past the window).
- [ ] `?attention=precious` lists exactly the precious feeds' articles and
      composes with `unread`/`q`; hidden-from-all precious feeds still
      appear in it.
- [ ] The Precious node appears only when a precious subscription exists;
      its badge equals the sum of its feeds' counts.
- [ ] Firehose feeds show no badge in the tree; the unread-only sidebar
      toggle hides a firehose feed whose adjusted count is zero.
- [ ] `total` and folder badges never include firehose feeds; the All
      items badge, folder badges, and per-feed numbers remain mutually
      consistent after reads (optimistic and refetched).
- [ ] A `normal` subscription's behavior is byte-identical to today.

## Testing

- **Unit.** The three SQL predicates (counts filter, unread-list exclusion,
  read-presentation override) via query-building assertions; `adjustCounts`
  with firehose/hidden feed sets (read on firehose leaves `total` alone).
- **Integration (SPEC-015 harness).** Seed one feed per tier with articles
  at 1, 10, and 20 days old across read/unread states: assert list
  contents under `unread=true`/unset, per-feed counts, folder and total
  rollups, `attention=precious` scoping, and the PATCH round-trip.
  Regression: a user with only `normal` subscriptions gets identical
  responses before/after the migration (snapshot a counts + list pair).
- **Manual.** Subscribe to a busy feed, set firehose, watch the badge
  vanish and All-items total drop; set a quiet feed precious and check the
  node, dot, and accent badge in comfortable and compact density, light
  and dark themes.

## Open questions

- Per-user (or per-subscription) expiry window: worth it once someone asks;
  the predicate already takes the constant as a parameter, so the change is
  a `user_settings` column away (SPEC-011 pattern).
- A digest presentation for firehose feeds in All items ("34 items from
  The Verge" as one collapsible row) is the natural follow-up spec.
- Should precious feeds trigger a PWA notification on new items? Pairs
  well with SPEC-021's realtime delivery; separate spec if wanted.
