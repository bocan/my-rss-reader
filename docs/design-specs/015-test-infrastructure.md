# SPEC-015: Test infrastructure (API integration harness + backfill)

- **Status:** Done (web harness added in SPEC-008)
- **Phase:** Foundational (do before Phase 2 feature work)
- **Depends on:** 001-005 exist (the routes this backfills); no structural dependency
- **Estimated size:** L

## Context

The suite today is 44 tests, all in `apps/api`, and all are unit tests of pure
or network-mocked logic:

| File | Tests | Scope | Hits Postgres? |
| --- | --- | --- | --- |
| `src/lib/sanitize.test.ts` | 15 | XSS sanitizer | no |
| `src/lib/feed-fetch.test.ts` | 13 | discovery + favicon (undici mocked) | no |
| `src/lib/readability.test.ts` | 8 | extraction (undici mocked) | no |
| `src/lib/cursor.test.ts` | 6 | cursor encode/decode | no |
| `src/routes/health.test.ts` | 2 | `/healthz` via `app.inject` | no |

`apps/web` has no test runner at all. CI (`.github/workflows/ci.yml`) runs
`pnpm test`, which is these 44.

Every route that touches Postgres is verified only by hand: ad-hoc `node`
smoke scripts and Playwright browser runs during each spec. That is real
verification, but it is not repeatable, not CI-gated, and not a regression net.
It matters here specifically because **every non-network bug hit during Phase 1
lived in the database layer** and a unit test structurally cannot catch it:

- drizzle expanded a JS array into separate params, breaking `any(...::uuid[])`
  in `POST /articles/mark-read` (SPEC-005).
- postgres.js returned a `coalesce(...)` expression as a string and truncated
  microseconds, breaking the keyset cursor (SPEC-003).
- `folderId` scoping and mark-read idempotency are pure SQL behaviors.

Those are only observable against a real Postgres running the real query. This
spec builds that net: an automated integration harness plus backfilled tests
covering every Phase 1 route, turning the manual smoke checks into permanent,
CI-gated tests.

## Goal

`pnpm test:integration` boots an ephemeral real Postgres, applies the Drizzle
migrations, and exercises the API routes through `app.inject` against that
database, with per-test isolation. Every Phase 1 route has at least one
integration test asserting the behavior previously checked by hand. CI runs
both the unit suite and the integration suite. Reverting a known DB-layer fix
(for example the mark-read array-literal binding) makes an integration test
fail.

## Non-goals

- **Web / frontend test harness.** Described in Part 2 below as the planned
  follow-up, but not built in this spec. The optimistic hooks are the main thing
  it would cover; decide after Part 1 lands.
- **Playwright E2E in CI.** Keep the existing manual browser-driving loop for
  visual checks; do not gate CI on a headed browser here.
- **Performance / load tests.** The mark-read statement's set-based-ness is
  asserted for correctness, not benchmarked.
- **Rewriting product code.** The only permitted app changes are minimal
  test-affordances (see "App changes"), and there should be near zero.
- **pg-mem or any in-memory Postgres emulator.** The entire point is to catch
  real-Postgres behavior (`any(...::uuid[])`, `coalesce`, row-value keyset
  comparisons, `make_interval`, and later `tsvector`); an emulator that
  approximates these would defeat the purpose. Explicitly rejected.

## Data model changes

None.

## App changes

Aim for zero. The app already exposes what the harness needs: `buildApp()`
(`apps/api/src/app.ts`) builds a fresh Fastify instance, and `db`
(`apps/api/src/db/index.ts`) is the shared client. The harness drives the app
through those. If a seam is genuinely required, prefer adding a test-only helper
under `test/` over changing route or db code.

## Part 1: the integration harness

### Runner: Testcontainers, one config, single worker

Add `@testcontainers/postgresql` to `apps/api` `devDependencies` (pin the exact
current version, per repo convention). Testcontainers starts a real, ephemeral
Postgres in Docker (already a project prerequisite), so `pnpm test:integration`
works with no "start the test DB first" step, and local and CI use the exact
same mechanism with no service-container YAML.

Split unit and integration by filename so the fast unit suite never pays the
container cost:

- Unit: `src/**/*.test.ts` (unchanged), no Docker.
- Integration: `src/**/*.int.test.ts`, Docker.

Two Vitest configs:

- `apps/api/vitest.config.ts` (existing): set `test.include` to
  `['src/**/*.test.ts']` and `test.exclude` to include `'**/*.int.test.ts'` so
  the unit run stays DB-free. Keep its current `test.env`
  (`NODE_ENV=test`, a placeholder `DATABASE_URL`, `SESSION_SECRET`); unit tests
  never connect.
