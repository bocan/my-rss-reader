# Reader

A calm, elegant, self-hosted RSS reader. Multi-user, responsive across desktop /
tablet / phone, with configurable reading views. Built as a small monorepo you can
run in a single container next to a Postgres database.

> Status: **scaffolding**. The machinery (build, CI/CD, Docker, auth, schema,
> feed worker) is in place; most reading features are stubs waiting to be filled in.

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

The API serves the built SPA from the same origin in production, so the whole app
is one container image (plus Postgres).

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

## Roadmap

Features to pluck from readers like Fluent, roughly in order:

- [ ] Feed discovery from a site URL + favicon fetching
- [ ] OPML import / export
- [ ] Reading views: cards, list, magazine, compact
- [ ] Article views: simplified (readability), readable, full web
- [ ] Full-text search (Postgres `tsvector`)
- [ ] Keyboard-driven navigation (j/k, mark read, star)
- [ ] Mark-all-read, filters (unread / starred / by folder)
- [ ] Keyset pagination + infinite scroll
- [ ] HTML sanitization of article content
- [ ] PWA / offline support
- [x] Per-user settings + themes
```
