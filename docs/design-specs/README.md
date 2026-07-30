# Design specs

This folder breaks the Reader roadmap into **discrete, self-contained units of
work**. Each spec is sized to be picked up and completed in a single focused
session without needing to hold the whole codebase in context at once.

## How to use these with Claude

1. Pick the next spec whose dependencies are all done (see the table below).
2. Start a session with something like: _"Implement docs/design-specs/001-html-sanitization.md."_
3. Claude reads that one spec, the files it names, and the repo conventions in
   `CLAUDE.md`, then implements it against the acceptance criteria.
4. When the acceptance criteria and tests pass, mark the spec **Done** here and
   move to the next.

Each spec is written so it can be done on a discrete area of the code with
minimal overlap, so several can be tackled in sequence (or by different people)
without stepping on each other.

## Conventions

- Every spec follows `TEMPLATE.md`.
- Specs state their **dependencies** explicitly. Do not start one until its
  dependencies are Done.
- Specs are numbered by rough sequence, not hard ordering. Where two specs are
  independent, the number is just a label.
- A spec owns its data-model, API, and UI changes end to end, including tests.

## Status

Legend: **Todo** / **In progress** / **Done**

### Phase 1 - Reading core (turn the scaffold into a usable reader)

| #   | Spec                                             | Depends on | Status |
| --- | ------------------------------------------------ | ---------- | ------ |
| 001 | HTML sanitization pipeline                       | -          | Done   |
| 002 | Feed metadata, favicons, and discovery on subscribe | -       | Done   |
| 003 | Article list: keyset pagination + infinite scroll | -         | Done   |
| 004 | Article reading pane + article view modes        | 001, 003   | Done   |
| 005 | Read / unread / star state + mark-all-read       | 003        | Done   |

### Foundational (recommended next, before Phase 2 features)

| #   | Spec                                             | Depends on | Status |
| --- | ------------------------------------------------ | ---------- | ------ |
| 015 | Test infrastructure (API integration harness)    | 001-005    | Done   |

### Phase 2 - Organization and power features

| #   | Spec                                             | Depends on | Status |
| --- | ------------------------------------------------ | ---------- | ------ |
| 006 | Full-text search (Postgres tsvector)             | 003        | Done   |
| 007 | Folders and subscription management UI           | 002        | Done   |
| 008 | Keyboard navigation and shortcuts                | 004, 005   | Done   |
| 009 | OPML import / export                             | 002, 007   | Done   |
| 010 | Reading list views (cards / list / magazine / compact) | 003  | Done   |

### Phase 3 - Platform and polish

| #   | Spec                                             | Depends on | Status |
| --- | ------------------------------------------------ | ---------- | ------ |
| 011 | User settings and preferences (server-persisted) | 010        | Done   |
| 012 | Admin and multi-user management                  | -          | Done   |
| 013 | PWA, offline, and mobile polish                  | 004, 005   | Done   |

### Design pass (cross-cutting)

Split in two: 014 is the structural rework, 016 the visual identity.

| #   | Spec                                             | Depends on          | Status      |
| --- | ------------------------------------------------ | ------------------- | ----------- |
| 014 | Layout chrome and view-driven screens            | 003, 004, 008, 010  | Done        |
| 016 | Visual identity (palette, type, personality)     | 014                 | Done        |

### Phase 4 - The open web (sharing, realtime, resilience)

The reading core is done; this phase makes the reader a good citizen of the
open web. 019 comes first (it creates the `profiles` table, the public route
scope, and the HTML helpers that 020 reuses); the rest are independent of
each other unless noted.

| #   | Spec                                              | Depends on            | Status |
| --- | ------------------------------------------------- | --------------------- | ------ |
| 019 | Sharing, shared items, and the public linkblog    | 005, 011, 017         | Done   |
| 020 | Public blogroll (HTML + OPML)                     | 019, 009              | Todo   |
| 021 | WebSub realtime delivery (subscriber side)        | 002                   | Todo   |
| 022 | Attention tiers (firehose / normal / precious)    | 005, 007, 018         | Todo   |
| 023 | Subscribe to social-web profiles                  | 002                   | Todo   |
| 024 | Link-rot armor (archives, retention, Wayback)     | 004, 005              | Todo   |
| 025 | Saved searches (virtual feeds) + filter rules     | 006, 015              | Todo   |

