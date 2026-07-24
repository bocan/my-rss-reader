# SPEC-012: Admin and multi-user management

- **Status:** Done
- **Phase:** 3
- **Depends on:** none
- **Estimated size:** M

## Context

Reader is multi-user at the data layer already: `users` has a `role` enum
(`'admin' | 'user'`), the first account to register becomes `admin`
(`apps/api/src/routes/auth.ts`), `request.user` is populated per request, and
`app.requireAuth` guards authenticated routes (`apps/api/src/plugins/auth.ts`).
What is missing is any way to *administer* the instance: registration is
unconditionally open, there is no admin UI, no roster of users, no way to
promote/demote/disable/delete an account, and no invite mechanism. This spec
adds the operator surface that turns a single-admin scaffold into a governable
self-hosted instance.

## Goal

An admin can control who may join (open / invite / closed), manage the user
roster (change roles, disable, delete), and generate invite links. Non-admins
never see or reach any of it. Registration adapts to the configured mode, and
the first-user-becomes-admin bootstrap still holds.

## Non-goals

- Per-user quotas, storage limits, or usage metrics.
- Email delivery of invites (we surface a copyable link; no SMTP).
- SSO / OAuth / external identity providers.
- Password reset or admin-initiated password changes (separate future spec).
- Audit logging of admin actions.

## Data model changes

Edit `apps/api/src/db/schema.ts`, then `pnpm db:generate` and commit the SQL.

- New enum `registrationMode = pgEnum('registration_mode', ['open','invite','closed'])`.
- New single-row table `appSettings`:
  - `id integer primaryKey` pinned to `1` (a `check (id = 1)` guard / always upsert row 1) so exactly one row exists.
  - `registrationMode registrationMode notNull default 'open'`.
  - `updatedAt timestamptz notNull defaultNow`.
  - Seed row 1 in the migration (or lazily upsert on first read).
- New table `invites`:
  - `id uuid pk defaultRandom`.
  - `token text notNull` + `uniqueIndex invites_token_key`.
  - `email text` (nullable; optional pin to one address).
  - `role userRole notNull default 'user'` (role granted on redemption).
  - `createdByUserId uuid notNull references users.id onDelete cascade`.
  - `expiresAt timestamptz notNull`.
  - `redeemedByUserId uuid references users.id onDelete set null` (nullable).
  - `redeemedAt timestamptz` (nullable).
  - `createdAt timestamptz notNull defaultNow`.
  - index on `createdByUserId`.
- Add `disabledAt timestamptz` (nullable) to `users`. Non-null means the account
  is disabled: it cannot log in and its sessions are rejected.
- Add relations for `invites` (creator/redeemer -> users). Export row types
  `AppSettings`, `Invite`.

## API changes

New Zod schemas in `packages/shared/src/schemas/admin.ts` (re-export from the
package index):

- `registrationModeSchema = z.enum(['open','invite','closed'])`.
- `updateSettingsSchema = z.object({ registrationMode: registrationModeSchema })`.
- `createInviteSchema = z.object({ email: z.email().optional(), role: z.enum(['admin','user']).default('user'), expiresInDays: z.number().int().min(1).max(90).default(7) })`.
- `updateUserSchema = z.object({ role: z.enum(['admin','user']).optional(), disabled: z.boolean().optional() }).refine(has at least one field)`.
- Extend `registerSchema` with `inviteToken: z.string().optional()`.
- Shared types: `AdminUser` (PublicUser + `disabledAt: string | null`),
  `InviteDto` (id, token, email, role, expiresAt, redeemedAt, redeemedByUserId, createdAt), `AppSettingsDto`.

Add `app.requireAdmin` in `apps/api/src/plugins/auth.ts`, mirroring
`requireAuth`: 401 if `!request.user`, else 403 if `request.user.role !== 'admin'`.
Decorate it alongside `requireAuth`.

