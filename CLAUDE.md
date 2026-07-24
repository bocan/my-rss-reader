# Reader — working notes for Claude

A self-hosted, multi-user RSS reader. pnpm + Turborepo monorepo.

## Where things live

- `apps/web` — React 19 + Vite SPA. Path alias `@/` -> `apps/web/src`. TanStack
  Query for all server state; no other global store. Styling is Tailwind v4 +
  shadcn/ui; design tokens are CSS variables in `src/index.css`.
- `apps/api` — Fastify 5. Entry points: `src/server.ts` (API) and
  `src/worker/index.ts` (feed poller). Drizzle schema is `src/db/schema.ts`.
- `packages/shared` — Zod schemas + shared types. Source-only package (no build
  step); consumers import the TypeScript directly. Keep it framework-agnostic.

## Conventions

- ESM everywhere (`"type": "module"`); relative imports use `.js` specifiers.
- Validate all external input with Zod schemas from `@rss/shared`. The API's
  error handler turns `ZodError` into a 400 automatically.
- Drizzle columns are declared camelCase and mapped to snake_case via
  `casing: 'snake_case'` (set in both `drizzle.config.ts` and the db client).
- Auth: session cookie `rss_session` -> `sessions` row -> user. `request.user`
  is populated on every request; guard routes with `{ preHandler: app.requireAuth }`.
- Data model: feeds/articles are global and deduplicated; per-user state is in
  `subscriptions` and `article_states`. Never store a per-user copy of an article.

## Commands

- `pnpm dev` — web + api watch mode.
- `pnpm db:generate` then `pnpm db:migrate` after any schema change.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — what CI runs.

## After a schema change

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm db:generate` to emit SQL into `apps/api/drizzle`.
3. Commit the generated SQL. Containers apply it via `dist/migrate.js` on startup.
