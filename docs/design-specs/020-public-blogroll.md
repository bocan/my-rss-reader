# SPEC-020: Public blogroll (HTML + OPML)

- **Status:** Todo
- **Phase:** 4
- **Depends on:** SPEC-019 (profiles table, public route scope, HTML layout helpers), SPEC-009 (Done)
- **Estimated size:** M

## Context

Blogrolls are having a genuine comeback: a public "here is who I read" page
is the old web's discovery mechanism, and OPML makes it machine-readable so
someone can import your whole list into their own reader in one click. The
data is already all here: `subscriptions` + `folders` + `feeds`
(`apps/api/src/db/schema.ts`), and `GET /api/opml/export`
(`apps/api/src/routes/opml.ts`) already walks folders/subscriptions into an
OPML 2.0 document via `buildOpml()` in `apps/api/src/lib/opml.ts`.

SPEC-019 creates the `profiles` table (slug, visibility) and the
server-rendered public route family at the root scope (`routes/public.ts`,
`lib/public-html.ts` with `layout()` and `esc()`). This spec adds a second
public surface on the same profile: `/u/<slug>/blogroll` (HTML) and
`/u/<slug>/blogroll.opml` (OPML), plus the per-subscription and per-profile
controls to curate it.

Privacy defaults matter here: following a feed is not consent to publish
that fact. The blogroll is off until explicitly enabled, and individual
subscriptions can be excluded once it is on.

## Goal

A user flips on "Public blogroll" in Settings, optionally excludes a few
feeds, and gets a clean public page of everything they read, grouped by
folder, with a standards-compliant OPML twin that other readers can import.
The share page and blogroll link to each other.

## Non-goals

- Following/importing someone else's blogroll from inside the app beyond
  what OPML import (SPEC-009) already does.
- Per-folder include/exclude (per-subscription is enough; excluding a whole
  folder is a few clicks).
- Descriptions or commentary per blogroll entry (the OPML `text` attribute
  carries the title only). A curated "with notes" blogroll is a different,
  bigger feature.
- Any change to the authenticated OPML export; it keeps exporting
  everything.

## Data model changes

### 1. `profiles` (SPEC-019 table): one column

```ts
// Public blogroll toggle (SPEC-020). Independent of shares visibility: a
// user may publish a blogroll without a shared-items page and vice versa.
blogrollEnabled: boolean().notNull().default(false),
```

Note: the blogroll is public when `blogrollEnabled` is true regardless of
`visibility` (which governs shared items only). The slug is shared by both
surfaces.

### 2. `subscriptions`: one column

```ts
// Include this subscription in the owner's public blogroll (SPEC-020).
// Only meaningful once profiles.blogrollEnabled is on.
inBlogroll: boolean().notNull().default(true),
```

Default true so enabling the blogroll shows your real list, with opt-outs,
rather than requiring per-feed opt-in busywork. The feature as a whole is
opt-in, so nothing leaks before the explicit enable.

Migration: additive `ALTER TABLE`s via `pnpm db:generate`, inspect, commit.

## API changes

### Shared schemas (`packages/shared`)

- `updateProfileSchema` (from SPEC-019) gains
  `blogrollEnabled: z.boolean().optional()`; `profileSchema` gains
  `blogrollEnabled: z.boolean()` and
  `blogrollUrl: z.string().nullable()` (absolute, when enabled).
- `updateSubscriptionSchema` (`schemas/feed.ts`) gains
  `inBlogroll: z.boolean().optional()`.

### Subscription plumbing (`routes/feeds.ts`)

- `GET /api/feeds` and `subscriptionRow()` add `inBlogroll:
  subscriptions.inBlogroll` to their selects.
- `PATCH /api/feeds/:id` copies `input.inBlogroll` into `changes` alongside
  `hideFromAll`.

### Tree builder refactor (`routes/opml.ts` -> `lib/opml-tree.ts`)

Extract the tree-building half of the `GET /opml/export` handler (the
`folderRows` / `subRows` queries plus `feedsFor` / `buildFolder`) into a
shared helper so the blogroll cannot drift from the real exporter:

```ts
// apps/api/src/lib/opml-tree.ts
export async function buildUserFeedTree(
  userId: string,
  opts: { blogrollOnly?: boolean } = {},
): Promise<{ folders: OpmlFolderNode[]; feeds: OpmlFeedNode[] }>
```

`blogrollOnly: true` adds `eq(subscriptions.inBlogroll, true)` to the
subscription query and **prunes folders left with no feeds and no non-empty
child folders** (an empty folder name is still information about the user;
do not publish it). `GET /api/opml/export` switches to
`buildUserFeedTree(userId)` with behavior byte-identical to today (covered
by the existing `opml.int.test.ts`).

### Public routes (`routes/public.ts`, extending SPEC-019's module)