New routes in `apps/api/src/routes/admin.ts` (registered under `/api/admin`,
every one guarded with `{ preHandler: app.requireAdmin }`):

- `GET /admin/users` -> `AdminUser[]` (all users; safe fields only, no hash).
- `PATCH /admin/users/:id` -> updated `AdminUser`. Applies role and/or
  `disabled` (sets/clears `disabledAt`). On disable, delete that user's sessions.
- `DELETE /admin/users/:id` -> 204. Cascades subscriptions/states/sessions.
- `GET /admin/invites` -> `InviteDto[]`.
- `POST /admin/invites` -> `InviteDto` (generates token via `randomBytes(32).base64url`, computes `expiresAt`). Response includes the full redeemable link path so the UI can build a copyable URL.
- `DELETE /admin/invites/:id` -> 204 (revoke an unredeemed invite).
- `GET /admin/settings` -> `AppSettingsDto`.
- `PATCH /admin/settings` -> `AppSettingsDto` (updates `registrationMode`).

Public route addition:

- `GET /auth/registration-mode` -> `{ mode }` (unauthenticated; lets the register
  page adapt without exposing anything sensitive).

Registration flow rewrite in `apps/api/src/routes/auth.ts` (still inside the
existing conflict check + first-user bootstrap):

- Read `appSettings.registrationMode`.
- If a `users` count of 0 -> allow regardless of mode (bootstrap admin), ignore
  invite. Otherwise branch on mode:
  - `closed` -> 403 `{ message: 'Registration is closed' }`.
  - `open` -> proceed, role `'user'`.
  - `invite` -> require `inviteToken`; look up an invite that is unredeemed
    (`redeemedAt is null`), unexpired (`expiresAt > now`), and, if the invite
    pins an `email`, matches `input.email`. Missing/invalid -> 403
    `{ message: 'A valid invite is required' }`. Role comes from the invite.
- Redeem atomically: run the user insert and the invite update
  (`redeemedByUserId`, `redeemedAt`) inside one `db.transaction`, re-checking
  `redeemedAt is null` in the UPDATE's WHERE and asserting one row changed, so
  two concurrent redemptions of one token cannot both win.

Session resolution guard (`apps/api/src/lib/session.ts`): in `resolveSession`,
also select `users.disabledAt`; if non-null, treat as no session (return null),
so a disabled user's existing cookie stops working immediately.

## Web / UI changes

- `apps/web/src/features/admin/` with an `Admin` route, gated in the router and
  nav so the entry only renders when `me.role === 'admin'` (from the `/auth/me`
  query). A non-admin hitting the route directly gets a redirect / not-found.
- Hooks in `apps/web/src/features/admin/api.ts`: `useAdminUsers`,
  `useUpdateUser`, `useDeleteUser`, `useInvites`, `useCreateInvite`,
  `useDeleteInvite`, `useSettings`, `useUpdateSettings` (TanStack Query;
  invalidate on mutate).
- Users panel: table of users (displayName, username, email, role, status,
  created). Role select (admin/user), an Enable/Disable toggle, and a Delete
  action with a confirm dialog (shadcn `AlertDialog`). The current admin's own
  demote/disable/delete controls are disabled with a tooltip.
- Invites panel: a "Create invite" form (optional email, role, expiry) and a
  list of outstanding invites showing status (active / redeemed / expired). On
  create, show the full link (`/register?invite=TOKEN`) with a copy-to-clipboard
  button. Revoke button on active invites.
- Settings panel: a segmented control / radio group for registration mode
  (open / invite / closed) that PATCHes on change.
- Register page (`apps/web/src/features/auth/RegisterPage`): on mount fetch
  `/auth/registration-mode`. `closed` -> hide the form, show "Registration is
  closed." `invite` with no `?invite=` token -> show "You need an invite link."
  `invite` with a token -> prefill it into the hidden `inviteToken` field.
  `open` -> normal form. Submit posts `inviteToken` when present.
