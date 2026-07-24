# SPEC-017: Account settings

- **Status:** Done
- **Phase:** 3
- **Depends on:** SPEC-012 (auth, sessions, roles)
- **Estimated size:** S

## Context

A signed-in user currently has no way to change their own account details.
`apps/api/src/routes/auth.ts` exposes only register / login / logout / me /
registration-mode; the admin routes (`admin.ts`) govern *other* users (role,
disable, delete) and are self-locked for the last admin, so a single-user
instance sees no controls at all. The Settings page (`SettingsPage.tsx`) covers
reading preferences, OPML, and PWA install, but nothing about identity. SPEC-012
explicitly deferred "password reset or admin-initiated password changes" to a
later spec; this is that spec, scoped to the logged-in user editing their own
account. `users` already has `email`, `displayName`, `passwordHash`,
`updatedAt`, so no schema work is needed.

## Goal

From the Settings page a signed-in user can change their display name and email,
and change their password by confirming their current one. Changing the password
signs out their other devices while keeping the current session active.

## Non-goals

- Password reset via email / "forgot password" (needs SMTP; still deferred, a
  future spec).
- Admin-initiated password changes or profile edits for other users (SPEC-012
  owns the admin roster; this is self-service only).
- Changing username (usernames are stable identifiers here; revisit separately).
- Email verification / confirmation round-trips.
- Two-factor auth, account deletion by the user (admin delete exists in 012).

## Data model changes

None. Uses existing `users` columns and the `sessions` table.

## API changes

New Zod schemas in `packages/shared/src/schemas/auth.ts` (re-exported from the
index):

- `updateAccountSchema = z.object({ displayName: z.string().min(1).max(64).optional(), email: z.email().optional() }).refine(at least one field present)`.
- `changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(256) })`.

New routes in `apps/api/src/routes/auth.ts`, both `{ preHandler: app.requireAuth }`
and scoped to `request.user!.id` (no id in the path):

- `PATCH /auth/me` -> updated `PublicUser`. Applies displayName and/or email.
  A new email that another user already holds -> 409 `{ message: 'Email already
  in use' }` (uniqueness check excludes the caller, so re-saving your own email
  is a no-op success). Bumps `updatedAt`.
- `POST /auth/change-password` -> 204. Verifies `currentPassword` against the
  stored hash; a mismatch -> 400 `{ message: 'Current password is incorrect' }`.
  On success, writes the new argon2 hash and deletes every *other* session for
  the user (`sessions.userId = me AND sessions.id != currentToken`), so other
  devices are signed out while the current cookie keeps working.

## Web / UI changes

- Hooks in `apps/web/src/lib/auth.ts`: `useUpdateAccount()` (PATCH `/auth/me`,
  `onSuccess` writes the returned user into the `['auth','me']` cache) and
  `useChangePassword()` (POST `/auth/change-password`).
- An **Account** section at the top of `SettingsPage.tsx`, above Preferences:
  - Profile sub-form: display name + email inputs seeded from the session user,
    a single Save that PATCHes only changed fields, with inline success/error.
  - Password sub-form: current / new / confirm inputs; the client checks
    new === confirm and length before enabling Save; on success clears the
    fields and shows "Password changed. Other devices have been signed out."
  - Errors surface the API message (e.g. wrong current password, email in use).
- Uses existing tokens / primitives (Button, the same input styling as the OPML
  and admin forms). No new dependencies.

## Implementation notes

- Order: shared schemas -> API routes (+ integration tests) -> web hooks -> the
  Settings Account section.
- Reuse `hashPassword` / `verifyPassword` (`lib/password.ts`) and the existing
  `toPublicUser` helper in `auth.ts`. The current session token comes from
  `request.cookies[SESSION_COOKIE]`.
- Security:
  - Never return the password hash. `PATCH /auth/me` selects safe columns only.
  - `change-password` must verify the current password before writing; on
    success invalidate other sessions so a compromised old credential cannot
    keep a foothold, but keep the caller signed in (better UX than a forced
    re-login).
  - Both routes are `requireAuth` and act only on `request.user`; there is no
    user id in the path, so one user can never edit another.
  - Email uniqueness is enforced in the app (excluding self) and by the existing
    `users_email_key` unique index as a backstop (a race surfaces as 409).

## Acceptance criteria

- [ ] `PATCH /auth/me` updates display name and/or email for the caller and
      returns the updated public user; `/auth/me` reflects it; unauthenticated
      callers get 401.
- [ ] Setting the email to one already used by a different user returns 409;
      re-saving the caller's own email succeeds.
- [ ] `POST /auth/change-password` with the correct current password changes it:
      the user can log in with the new password and not the old one.
- [ ] A wrong current password returns 400 and does not change anything.
- [ ] After a password change, the caller's current session still works and
      other sessions for that user are invalidated.
- [ ] The Settings page shows an Account section that performs all of the above
      with clear success and error feedback; no password hash is ever exposed.

## Testing

- Unit: `updateAccountSchema` (rejects empty object, validates email) and
  `changePasswordSchema` (min length on newPassword).
- Integration (API):
  - `PATCH /auth/me`: display-name change; email change; email-conflict 409;
    re-saving own email 200; empty body 400; anonymous 401; `/auth/me` reflects
    the change.
  - `change-password`: wrong current -> 400 and old password still works; correct
    -> 204, login with new succeeds and old fails; a second pre-existing session
    for the user stops resolving while the caller's session still resolves;
    anonymous -> 401.
- Manual: change display name and email in Settings and see the header update;
  change password, confirm the current session keeps working and a second
  browser is signed out.
