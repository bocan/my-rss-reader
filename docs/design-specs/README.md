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
| 011 | User settings and preferences (server-persisted) | 010        | Todo   |
| 012 | Admin and multi-user management                  | -          | Todo   |
| 013 | PWA, offline, and mobile polish                  | 004, 005   | Todo   |

### Design pass (cross-cutting)

Split in two: 014 is the structural rework (spec'd, buildable now), 016 is the
visual identity, which still needs a direction conversation before it is written.

| #   | Spec                                             | Depends on          | Status      |
| --- | ------------------------------------------------ | ------------------- | ----------- |
| 014 | Layout chrome and view-driven screens            | 003, 004, 008, 010  | Done        |
| 016 | Visual identity (palette, type, personality)     | 014                 | Not specced |

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
  current neutral shadcn theme. Needs a direction conversation first; do not just
  tweak the primary hue.