- `apps/api/vitest.integration.config.ts` (new):
  - `test.include`: `['src/**/*.int.test.ts']`.
  - `test.globalSetup`: `['./test/global-setup.ts']`.
  - `test.setupFiles`: `['./test/setup-db-env.ts']`.
  - Force a single worker: `test.pool = 'forks'` with
    `test.poolOptions.forks.singleFork = true` (integration tests share one
    database, so files must not run in parallel across workers). Tests within a
    file run sequentially by default.
  - `test.env`: `NODE_ENV=test`, `SESSION_SECRET` (any 16+ char string).
    **Do not** set `DATABASE_URL` here; it is injected at runtime (below).

### The env-propagation mechanism (the non-obvious part)

`db/index.ts` builds the postgres client at import time from
`env.DATABASE_URL`, and `env.ts` validates `process.env` at import. The
container's URL is not known until the container starts, and Vitest
`globalSetup` runs in the main process whose env does **not** propagate to the
worker. So:

1. `test/global-setup.ts` (main process, runs once): start the Postgres
   container, run migrations against it (below), and **write the connection URL
   to a file** at `apps/api/.test-db-url`. Return a teardown that stops the
   container and removes the file.
2. `test/setup-db-env.ts` (runs in the worker, before any test file imports the
   app): read `apps/api/.test-db-url` and set
   `process.env.DATABASE_URL = <url>`.
