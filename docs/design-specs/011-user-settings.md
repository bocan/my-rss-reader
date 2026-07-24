# SPEC-011: User settings and preferences (server-persisted)

- **Status:** Done
- **Phase:** 3
- **Depends on:** SPEC-010 (reading list views)
- **Estimated size:** M

## Context

User preferences today are either ephemeral or browser-local. `apps/web/src/lib/theme.ts` persists the theme to `localStorage` under `rss-theme`, so it does not follow a user across devices or browsers. SPEC-004's article-view switcher (`simplified` / `readable` / `web`) is local `useState`, not persisted at all. SPEC-010 adds the list view mode (`cards` / `list` / `magazine` / `compact`) with the same limitation. The shared vocabulary already exists in `packages/shared/src/types.ts` (`VIEW_MODES`, `ARTICLE_VIEWS`), and `Theme` is defined in `lib/theme.ts`.

This spec introduces a server-persisted settings store so preferences survive reloads and roam across devices, plus a per-feed view override so a user can pin, for example, a photo-heavy feed to `magazine` while the rest of their list stays `compact`.

## Goal

A user sets their theme, default list view, default article view, and reading behavior once, and those choices persist server-side and apply on every device and after every reload. A user can override the list view for a single feed, and that override wins over their default. Theme applies with no flash on load.

## Non-goals

- Admin-level or instance-wide defaults, roles, registration toggles - SPEC-012.
- Folder-level view overrides. We reserve schema/precedence room for them below but do not build the folder UI or column in this spec.
- Per-feed article-view (`simplified`/`readable`/`web`) override. Only the list `viewMode` is overridable per feed here; article view stays a user-level default.
- New reading-behavior features themselves (mark-read-on-scroll, unread-only filtering) - this spec persists the toggles; SPEC-005 and SPEC-010 own the behavior they gate.

## Data model changes

Edit `apps/api/src/db/schema.ts`.

New `user_settings` table (one row per user, `userId` as PK):

```ts
export const themePref = pgEnum('theme_pref', ['light', 'dark', 'system']);

export const userSettings = pgTable('user_settings', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: themePref().notNull().default('system'),
  defaultViewMode: viewModeEnum().notNull().default('cards'),
  defaultArticleView: articleViewEnum().notNull().default('simplified'),
  markReadOnScroll: boolean().notNull().default(false),
  showUnreadOnly: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

Add two `pgEnum`s backing the view columns so the DB, not just Zod, rejects
bad values, keeping the enum members in lockstep with `VIEW_MODES` /
`ARTICLE_VIEWS`:

```ts
export const viewModeEnum = pgEnum('view_mode', ['cards', 'list', 'magazine', 'compact']);
export const articleViewEnum = pgEnum('article_view', ['simplified', 'readable', 'web']);
```

**Explicit columns over a jsonb blob (justification):** these are a small,
stable set of enum/boolean preferences that are read on every page load and
must be individually validatable and migratable. Explicit columns give us DB-level
enum constraints, cheap defaults, and typed Drizzle inference for free; a jsonb
blob would push all validation into the app layer, make defaults and future
column-level migrations awkward, and lose type safety. "Room to grow" is served
by adding columns as new stable prefs appear - the table is intentionally
open to that. Reserve jsonb only if we later add genuinely free-form or
high-cardinality settings.

Per-feed override, on the existing `subscriptions` table:

```ts
viewMode: viewModeEnum(), // nullable: null = inherit the user default
```

A `null` `subscriptions.viewMode` means "inherit"; a set value overrides the
user default for that feed's list. Folder-level override, if built later
(SPEC-007 territory), would add a matching nullable `folders.viewMode` and slot
between feed and user in the precedence chain below.

`user_settings` rows are **lazily created**: no row is written at signup. The
GET handler returns hard-coded defaults when no row exists; the PUT handler
upserts. This keeps SPEC-012's user-creation path untouched and avoids a
backfill migration for existing users.

Run `pnpm db:generate` to emit the migration into `apps/api/drizzle`, then
`pnpm db:migrate`. Commit the generated SQL.

## API changes

New `apps/api/src/routes/settings.ts`, both routes `{ preHandler: app.requireAuth }`,
scoped to `request.user.id` (a user can only read/write their own settings).

**`GET /api/settings`** - returns the caller's `user_settings` row, or the
default shape when no row exists (never 404). Response validated by
`settingsSchema` (below).

**`PUT /api/settings`** - body validated by `settingsSchema.partial()` so the
client can send only changed fields. Upserts the row
(`onConflictDoUpdate` on `userId`, setting `updatedAt = now()`), then returns
the full merged settings. Unknown keys and out-of-enum values are rejected by
Zod as a 400 (the API's error handler maps `ZodError` -> 400 automatically).

**`PATCH /api/feeds/:id`** (existing, SPEC-007) - extend
`updateSubscriptionSchema` with the per-feed override:

```ts
viewMode: z.enum(VIEW_MODES).nullable().optional(), // null clears the override
```

The handler already scopes by `subscriptions.userId = request.user.id`; setting
`viewMode` to `null` reverts the feed to inheriting the user default.

New `packages/shared/src/schemas/settings.ts`:

```ts
import { z } from 'zod';
import { ARTICLE_VIEWS, VIEW_MODES } from '../types.js';

