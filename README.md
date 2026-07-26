# Reader

A calm, self-hosted RSS reader for people who miss the old web.

There is no algorithm here. No ranking, no "For You", no engagement bait.
Just the sites you chose to follow, in the order they published, in a quiet
interface that gets out of your way. It runs as a single container next to a
Postgres database, and it is multi-user from the ground up, so your family,
your club, or your team can read on the same instance without stepping on
each other.

## Why you might like it

- **Reading first.** Three list layouts (cards, list, magazine), comfortable
  and compact densities, and three article views: a clean readability
  extraction, the feed's own content, or the full web page. Long-form text is
  set in a proper serif at a readable measure.
- **Your keyboard works.** `j`/`k` through articles, `s` to star, `a` to mark
  a view read, `/` to search, `?` for the full shortcut overlay. The mouse is
  optional.
- **Fast, honest search.** Postgres full-text search across everything you
  are subscribed to, with phrase and exclusion syntax, ranked sensibly.
- **It respects your attention.** Unread-only mode, mark-all-read that does
  what it says, per-feed controls (custom titles, poll intervals, hide from
  All Items), and folders that drag and drop.
- **It looks after itself.** Feeds are discovered from a plain site URL,
  favicons fetched, HTML sanitized server-side before it ever reaches your
  browser, and articles deduplicated globally no matter how many users
  subscribe.
- **It works offline.** Installable PWA with cached articles, so the train
  tunnel does not end your morning read.
- **It is yours.** OPML import and export (leave whenever you like), eight
  named themes from paper-warm to void-black, sessions in your own database,
  and not a single external service in the serving path.
- **Built to be read by screen readers too.** Live-region announcements,
  focus-managed dialogs, skip links, labeled controls.

The first account to register becomes the admin; after that, open
registration, invites, or closed, your call.

## Stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Language   | TypeScript everywhere                              |
| Web        | React 19 + Vite, React Router, TanStack Query      |
| Styling    | Tailwind CSS v4 + shadcn/ui (Radix)                |
| API        | Fastify 5                                          |
| Worker     | Node process polling feeds on an interval          |
| Database   | PostgreSQL via Drizzle ORM                         |
| Auth       | Self-rolled session cookies (argon2id hashing)     |
| Monorepo   | pnpm workspaces + Turborepo                        |

## Layout

```
apps/
  web/      React SPA (Vite)
  api/      Fastify API + feed-polling worker + Drizzle schema
packages/
  shared/   Zod schemas + types shared by web and api
docker/     Dockerfile + compose files
.github/    CI (lint/typecheck/test/build) + GHCR image publish
```

The API serves the built SPA from the same origin in production, so the whole
app is one container image (plus Postgres).

## Getting started (development)

Prerequisites: Node 22+, pnpm, Docker.

```bash
cp .env.example .env          # then edit SESSION_SECRET at minimum
pnpm install

# Start Postgres only; run the app on the host for hot reload.
pnpm docker:dev
pnpm db:generate              # generate the initial migration from the schema
pnpm db:migrate               # apply it

pnpm dev                      # web on :5173, api on :3000 (proxied)
```

Register the first account through the UI. The **first** user to register becomes
the admin.

To run the feed worker locally:

```bash
pnpm --filter @rss/api dev:worker
```

## Production (single stack)

```bash
cp .env.example .env          # set a strong SESSION_SECRET and DB password
docker compose -f docker/docker-compose.yml up -d --build
```

This starts Postgres, runs migrations once, then launches the API (serving the
SPA on `:3000`) and the feed worker.

## Useful scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Run web + api in watch mode                   |
| `pnpm build`        | Build all packages                            |
| `pnpm lint`         | ESLint across the workspace                   |
| `pnpm typecheck`    | `tsc --noEmit` across the workspace           |
| `pnpm test`         | Run tests (Vitest)                            |
| `pnpm db:generate`  | Generate Drizzle migrations from the schema   |
| `pnpm db:migrate`   | Apply migrations                              |
| `pnpm db:studio`    | Open Drizzle Studio                           |

## Data model

Feeds and articles are stored **once, globally**, and deduplicated by URL / guid.
Per-user data lives in `subscriptions` (which feeds a user follows) and
`article_states` (read / starred). This keeps storage flat as users grow and lets
the worker fetch each feed a single time regardless of how many people subscribe.

## What it does today

- [x] Feed discovery from a site URL + favicon fetching
- [x] OPML import / export
- [x] Reading views: cards, list, magazine (+ comfortable/compact density)
- [x] Article views: simplified (readability), readable, full web
- [x] Full-text search (Postgres `tsvector`)
- [x] Keyboard-driven navigation (j/k, mark read, star)
- [x] Mark-all-read, filters (unread / starred / by folder)
- [x] Keyset pagination + infinite scroll
- [x] HTML sanitization of article content
- [x] PWA / offline support
- [x] Per-user settings + themes
- [x] Admin, invites, and multi-user management

## What's coming: the open-web era

The next phase leans into what made the old web good. Each item is fully
specced in [`docs/design-specs`](docs/design-specs) and waiting to be built:

- [ ] **Sharing and shared items** ([SPEC-019](docs/design-specs/019-sharing-and-shared-items.md)):
      a proper share button, Google-Reader-style shared items with notes, and
      an opt-in public linkblog at `/u/you` that is itself an Atom + JSON
      feed others can subscribe to.
- [ ] **Public blogrolls** ([SPEC-020](docs/design-specs/020-public-blogroll.md)):
      a "who I read" page with an importable OPML twin.
- [ ] **Realtime delivery via WebSub** ([SPEC-021](docs/design-specs/021-websub-realtime.md)):
      new posts arrive in seconds when a feed offers a hub; polite polling
      otherwise.
- [ ] **Attention tiers** ([SPEC-022](docs/design-specs/022-attention-tiers.md)):
      mark a feed firehose (no unread guilt, ever) or precious (never miss a
      post).
- [ ] **Follow the new social web too** ([SPEC-023](docs/design-specs/023-social-web-profiles.md)):
      paste a Mastodon or Bluesky profile and it just subscribes; their pages
      were feeds all along.
- [ ] **Link-rot armor** ([SPEC-024](docs/design-specs/024-link-rot-armor.md)):
      starring keeps a readable copy forever, with a Wayback Machine escape
      hatch for pages that already died.
- [ ] **Saved searches and rules** ([SPEC-025](docs/design-specs/025-saved-searches-and-rules.md)):
      searches pinned to the sidebar as virtual feeds, plus auto-mark-read /
      auto-star rules applied at ingestion.