## Scope summary

- **001 HTML sanitization** - Sanitize feed content server-side before storage
  and render it safely in the client. Security-critical; unblocks the reading pane.
- **002 Feed metadata + favicons + discovery** - On subscribe, resolve a site URL
  to its feed, fetch title/description/favicon, and store them.
- **003 Article list pagination** - Replace the stubbed list with keyset
  pagination and infinite scroll, plus the unread/starred/feed/folder filters.
- **004 Reading pane + views** - The right-hand reading experience with
  simplified (readability), readable, and full-web article views.
- **005 Read/star state** - Optimistic read/unread and star toggles, auto
  mark-read-on-open, and bulk mark-all-read.
- **006 Full-text search** - A Postgres `tsvector` column + trigger and a search
  query across title and content.
- **007 Folders and subscriptions UI** - Create/rename/reorder folders, move
  subscriptions, unsubscribe, drag-and-drop.
- **008 Keyboard navigation** - j/k, open, mark read, star, next/prev feed, a
  shortcuts overlay.
- **009 OPML import/export** - Import an OPML file into folders + subscriptions
  and export the current set.
- **010 Reading list views** - Cards, list, magazine, and compact renderings of
  the article list, selectable per user.
- **011 User settings** - Server-persisted preferences (theme, default views,
  per-feed overrides) replacing localStorage-only settings.
- **012 Admin and multi-user** - Invites or open registration toggle, roles,
  first-run admin flow, user management.
- **013 PWA and mobile** - Installable PWA, offline caching of read articles,
  and mobile navigation polish.
- **015 Test infrastructure** - An ephemeral-Postgres integration harness
  (Testcontainers) so API routes are tested against a real database via
  `app.inject`, plus backfilled integration tests covering every Phase 1 route.
  Closes the gap where DB-layer behavior was only verified by hand. A web /
  frontend test harness is a deferred follow-up.
- **014 Layout chrome and view-driven screens** - The view mode drives the whole
  screen, not just the middle column: a permanent top bar (sidebar toggle, scope
  title + unread count, search, mark-all-read, view switcher), a
  **fully-collapsing left sidebar**, list/compact keeping list-beside-reader, and
  cards/magazine taking over the content area as a browse surface that swaps in
  place to the article with a back control. Includes the square card's
  hover reveal (image slides out, text rises, excerpt fades in, card size fixed).
- **016 Visual identity** - Palette, typography, depth and personality beyond the
  current neutral shadcn theme (landed as the eight named themes + serif
  reading face).
- **019 Sharing, shared items, and the public linkblog** - A share button
  (OS share sheet / copy link), Google-Reader-style shared items with notes,
  an opt-in server-rendered public page per user at `/u/<slug>` that is also
  an Atom + JSON feed, and an instance-local Community view with
  subscribe-from-share.
- **020 Public blogroll** - An opt-in public "who I read" page grouped by
  folder, with per-subscription exclusion and an OPML twin
  (`/u/<slug>/blogroll.opml`) plus `rel="blogroll"` autodiscovery.
- **021 WebSub realtime delivery** - Subscriber-side W3C WebSub: hub
  discovery from Link headers / atom:link, signed content pushes to a
  callback endpoint, lease renewal in the worker, and a 6-hour polling floor
  for push-active feeds. Feeds without a hub are unaffected.
- **022 Attention tiers** - Per-subscription firehose / normal / precious
  contract: firehoses stop generating unread pressure (no badges, quiet
  14-day expiry, all query-time), precious feeds get a dedicated sidebar
  node and accent treatment so they are never missable.
- **023 Social-web profiles** - Paste a Mastodon profile URL, a
  `@user@instance` handle, or a Bluesky profile and subscribe to it as the
  feed it already is; YouTube channels pinned by regression test.
- **024 Link-rot armor** - Starring captures a readable snapshot while the
  page is alive; admin-configurable retention that always spares
  starred/shared items and each feed's newest window; Wayback Machine
  links where readers actually need them.
- **025 Saved searches + filter rules** - Named scoped searches pinned to
  the sidebar as virtual feeds, and phrase-based ingestion rules
  (auto-mark-read / auto-star) with a bounded retroactive apply.