Both 404 unless the slug resolves to a profile with
`blogrollEnabled = true`. Both send `cache-control: public, max-age=300`.

1. **`GET /u/:slug/blogroll`** - server-rendered HTML via `layout()`:
   - `<h1>`: "<profile title or displayName>'s blogroll", a line of intro
     text if `bio` is set, and a link back to `/u/<slug>` when shares are
     public (and vice versa: SPEC-019's page links here when
     `blogrollEnabled`).
   - Grouped by top-level folder (nested folders render as subgroups, one
     level deep, matching the folder model), unfoldered feeds last under no
     heading. Each entry: feed title linking to `siteUrl` (fall back to
     `feedUrl`), and a small monospace "feed" link to `feedUrl` itself.
     Favicons via `<img loading="lazy" referrerpolicy="no-referrer">` when
     `faviconUrl` is set; they are the one external fetch on the page and
     degrade to nothing.
   - `<head>` carries OPML autodiscovery:
     `<link rel="blogroll" type="text/x-opml" href="/u/<slug>/blogroll.opml">`
     (the emerging convention used by the blogroll network tools), plus a
     visible "Download OPML" link in the page body.
2. **`GET /u/:slug/blogroll.opml`** -
   `buildOpml(await buildUserFeedTree(userId, { blogrollOnly: true }),
   '<name>'s blogroll')` with
   `content-type: text/x-opml; charset=utf-8` and an inline (not attachment)
   disposition so browsers render it and readers fetch it.

Folder names appear on both surfaces; the Settings copy must say so (see
UI). Custom titles (`subscriptions.customTitle`) are used as the display
title exactly as the authenticated export does.

## Web / UI changes

- **Settings "Sharing" card** (SPEC-019, `SettingsPage.tsx`): add a
  "Public blogroll" `Toggle` with the copy "Publishes the feeds you follow
  (and your folder names) at <url>. You can exclude individual feeds from
  each feed's settings." When enabled, show the URL with the copy/open
  affordances used for the share page.
- **`FeedSettingsDialog.tsx`**: a new "Include in public blogroll" checkbox
  next to "Hide from All Items", bound through `useUpdateSubscription`
  (`inBlogroll`), rendered only when the caller's profile has
  `blogrollEnabled` (read via SPEC-019's `GET /api/profile` query) so the
  dialog stays uncluttered for everyone else. `SubscriptionRow` in
  `apps/web/src/lib/folders.ts` gains `inBlogroll: boolean`.

## Implementation notes

Order: schema -> `buildUserFeedTree` refactor (run the existing OPML
integration tests before continuing) -> public routes -> settings toggle ->
dialog checkbox.

- Escaping: folder names, titles, and URLs all pass through `esc()` on the
  HTML page; `buildOpml` already escapes attributes via `fast-xml-parser`.
- Keep `buildUserFeedTree` free of Fastify types; it is a lib function.
- The blogroll page must not reveal counts, read state, poll intervals, or
  `lastError`; it renders only title/siteUrl/feedUrl/favicon and folder
  names.

## Acceptance criteria

- [ ] `profiles.blogrollEnabled` and `subscriptions.inBlogroll` exist via a
      committed migration; no drift on regenerate.
- [ ] `GET /api/opml/export` output is unchanged for a user with mixed
      folders/feeds (existing integration tests still green after the
      refactor).
- [ ] `/u/<slug>/blogroll` and `.opml` 404 while `blogrollEnabled` is false
      or the slug is unknown; both render once enabled.
- [ ] Excluding a subscription removes it from both surfaces; a folder
      whose every feed is excluded disappears entirely from both.
- [ ] The OPML twin imports cleanly into this reader itself (round-trip via
      `POST /api/opml/import` on a second account) and validates as OPML
      2.0.
- [ ] The HTML page carries the `rel="blogroll"` autodiscovery link and no
      private metadata; hostile feed titles render inert.
- [ ] The blogroll checkbox appears in feed settings only when the blogroll
      is enabled, and PATCHes correctly.
- [ ] Share page and blogroll cross-link only when both are on.

## Testing

- **Unit.** `buildUserFeedTree` with `blogrollOnly`: exclusion filtering,
  empty-folder pruning (including a folder whose only child folder is
  empty), custom-title preference.
- **Integration.** Public route 404 matrix; OPML content-type and inline
  disposition; round-trip import on a second user; HTML escaping with a
  feed titled `<script>alert(1)</script>`; unchanged authenticated export.
- **Manual.** Enable, exclude one feed, view both pages, import the OPML
  into a fresh account, check favicons and dark mode.

## Open questions

- A `rel="me"`-style link field on the profile (personal site URL) would
  round the page out; trivially added to `profiles` later.
- Whether to also emit the blogroll as JSON (`/blogroll.json`) for the
  newer blogroll tooling; wait for a concrete consumer.