- Uses existing design tokens (`src/index.css` CSS variables) and shadcn
  primitives; responsive table collapses to stacked cards on narrow screens.

## Implementation notes

- Order: schema + migration -> shared schemas/types -> `requireAdmin` decorator
  -> admin routes -> register-flow + session guard -> web admin feature ->
  register-page adaptation.
- No new libraries. Token generation reuses `node:crypto` `randomBytes` already
  used in `lib/session.ts`.
- `appSettings` as a pinned single row keeps reads a trivial `where id = 1`;
  provide a `getSettings()` helper that upserts the seed row if absent so a fresh
  DB never 500s.
- Security:
  - Every `/api/admin/*` route carries `preHandler: app.requireAuth` inherited
    plus `app.requireAdmin`; there is no admin route without the guard.
  - `GET /admin/users` returns only safe columns; the password hash is never
    selected. Non-admins get 403 before any query runs.
  - Last-admin protection: `PATCH` demoting the only remaining `admin`, `PATCH`
    disabling the only admin, and `DELETE` of the only admin all 409/400 with
    `{ message: 'Cannot remove the last admin' }`. Compute the admin count in the
    same transaction as the mutation to avoid a race.
  - Invite redemption is single-use via the transactional WHERE guard; expired
    and reused tokens are rejected identically (no oracle on why).
  - Disabling a user immediately kills their sessions and blocks new logins and
    session resolution (checked in both `/auth/login` and `resolveSession`).

## Acceptance criteria

- [ ] `appSettings` (single seeded row) and `invites` tables exist via a
      committed generated migration; `users.disabledAt` column added.
- [ ] `app.requireAdmin` returns 401 unauthenticated, 403 for role `'user'`, and
      passes for role `'admin'`.
- [ ] Every `/api/admin/*` route is unreachable by a non-admin (403) and never
      returns password hashes or other users' private data to them.
- [ ] `GET/PATCH/DELETE /admin/users`, `GET/POST/DELETE /admin/invites`, and
      `GET/PATCH /admin/settings` behave as specified.
- [ ] Registration: `closed` rejects (403); `open` allows anyone; `invite`
      requires a valid unredeemed unexpired (and email-matching, if pinned)
      token; the very first user still becomes admin regardless of mode.
- [ ] An invite token redeems exactly once; a second attempt (or an expired one)
      is rejected; redemption sets `redeemedByUserId` + `redeemedAt` atomically.
- [ ] The last remaining admin cannot be demoted, disabled, or deleted.
- [ ] A disabled user cannot log in and their existing session stops resolving.
- [ ] The web Admin section is visible only to admins; the register page adapts
      to open / invite / closed and carries the invite token from the URL.

## Testing

- **Unit:** `requireAdmin` for the three role cases; `getSettings()` seed-on-
  absent; invite validity predicate (valid / expired / redeemed / email
  mismatch); last-admin count guard.
- **Integration (API, per route):**
  - Each admin route with an anonymous, a `user`, and an `admin` caller ->
    401 / 403 / 200.
  - Registration in each mode: closed -> 403; open -> 201; invite without token
    -> 403; invite with valid token -> 201 and invite marked redeemed with the
    granted role; invite with expired token -> 403; reusing a redeemed token ->
    403; two concurrent redemptions of one token -> exactly one 201.
  - First-user bootstrap: with 0 users and mode `closed`/`invite`, registration
    still succeeds and yields role `admin`.
  - Last-admin: demote/disable/delete the sole admin -> rejected; with two
    admins, the same operations succeed.
  - Disabled user: `PATCH .../:id { disabled: true }` then a login attempt ->
    401, and a prior session cookie -> `/auth/me` 401.
- **Manual:** admin creates an invite, copies the link, opens it in a private
  window, registers, and lands signed in; toggling registration mode changes the
  register page; a non-admin has no Admin nav entry and is redirected from the
  route.
