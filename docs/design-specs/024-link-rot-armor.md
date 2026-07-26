# SPEC-024: Link-rot armor (starred archives, retention policy, Wayback fallback)

- **Status:** Todo
- **Phase:** 4
- **Depends on:** SPEC-004 (Done), SPEC-005 (Done); interacts with SPEC-019 (shared items) if landed
- **Estimated size:** M

## Context

The old web's tragedy is link rot: the average article you starred five
years ago is now a 404, a domain squat, or a redesign that ate the content.
A reader that respects the old web should treat "starred" as "keep this
safe".

What exists today:

- Articles already store sanitized feed content (`articles.contentHtml`) and
  a lazily-populated Readability snapshot
  (`articles.readableHtml` / `readableFetchedAt`), fetched on first view of
  the Simplified view by `GET /api/articles/:id/readable`
  (`apps/api/src/routes/articles.ts`) via `extractReadableHtml()`
  (`apps/api/src/lib/readability.ts`). Both are global, per the dedup rule.
- **Nothing is ever deleted**: there is no retention or pruning anywhere, so
  the articles table grows forever. That protects starred items by accident
  today, but it is not a policy, and busy feeds will eventually force one.
  The moment pruning exists, stars must be load-bearing.
- The reading pane (`ReadingPane.tsx`) has Simplified / Readable / Web views
  and an "Open original" link; when Simplified extraction fails it shows a
  `Note` ("could not extract") with a retry.

This spec turns the accident into a contract: starring an article
proactively captures its readable snapshot while the page is still alive,
retention (new, admin-configurable, off by default) explicitly spares
starred and shared items, and the UI grows a Wayback Machine escape hatch
for pages that have already died.

## Goal

Starred articles keep a readable copy forever, captured at star time, not at
whenever-the-page-dies time. Admins can cap article retention without
touching anything a user starred or shared. Every article offers a one-click
jump to its Wayback Machine copy.

## Non-goals

- Full-fidelity archiving (assets, images, PDFs, WARC). The sanitized
  Readability HTML is the archive; images keep pointing at their origin and
  may rot independently. Honest and cheap.
- Automatically submitting URLs to the Wayback Machine (SavePageNow). See
  Open questions; default-off etiquette matters.
- Archiving on read or on subscribe (only starring/sharing signals "keep").
- A browse-your-archive UI beyond the existing Starred node (the archive IS
  the starred list).
- Dead-link detection sweeps (checking all starred URLs on a schedule).

## Data model changes

### `app_settings` (`apps/api/src/db/schema.ts`)

```ts
// Article retention in days (SPEC-024). null = keep forever (default).
// Starred/shared items and each feed's newest items are always exempt.
articleRetentionDays: integer(),
```

No new tables: the "archive" is the existing `articles.readableHtml`
(global, shared across users), guaranteed present for starred items by the
capture hook below. Migration: one additive column.

## API changes

### Shared schemas (`packages/shared/src/schemas/admin.ts`)

`updateAppSettingsSchema` gains

```ts
articleRetentionDays: z.number().int().min(30).max(3650).nullable().optional(),
```

(30-day floor: see pruning guard below), and the `.refine` allowing "at
least one field" adds it to the condition. `AppSettingsDto` (`types.ts`)
gains `articleRetentionDays: number | null`, and
`GET/PATCH /api/admin/settings` (`routes/admin.ts`) read/write it
mechanically alongside `defaultPollIntervalSec`.

### Snapshot capture on star (`routes/articles.ts`)

In `PATCH /api/articles/:id/state`, after the upsert succeeds, when
`input.starred === true` (or, once SPEC-019 lands, `input.shared === true`):
fire and forget

```ts
void ensureReadableSnapshot(id).catch((err) =>
  request.log.warn({ err, articleId: id }, 'snapshot capture failed'),
);
```

`ensureReadableSnapshot(articleId)` is a new export in
`apps/api/src/lib/readability.ts`:

- Load `url`, `readableFetchedAt` for the article; return immediately when
  `readableFetchedAt` is already set (an attempt exists, successful or not)
  or `url` is null.
- Otherwise run the exact logic of the `/readable` route's miss path:
  `extractReadableHtml(url)` then update `readableHtml` +
  `readableFetchedAt`. Refactor the route to call this same helper so the
  two paths cannot drift (the route keeps its `?refresh=true` behavior by
  bypassing the `readableFetchedAt` short-circuit).

The response to the PATCH does not wait on the capture (extraction can take
up to 15 seconds); the star round-trip stays instant. A failed capture
leaves `readableFetchedAt` stamped, which is today's semantics for "tried;
show the fallback note".

### Pruning (worker)

New `apps/api/src/worker/prune.ts`, called from the worker `tick()` in
`apps/api/src/worker/index.ts` at most once per 24h (module-level
`lastPruneAt` timestamp; a worker restart just prunes once on the next
tick, which is idempotent and cheap):

```ts
export async function pruneOldArticles(): Promise<number>
```

Reads `getAppSettings()`; returns 0 when `articleRetentionDays` is null.
Otherwise one set-based delete:

```sql
delete from articles a
where coalesce(a.published_at, a.fetched_at)
        < now() - make_interval(days => ${articleRetentionDays})
  -- never delete anything anyone starred or shared
  and not exists (
    select 1 from article_states st
    where st.article_id = a.id
      and (st.starred or st.shared)   -- st.shared only once SPEC-019 landed
  )
  -- never delete a feed's newest items, however old: a sparse feed's
  -- whole window must survive, and anything still present in the feed
  -- XML would otherwise be re-ingested as brand-new (and unread) on the
  -- next poll
  and a.id not in (
    select id from (
      select id, row_number() over (
        partition by feed_id
        order by coalesce(published_at, fetched_at) desc, id desc
      ) rn from articles
    ) ranked where rn <= 100
  )
```

Log the deleted count. `article_states` rows cascade
(`onDelete: 'cascade'`). The keep-newest-100 guard is the important subtle
bit: without it, a low-volume blog whose feed still lists a 2019 post would
have that post deleted and then re-imported unread on every poll cycle
forever.

### Detail payload

No change: `readableHtml` already rides `GET /api/articles/:id`.

## Web / UI changes

### Wayback links (`ReadingPane.tsx`)

- In the header metadata row, next to "Open original": a small
  `Landmark`-icon (or `Archive`-icon) link, hover text "Find on the
  Wayback Machine", pointing at
  `https://web.archive.org/web/${article.url}` (the `/web/<url>` form
  redirects to the newest snapshot). Rendered only when `article.url` is
  set. `target="_blank" rel="noreferrer"`.
- In the Simplified view's failure `Note` ("could not extract a readable
  version") and in the Readable view's empty state, append the same link
  as a sentence: "The original may have moved or died. Try the Wayback
  Machine." This is the moment users actually need it.

### Admin page (`AdminPage.tsx`)

In the instance-settings section (alongside the default poll interval,
via the existing `useAdminSettings` / `useUpdateAdminSettings` hooks): a
"Keep articles for" number input in days with a blank state meaning
forever, helper text "Starred and shared articles, and each feed's newest
100 items, are always kept." Client-side min 30 mirrors the schema.

### Starred affordance copy

`FeedSettingsDialog` and settings need no change; but the star button's
hover text in `ReadingPane.tsx` becomes "Star (keeps a readable copy)" so
the contract is discoverable.

## Implementation notes

Order: `ensureReadableSnapshot` refactor + capture hook -> Wayback links
(shippable on their own) -> retention schema/admin plumbing -> prune job.

- The capture hook makes a third-party HTTP fetch as a side effect of a
  user action; it reuses `extractReadableHtml`'s existing timeout (15s),
  UA, and SSRF scheme guard. Concurrency is naturally bounded by how fast
  a human can star.
- Do not capture on unstar->restar churn: the `readableFetchedAt`
  short-circuit already makes repeat stars free.
- Prune runs inside the worker process only (never the API), keeping the
  API's latency profile clean.
- `EXPLAIN` the delete on a large seeded table; the ranked-subquery guard
  wants `articles_sort_key_idx` (already exists) and stays acceptable at
  self-hosted scale run once daily. If it ever hurts, batch by feed.
- The 30-day schema floor plus the newest-100 guard together make
  "retention resurrects unread articles" practically impossible; state
  the invariant in a code comment on the delete.

## Acceptance criteria

- [ ] Starring an article whose `readableFetchedAt` is null triggers
      exactly one background extraction and persists the snapshot; the
      PATCH response does not wait for it; starring again does not
      re-fetch.
- [ ] `GET /api/articles/:id/readable?refresh=true` still forces
      re-extraction (helper refactor did not regress the route).
- [ ] With retention null, the prune job deletes nothing and logs nothing
      nightly.
- [ ] With retention set, articles older than the window are deleted
      except (a) starred by anyone, (b) shared by anyone (when SPEC-019 is
      present), and (c) each feed's newest 100; the prune runs at most
      once per 24h per worker process.
- [ ] A pruned article's state rows disappear with it (cascade), and
      re-polling the feed does not resurrect pruned articles (guard
      verified with a sparse-feed fixture whose XML still lists old
      items).
- [ ] `articleRetentionDays` round-trips through the admin API with the
      30-3650 bounds and null semantics, and the admin UI edits it.
- [ ] The Wayback link appears in the header for any article with a URL,
      and in the Simplified-failure and Readable-empty states; absent when
      `url` is null.
- [ ] Starred items from a feed whose site is down still render their
      Simplified view from the stored snapshot (that is the whole point).

## Testing

- **Unit.** `ensureReadableSnapshot` short-circuits (fetchedAt set, null
  url) and update path with a mocked `extractReadableHtml`; prune SQL
  guards via query-building assertions.
- **Integration (SPEC-015 harness).** Star -> snapshot persisted (mock the
  network fetch); prune matrix: old+unstarred deleted, old+starred kept,
  old+shared kept, newest-100 kept for a sparse feed, retention null
  no-op; admin settings round-trip and validation bounds; cascade of
  state rows.
- **Manual.** Star an article, kill your network, open Simplified: the
  copy renders. Click the Wayback link on something old. Set retention to
  30 on a dev database and watch the log line.

## Open questions

- Opt-in SavePageNow ("also ask the Internet Archive to save pages I
  star"): one POST per star to `https://web.archive.org/save/<url>`,
  default off, clearly labeled since it sends your starred URLs to a
  third party. Worth a tiny follow-up spec; deliberately excluded here.
- Should retention also vacuum `readableHtml` for old unstarred articles
  (content bloat without deleting rows)? Only matters at scale; revisit
  with real numbers.