3. When a test file then imports `buildApp` / `db`, `env.ts` sees the URL
   already set. `env.ts` loads a local `.env` only for keys not already present
   (Node's `loadEnvFile` does not override existing `process.env`), so the
   injected URL wins even on a dev machine that has a `.env`.

Add `apps/api/.test-db-url` to `.gitignore`.

Migrations in `global-setup.ts` run with a throwaway client (not the app
singleton), reusing the same migrator the container entrypoint uses
(`apps/api/src/db/migrate.ts` -> `drizzle-orm/postgres-js/migrator`,
`migrationsFolder: 'drizzle'`):

```ts
// test/global-setup.ts (sketch)
import { writeFileSync, rmSync } from 'node:fs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const URL_FILE = new URL('./.db-url', import.meta.url); // or apps/api/.test-db-url

export async function setup() {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  await client.end();
  writeFileSync(URL_FILE, url);
  return async () => {
    rmSync(URL_FILE, { force: true });
    await container.stop();
  };
}
```

`postgres:17-alpine` matches the production/dev image in
`docker/docker-compose.yml`. Resolve the migrations folder relative to the
`apps/api` cwd (Vitest runs there under `pnpm --filter @rss/api`).

### Isolation: `resetDb()` + seed + auth helpers

`test/helpers.ts` (imported by the app singleton `db`, now pointed at the
container):

- `resetDb()`: `TRUNCATE users, sessions, folders, feeds, subscriptions,
  articles, article_states RESTART IDENTITY CASCADE`. Call in a `beforeEach` in
  each integration file for a clean slate. CASCADE covers the FKs; ids are
  uuids so identity restart is a no-op but harmless.
- Seed builders returning the inserted row(s): `seedUser({ role? })`,
  `seedFeed({ feedUrl, title?, ... })`, `seedSubscription(userId, feedId,
  { folderId? })`, `seedFolder(userId, { name, parentId? })`,
  `seedArticle(feedId, { publishedAt?, fetchedAt?, guid?, ... })`,
  `seedArticleState(userId, articleId, { read?, starred? })`. Thin wrappers over
  `db.insert(...).values(...).returning()`.
- `loginAs(user)`: insert a `sessions` row (`id` = a random token, `userId`,
  `expiresAt` in the future) and return the cookie header string
  `rss_session=<token>`. This gives authed `app.inject` calls without paying
  argon2 on every test. The real register/login flow is itself covered by the
  auth tests below.
- `authedInject(app, user, opts)`: convenience wrapper that adds the
  `loginAs(user)` cookie to an `app.inject` call.

Pattern per integration file:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { resetDb, seedUser, /* ... */ } from '../../test/helpers.js';

let app;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });
```

### Mocking outbound HTTP

Routes that fetch (subscribe -> feed-fetch, readable -> readability) still must
not hit the network. Reuse the established `vi.mock('undici', ...)` pattern from
`feed-fetch.test.ts` / `readability.test.ts` (mock `request` plus the `Agent`
/ `interceptors` stubs). The database is real; only the network is mocked. This
lets a subscribe test assert the real `feeds` / `articles` / `subscriptions`
rows written from a controlled feed fixture.

## Part 2: backfilled integration tests

Write these as `*.int.test.ts` beside the routes. Each turns a manual smoke
check into a permanent test.

- **auth** (`routes/auth.int.test.ts`): first registration becomes `admin` and
  later ones `user`; login by email and by username; `/auth/me` reflects the
  session and 401s without one; logout clears the session; duplicate
  email/username 409; bad credentials 401.
- **feeds / discovery** (`routes/feeds.int.test.ts`, undici mocked): subscribe
  to a direct feed populates `title`/`siteUrl`/`favicon` and stores articles;
  homepage with one feed auto-resolves; multi-feed homepage returns 409 with
  `candidates` and writes nothing; zero-feed homepage 422; re-subscribe to an
  existing `feedUrl` dedups and does not refetch (assert mock call count);
  `GET /feeds/discover` writes nothing; unsubscribe removes only the caller's
  subscription; `GET /feeds` includes correct `unreadCount`.
- **article list** (`routes/articles-list.int.test.ts`): a full `limit=2` walk
  concatenates to the same ids as one `limit=100` call with no dupes or gaps,
  for both sort orders; `nextCursor` is null only on the true final page
  including exact-multiple totals; `feedId` / `folderId` / `unread` / `starred`
  filters; a second user's articles never leak; a `publishedAt = null` article
  appears once ordered by `fetchedAt`; a malformed cursor returns 400.
- **article detail + readable** (`routes/articles-detail.int.test.ts`, undici
  mocked): detail returns the full shape with feed + state defaults; 404 for a
  random uuid and for a non-subscribed feed's article are byte-identical;
  malformed id 404; first `readable` call extracts once and stores it; second
  call is a cache hit (no refetch); `?refresh=true` refetches; failed extraction
  is a 200 with `readableHtml: null` and a set timestamp; `url = null` yields
  422 without stamping; readable enforces the same 404 scope.
- **mark-read + state + counts** (`routes/state-counts.int.test.ts`): mark-read
  by `feedId`, by `folderId`, and unscoped mark the right sets; `feedId` beats
  `folderId`; `before` marks only `coalesce(published_at, fetched_at) <` cutoff
  including an undated article via `fetched_at`; marking is idempotent and
  leaves the first `read_at` and any `starred`/`starred_at` untouched; empty
  folder / no subs returns 204; PATCH state toggles one half without touching
  the other and is idempotent; `getUnreadCountsByFeed`, `GET /feeds`
  `unreadCount`, and `GET /counts` per-feed/folder/total all agree and count
  no-state-row articles as unread.

## CI and scripts

- **Scripts** (`apps/api/package.json`): keep `test` as the unit run
  (`vitest run --passWithNoTests`, now unit-only via the include/exclude). Add
  `test:integration`: `vitest run --config vitest.integration.config.ts`.
- **Turbo / root**: add a root `test:integration` script
  (`turbo run test:integration`) and a `test:integration` task in `turbo.json`
  (no cache, or cache off, since it needs Docker).
- **Makefile**: add `test-integration` and fold it into `check` and `ci`.
- **CI** (`.github/workflows/ci.yml`): after the existing `Test` step add an
  `Integration test` step running `pnpm test:integration`. `ubuntu-latest` has
  Docker, so Testcontainers works with no extra service config. Keep unit and
  integration as distinct steps so a failure says which layer broke.

## Acceptance criteria

- [ ] `pnpm --filter @rss/api test:integration` starts an ephemeral Postgres,
      migrates it, runs the `*.int.test.ts` suite green, and stops the container
      afterward, with no manual DB setup.
- [ ] `pnpm --filter @rss/api test` still runs only the unit suite and does not
      require Docker or a database.
- [ ] Each test gets a clean database (`resetDb()` in `beforeEach`); tests do
      not leak state into each other regardless of order.
- [ ] Every route group listed in Part 2 has integration tests asserting the
      enumerated behaviors.
- [ ] CI runs both the unit and integration suites as separate steps and both
      pass.
- [ ] Regression proof: temporarily reverting the mark-read array-literal
      binding (back to `any(${feedIds}::uuid[])`) makes a mark-read integration
      test fail; restoring it makes it pass. (Document this check; do not commit
      the revert.)

## Testing

This spec is test infrastructure, so "testing" is the regression-proof check
above plus confirming the harness itself: run the integration suite twice in a
row (state resets cleanly), run a single integration file in isolation
(container still starts via `globalSetup`), and confirm the unit suite is
unchanged at 44 passing tests.

## Open questions

- **Container startup cost.** Testcontainers adds a few seconds to the
  integration run for the image pull/start. Acceptable for CI and pre-push. If
  it becomes annoying locally, options are Testcontainers reuse
  (`.testcontainers.properties` reuse flag) or a long-lived local test DB; not
  needed initially.
- **Web harness now or later.** Part 2's frontend harness (Vitest +
  `@testing-library/react` + jsdom, targeting the optimistic hooks in
  `apps/web/src/lib/articles.ts`) is deferred. Decide after Part 1 whether to
  add it as its own spec or fold it here.
- **Transaction-per-test vs truncate.** This spec uses truncate for simplicity
  and because `buildApp` uses the shared pool. A savepoint/rollback-per-test
  approach is faster but needs the app to run on a single pinned connection;
  revisit only if truncate proves slow.
