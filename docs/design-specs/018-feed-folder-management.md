# SPEC-018: Feed and folder management

- **Status:** Done
- **Phase:** 3
- **Depends on:** SPEC-007 (folders/subscriptions), SPEC-011 (settings), SPEC-012 (admin settings)
- **Estimated size:** M–L

## Context

Feed and folder editing is partly built but undiscoverable, and partly missing.
`folder-tree.tsx` already supports rename (feed + folder), create folder
("＋ New folder"), delete, drag to move/reorder, and unsubscribe — but the
actions live in a hover-only ⋯ menu, so users report "no way to rename / create
folders." Genuinely absent: any control over poll frequency (each `feeds` row
has `fetchIntervalSec` default 900s, consumed by `worker/poll.ts`, but never
surfaced or editable, and there is no app-wide default knob), a per-feed article
open target, and a way to hide a noisy feed from the All-items firehose. Feeds
are stored once globally and deduplicated, so poll interval is a property of the
feed shared by all subscribers.

## Goal

A discoverable Feed Settings dialog (opened from a feed's ⋯ menu → Edit…) that
consolidates rename, folder, list-view override, a new per-feed article view
override, a hide-from-All-items toggle, and a per-feed poll interval with
last-fetched/last-error status. An app-wide default poll interval in admin
Settings. Folder creation stays where it is but reads as a first-class action.

## Non-goals

- Per-user poll intervals (feeds are global; interval is per-feed/global).
- Editing global feed metadata (title/site URL/favicon) — only the caller's
  subscription plus the shared interval.
- Bulk edit across many feeds; scheduling windows; conditional rules.
- Reworking the drag/drop tree (SPEC-007) beyond adding the Edit entry.

## Decisions taken

- **Open target** = a per-feed override of the default article view
  (Simplified / Readable / Web), read in the in-app pane; null inherits the
  user's `defaultArticleView`.
- **Poll frequency** = an app-wide default (admin Settings) plus an optional
  per-feed override (global to the feed); the dialog shows last-fetched and
  last-error.

## Data model changes

`apps/api/src/db/schema.ts`, then generate + commit the migration:

- `subscriptions.articleView text` (nullable) — per-feed article-view override
  (`simplified|readable|web`); null = inherit the user default.
- `subscriptions.hideFromAll boolean not null default false` — exclude from the
  All-items list and its unread total (still polled and reachable directly).
- `feeds.fetchIntervalSec` → **nullable** (null = inherit the app default). The
  migration nulls existing rows (all hold the never-user-set 900) so they follow
  the app default.
- `app_settings.defaultPollIntervalSec integer not null default 900`.

## API / shared changes

- `packages/shared`:
  - Extend `updateSubscriptionSchema` with `articleView: z.enum(ARTICLE_VIEWS).nullable().optional()`,
    `hideFromAll: z.boolean().optional()`, and `fetchIntervalSec: z.number().int().min(60).max(86400).nullable().optional()`
    (the last targets the shared feed, not the subscription).
  - Extend `updateAppSettingsSchema` + `AppSettingsDto` with
    `defaultPollIntervalSec` (int, 60–86400).
  - A `SubscriptionDto`/row shape gains `articleView`, `hideFromAll`,
    `fetchIntervalSec` (the feed's, nullable), and read-only status
    `lastFetchedAt`, `lastError`.
- `apps/api`:
  - `GET /feeds` and `PATCH /feeds/:id` select the new subscription columns plus
    the joined `feeds.fetchIntervalSec/lastFetchedAt/lastError`. `PATCH` applies
    subscription fields in the existing transaction and, when `fetchIntervalSec`
    is present, updates the shared `feeds` row (note: affects all subscribers).
  - `articles` list: when the scope is the All-items firehose (no feedId, no
    folderId, no starred, no q), add `hideFromAll = false`. Explicit scopes,
    starred, and search are unaffected.
  - `counts`: the `total` excludes `hideFromAll` feeds so the All-items badge
    matches the list; per-feed and per-folder counts are unchanged (a hidden
    feed still shows its own badge and counts inside its folder).
  - `worker/poll.ts`: due-feed test uses
    `coalesce(feeds.fetchIntervalSec, <app default>)`, the app default read from
    `getAppSettings().defaultPollIntervalSec`. The worker tick interval
    (`env.FEED_POLL_INTERVAL_SEC`) is unchanged.
  - Admin settings routes read/write `defaultPollIntervalSec`.

## Web / UI changes

- `lib/folders.ts` `SubscriptionRow` gains `articleView`, `hideFromAll`,
  `fetchIntervalSec`, `lastFetchedAt`, `lastError`; `useUpdateSubscription`
  accepts the new fields.
- `components/feed/FeedSettingsDialog.tsx`: name, folder select, list-view
  override, article-view override, hide-from-All toggle, poll interval (blank =
  “App default (N min)”), and a read-only status line (last fetched relative
  time; last error if any). One Save → one `PATCH /feeds/:id`.
- `folder-tree.tsx`: add **Edit…** to the feed ⋯ menu opening the dialog; keep
  inline Rename. Give the "＋ New folder" action a clearer affordance.
- `ReadingPane`: seed the initial article view from the subscription's
  `articleView` override (looked up by the article's feed id from the
  subscriptions cache) falling back to `settings.defaultArticleView`.
- Admin Settings: a Feeds section with the default poll interval (minutes).

## Implementation notes

- Order: schema + migration → shared schemas/DTOs → API (feeds, articles/counts,
  poll, admin) → web hooks → FeedSettingsDialog + tree entry → ReadingPane
  override → admin UI.
- `hideFromAll` only narrows the All-items scope; keep the change to a single
  guarded filter in the articles route and the counts total, with tests.
- The per-feed interval is global to the feed; the dialog copy must say so.
- Security: all feed/subscription routes stay `requireAuth` and scoped to the
  caller's subscription; the app default poll interval is admin-only.

## Acceptance criteria

- [ ] A feed's ⋯ menu has Edit… opening a dialog that renames, moves folder,
      sets list-view and article-view overrides, toggles hide-from-All, and sets
      a poll interval, saving in one request; inline Rename and New folder still
      work.
- [ ] Hiding a feed removes it (and its unread) from All items and the All-items
      badge, while the feed stays reachable directly with its own counts and
      keeps being polled.
- [ ] A per-feed article view override opens that feed's articles in the chosen
      view; feeds without an override use the user default.
- [ ] The feed dialog shows the effective poll interval (app default vs feed
      override) plus last-fetched and last-error.
- [ ] Admin Settings sets an app-wide default poll interval; feeds without an
      override honor it (verified against the poller's due-feed selection).

## Testing

- Unit (shared): updateSubscriptionSchema accepts/【rejects】the new fields;
  updateAppSettingsSchema bounds the interval.
- Integration (api): PATCH sets subscription fields + the shared feed interval;
  All-items list and counts total exclude a hidden feed while its own feed scope
  and per-feed count still include it; poll due-selection honors
  coalesce(feed override, app default); admin default interval round-trips.
- Web: FeedSettingsDialog saves the whole form; ReadingPane seeds from a feed's
  article-view override.
- Manual: rename via dialog; hide a feed and watch All items shrink; set a feed
  to open in Web; drop a feed's interval and confirm it polls sooner.