export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  defaultViewMode: z.enum(VIEW_MODES),
  defaultArticleView: z.enum(ARTICLE_VIEWS),
  markReadOnScroll: z.boolean(),
  showUnreadOnly: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultViewMode: 'cards',
  defaultArticleView: 'simplified',
  markReadOnScroll: false,
  showUnreadOnly: false,
};
```

Export it from `packages/shared/src/schemas/index.ts` (or the package barrel).
The GET default response and the DB column defaults must both equal
`DEFAULT_SETTINGS` - keep the three in sync.

## Web / UI changes

- `apps/web/src/hooks/useSettings.ts`: a TanStack Query hook
  (`queryKey: ['settings']`) fetching `GET /api/settings`, plus a mutation that
  `PUT`s a partial and optimistically updates the cache, rolling back on error.
  `initialData` / a synchronous cache seed comes from `localStorage` (see theme
  migration) so the first render already has usable values.
- `apps/web/src/routes/SettingsPage.tsx` (new route, e.g. `/settings`): a form
  with controls for theme (segmented light/dark/system), default list view,
  default article view, and the two behavior toggles. Each control writes
  through the mutation on change. Uses existing shadcn/ui primitives; responsive
  single-column form. Reachable from the existing app nav/menu.
- Theme migration: replace the `localStorage`-only source in `lib/theme.ts`
  with a server-backed value. To avoid a flash of the wrong theme, keep an
  eager path: on boot, `initTheme()` still reads `localStorage['rss-theme']`
  (or `system`) and applies it **synchronously before React mounts**; once
  `['settings']` resolves, reconcile - apply the server theme and write it back
  to `localStorage` so the next cold load is already correct. `useTheme` becomes
  a thin wrapper over `useSettings` for reads and the settings mutation for
  writes, still calling `apply()` and keeping the `matchMedia('system')`
  listener.
- View-mode selection (SPEC-010): the list reads its active view as
  `subscription.viewMode ?? settings.defaultViewMode` (precedence below). The
  per-feed override is set from the feed's context menu / subscription settings
  (SPEC-007 surface) via `PATCH /api/feeds/:id`, invalidating both the
  subscriptions query and the derived view.
- Article-view selection (SPEC-004): `ReadingPane`'s initial
  `useState<ArticleView>` seeds from `settings.defaultArticleView` instead of a
  hard-coded `'simplified'`; the in-session switcher stays local and does not
  write back to settings.

## Implementation notes

- Build order: schema + enums + migration; `settings.ts` schema in
  `packages/shared`; API routes + tests; `useSettings` hook; theme migration in
  `lib/theme.ts` (the trickiest part - verify no flash); `SettingsPage`; then
  wire defaults into the list (010) and reader (004) last.
- **Precedence for list view mode**, most specific wins:
  `subscriptions.viewMode` (per-feed override) -> [future `folders.viewMode`]
  -> `user_settings.defaultViewMode` -> hard-coded `DEFAULT_SETTINGS`. Compute
  this in one small helper so both the list and any settings UI agree.
- No-flash contract: the synchronous `localStorage` read in `initTheme()` must
  run before first paint (it already does, called at startup). The server value
  only ever *reconciles* after hydration; it never gates the first paint. If
  `localStorage` and the server disagree, the server wins and overwrites the
  local cache for next time.
- Keep the enum members and the Zod `VIEW_MODES`/`ARTICLE_VIEWS` arrays as the
  single source of truth; the `pgEnum` literals must match them exactly. A unit
  test asserting equality guards against drift.
- Security: every settings read/write is scoped to `request.user.id`; there is
  no settings id in any path, so there is no cross-user access surface. The PUT
  upsert always targets `request.user.id`, never a client-supplied user id.

## Acceptance criteria

- [ ] `GET /api/settings` returns `DEFAULT_SETTINGS` for a user with no row, and
      the stored row once one exists (never 404).
- [ ] `PUT /api/settings` with a partial body updates only the sent fields,
      upserts the row, bumps `updatedAt`, and returns the full merged settings.
- [ ] Settings persist across reloads and across devices/browsers (server is the
      source of truth, not `localStorage`).
- [ ] First use applies documented defaults everywhere: list view (010), article
      view (004), theme, and both toggles.
- [ ] Setting `subscriptions.viewMode` via `PATCH /api/feeds/:id` makes that
      feed's list render the override; the rest of the list keeps the user
      default; setting it to `null` reverts to the default.
- [ ] Per-feed override precedence: override wins over `defaultViewMode`.
- [ ] No theme flash on load - the correct (or last-known) theme paints before
      React mounts; the server value reconciles silently afterward.
- [ ] Invalid values (bad enum member, wrong type, unknown key) are rejected
      with a 400 by both `PUT /api/settings` and the extended
      `PATCH /api/feeds/:id`.

## Testing

- Unit (shared): `settingsSchema` accepts a valid object and `.partial()`
  accepts single-field updates; rejects an out-of-enum `theme`, a non-boolean
  toggle, and an out-of-enum `viewMode`. A test asserting the `pgEnum` members
  equal `VIEW_MODES` / `ARTICLE_VIEWS` and `['light','dark','system']`.
- Integration: `GET /api/settings` returns defaults with no row; `PUT` creates
  the row (first call) then updates it (second call, upsert path) and bumps
  `updatedAt`; a partial `PUT` leaves untouched fields intact; a second user's
  settings are isolated (no cross-user read/write).
- Integration: `PATCH /api/feeds/:id` sets, then clears (`null`), the per-feed
  `viewMode`, scoped to the caller's subscription; a non-subscribed feed id is
  rejected/404 as today.
- Component: `useSettings` seeds from `localStorage` before the query resolves,
  then reconciles to the server value; the mutation optimistically updates and
  rolls back on error.
- Component: the list derives its view via the precedence helper (override beats
  default); `ReadingPane` seeds its article view from `defaultArticleView`.
- Manual: change theme on device A, confirm it appears on device B after load;
  hard-reload with a non-system theme set and confirm no flash of the wrong
  theme.

## Open questions

- Should the article-view switcher optionally "remember" per-session vs. always
  reset to `defaultArticleView` on each article? This spec resets to the default;
  a future toggle could persist last-used. Revisit if users ask.
