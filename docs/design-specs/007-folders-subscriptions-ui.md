# SPEC-007: Folders and subscription management UI

- **Status:** Done
- **Phase:** 2
- **Depends on:** SPEC-002
- **Estimated size:** M

## Context

The data model already supports folders and ordering, but almost no API or UI
uses it.

- `folders` (`apps/api/src/db/schema.ts`) has: `id`, `userId` (FK to `users`,
  `ON DELETE cascade`), `name`, `parentId` (self-reference, nullable,
  **`ON DELETE cascade`**), `position` (`integer notNull default 0`),
  `createdAt`. Indexed on `userId`.
- `subscriptions` has: `id`, `userId`, `feedId`, `folderId` (FK to `folders`,
  nullable, **`ON DELETE set null`**), `customTitle`, `position`
  (`integer notNull default 0`), `createdAt`. Unique on `(userId, feedId)`,
  indexed on `userId`.

The API today only supports:

- `GET /feeds` and `POST /feeds` (subscribe), `DELETE /feeds/:id`
  (unsubscribe) in `apps/api/src/routes/feeds.ts`.
- `GET /folders` and `POST /folders` in the same file.

Routes are registered in `apps/api/src/routes/index.ts` and mounted under the
`/api` prefix, so `app.get('/folders')` is served at `/api/folders`. All of
these routes are guarded with `{ preHandler: app.requireAuth }` and populate
`request.user`.

There is **no** folder rename, move, reorder, or delete, and **no**
subscription update (move / rename / reorder). `packages/shared/src/schemas/feed.ts`
already exports `updateSubscriptionSchema` (`folderId`, `title`, `position`,
all optional) that no route consumes, and `createFolderSchema` (`name`,
`parentId`) used only by `POST /folders`.

The web sidebar (`apps/web/src/routes/ReaderPage.tsx`) renders subscriptions as
a flat `<ul>` with no folders, drag handles, or menus. `apps/web/src/components/ui/`
contains only `button.tsx`; there is no `DropdownMenu` yet. The app uses React
19, TanStack Query 5, Tailwind v4 + shadcn/ui, and the `api<T>()` fetch wrapper
in `apps/web/src/lib/api.ts` (JSON in/out, `credentials: 'include'`, throws
`ApiRequestError` on non-2xx, returns `undefined` for 204).

This spec turns that static list into an editable folder tree and adds the
folder/subscription mutation endpoints behind it.

## Goal

From the sidebar a user can create folders, nest a folder one level deep,
rename and delete folders, drag a feed into a folder or back to root, drag to
reorder feeds and folders, rename a feed's title, and unsubscribe. Every change
is saved to the server and survives a page reload. Deleting a folder never
deletes the feeds inside it.

## Non-goals

- OPML import/export (SPEC-009).
- Article-list folder filtering / the "click a folder to filter articles"
  behavior (SPEC-003 owns the list and its filters; this spec only makes the
  tree editable).
- Mark-all-read action itself (SPEC-005). This spec may add a disabled/stub
  menu entry but does not implement the mutation.
- Keyboard shortcuts for tree navigation beyond `@dnd-kit`'s own keyboard drag
  mode (SPEC-008 covers app-wide shortcuts).
- Folder nesting beyond one level (root folder -> child folder; no
  grandchildren). The self-referencing `parentId` column technically allows
  arbitrary depth, but the UI and the API validation in this spec cap depth at
  one.

## Data model changes

**None to the schema.** `folders.parentId` / `folders.position` and
`subscriptions.folderId` / `subscriptions.position` already exist and are
sufficient. No migration is required.

Note the two on-delete behaviors already baked into the FKs, because the delete
policy below has to work *with* them:

- `subscriptions.folderId` is `ON DELETE set null`: if a folder row is deleted,
  the database silently moves its subscriptions to root. This is a safe
  fallback, not the desired behavior (we want them at the *parent*, which the
  DB cannot express), so the app must reparent explicitly before deleting.
- `folders.parentId` is `ON DELETE cascade`: if a folder row is deleted, the
  database **deletes its child folders too** (and, transitively, their
  subscriptions get set to null). This is *not* what we want. The delete
  handler must reparent child folders in-app *before* removing the folder row,
  so the cascade never fires on real data.

If you would rather not rely on ordering the writes correctly, changing
`folders.parentId` to `ON DELETE set null` (a one-line schema change plus
`pnpm db:generate` / `pnpm db:migrate`) makes the database fall back to "promote
children to root" instead of deleting them. That is left as an Open Question;
the in-transaction reparenting below is correct regardless.

## API changes

All routes are added to `apps/api/src/routes/feeds.ts`, auth-required
(`{ preHandler: app.requireAuth }`), and every query is scoped to
`request.user!.id`. Paths below are as declared in the route file; they are
served under `/api`.

### New shared schema

Add to `packages/shared/src/schemas/feed.ts` (exported via the existing
`export *` in `schemas/index.ts`):

```ts
export const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
```

`updateSubscriptionSchema` already exists and is reused unchanged
(`folderId: uuid|null optional`, `title: string(1..200)|null optional`,
`position: int>=0 optional`). `title` maps to `subscriptions.customTitle`;
sending `title: null` clears the override. Note that with every field optional,
an empty `{}` body is a valid no-op; that is acceptable.

The API error handler already turns any `ZodError` into a 400, so malformed
bodies never reach the handler.

### `PATCH /folders/:id` (new)

Body: `updateFolderSchema`. Load the row with
`and(eq(folders.id, id), eq(folders.userId, request.user!.id))`; if no row,
`return reply.code(404)`.

When `parentId` is provided and **non-null**, validate before writing and
reject with `400 { error: 'invalid_parent' }` if any of these hold:

1. `parentId === id` (a folder cannot be its own parent).
2. The target parent row does not exist or does not belong to the user.
3. The target parent is itself already nested (`parent.parentId !== null`) -
   accepting it would create a grandchild (depth 2).
4. **The folder being moved already has child folders of its own** - nesting it
   under a parent would push its children to depth 2. Check with
   `select count from folders where parentId = id and userId = user.id`.

Checks 3 and 4 together enforce max-depth-1 and, because a nested folder can
never itself be a parent, rule out cycles without a recursive ancestor walk. If
`parentId` is explicitly `null`, the folder is being promoted to root; no
parent validation is needed.

On success, apply `name` and/or `parentId` if present, then handle `position`
via the reorder algorithm below, all in one `db.transaction`. Return the updated
folder row (`200`), same shape as a `GET /folders` item.

### `DELETE /folders/:id` (new)

Load and scope to the user; `404` if not found. Inside a single
`db.transaction`, in this order:

1. Reparent its subscriptions:
   `UPDATE subscriptions SET folderId = :grandparentId WHERE folderId = :id AND userId = :userId`,
   where `grandparentId` is the deleted folder's own `parentId` (so a child
   folder's feeds move up to the parent; a root folder's feeds move to root,
   `null`).
2. Reparent its child folders:
   `UPDATE folders SET parentId = :grandparentId WHERE parentId = :id AND userId = :userId`.
   Given one-level nesting the folder being deleted has at most children, never
   grandchildren, so this is a single flat update. Doing it *before* the delete
   is what prevents the `ON DELETE cascade` on `folders.parentId` from deleting
   those children.
3. Delete the folder row.
4. Renormalize positions in the affected sibling scopes (the deleted folder's
   parent scope for the promoted child folders; each destination folder scope
   for promoted subscriptions) so no gaps or collisions remain.

Return `204` (no body), matching the existing `DELETE /feeds/:id`.

### `PATCH /feeds/:id` (new)

`:id` is the **subscription id** (`subscriptions.id`), consistent with the
existing `DELETE /feeds/:id`. Body: `updateSubscriptionSchema`. Load with
`and(eq(subscriptions.id, id), eq(subscriptions.userId, request.user!.id))`;
`404` if none.

If `folderId` is provided and **non-null**, reject
`400 { error: 'invalid_folder' }` when that folder does not exist or does not
belong to the user. `folderId: null` moves the subscription to root and needs
no validation.

Apply `customTitle` (from `title`) and/or `folderId` if present, then handle
`position` via the reorder algorithm, all in one `db.transaction`. Return the
updated subscription as an **enriched row in the same shape as a `GET /feeds`
item** (join to `feeds` for `title`, `feedUrl`, `siteUrl`, `faviconUrl`,
`lastFetchedAt`) so the client can splice it straight into the `['feeds']`
cache.

### `GET /feeds` change (required)

The current select omits `position`, so the client cannot order the tree. Add
`position: subscriptions.position` to the selected columns. `folderId` and
`customTitle` are already selected. No response-shape break beyond the added
field. (`GET /folders` uses `select()` and already returns `parentId` and
`position`, so it needs no change.)

### Unsubscribe

`DELETE /feeds/:id` already exists and is reused as-is for the "unsubscribe"
menu action. No API change.

## Position strategy

**Dense integer positions per sibling scope, renormalized on every write,
inside the mutation's transaction.** A "scope" is:

- for subscriptions: all of a user's subs sharing the same `folderId`
  (including the root scope where `folderId IS NULL`);
- for folders: all of a user's folders sharing the same `parentId`
  (including the root scope where `parentId IS NULL`).

The `position` value in a PATCH body is interpreted as the **desired 0-based
index within the destination scope**, not a literal stored value. The server
places the row at that index and rewrites every sibling to a gap-free
`0..n-1` sequence. Renormalize algorithm (run in the same transaction as the
field updates):

1. If the row changed scope (folder move / reparent), renormalize the **old**
   scope to `0..n-1` (ordered by current `position`, tie-broken by
   `createdAt`).
2. In the **new** scope, list the remaining siblings ordered by `position`,
   insert the moved row at the clamped target index
   (`clamp(requestedPosition, 0, siblingCount)`; default = append to end when
   `position` is omitted), then write `0..n-1` across the whole scope.

Each renormalize is a handful of indexed `UPDATE ... WHERE userId = ? AND
folderId = ?` (or `parentId = ?`) statements over a few rows.

**Why dense integers over fractional indexing:** sibling counts per folder are
tens, not thousands, so a full renormalize is cheap and touches one small
indexed scope. Dense integers keep `position` human-readable, keep
`GET /folders` / `GET /feeds` a plain `ORDER BY position`, and sidestep the
float-precision drift and periodic rebalancing that fractional keys eventually
force - none of whose benefits (O(1) inserts at massive scale) apply here.

## Web / UI changes

### New dependencies (`apps/web/package.json`)

- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` - accessible
  drag-and-drop. Chosen over hand-rolled HTML5 DnD because keyboard dragging
  (arrow keys) and screen-reader live announcements are built in, and the
  sortable primitives model this list-of-lists tree without custom drag image
  handling. Note: `@dnd-kit/core` v6 declares React 16-18 peer deps; under
  React 19 pnpm will print a peer-dependency warning that is benign (see Open
  Questions).
- `@radix-ui/react-dropdown-menu` - backs a new shadcn/ui `DropdownMenu`
  (`apps/web/src/components/ui/dropdown-menu.tsx`) for the per-row and
  per-folder action menus, consistent with the existing shadcn button.

### New / changed files

- `apps/web/src/components/ui/dropdown-menu.tsx` (new): standard shadcn/ui
  DropdownMenu wrapper.
- `apps/web/src/components/sidebar/folder-tree.tsx` (new): the tree. Renders
  root-level folders and unfoldered feeds as siblings; each folder is
  collapsible and contains its feeds and, if present, its one level of child
  folders. Replaces the flat `<ul>` currently inline in `ReaderPage.tsx`
  (lines ~43-57). The two static smart views ("All items", "Starred") stay
  above the tree.
- `apps/web/src/lib/folders.ts` (new, or colocated hooks): TanStack Query hooks
  `useFolders()`, plus mutation hooks below. `useSubscriptions()` already exists
  in `ReaderPage.tsx`; extend its `SubscriptionRow` type with
  `folderId: string | null` and `position: number`.

### Tree construction

Fetch `['folders']` (`GET /folders`) and `['feeds']` (`GET /feeds`) with
TanStack Query. Build the tree client-side (no new list endpoint):

- Root folders = folders with `parentId === null`, sorted by `position`.
- Child folders = grouped by `parentId`, sorted by `position`.
- Feeds = grouped by `folderId` (root group = `folderId === null`), sorted by
  `position`.

### Inline editing

- **Create:** a "New folder" affordance at the bottom of the tree reveals an
  inline text input; Enter -> `POST /folders` with `{ name }`; Escape cancels.
- **Rename folder:** double-click the folder label, or a menu action, swaps the
  label for a text input; Enter -> `PATCH /folders/:id` with `{ name }`;
  Escape cancels.
- **Delete folder:** menu action -> native `confirm()` -> `DELETE /folders/:id`.
  On success the folder's former feeds and child folders appear at the folder's
  old parent (or root).
- **Rename feed:** per-feed menu action sets `customTitle` via
  `PATCH /feeds/:id` with `{ title }`.
- **Unsubscribe:** per-feed menu action -> `DELETE /feeds/:id`.
- **Mark all read:** per-feed / per-folder menu entry, rendered disabled (or
  wired to a no-op) with a `// TODO: SPEC-005` marker.

Use shadcn/ui `DropdownMenu` for the hover/context action menus. Actions become
visible on row hover and on keyboard focus (do not gate them on hover alone -
they must be reachable by keyboard).

### Drag-and-drop

One `DndContext` wraps the whole tree, with `PointerSensor` **and**
`KeyboardSensor` (from `@dnd-kit/sortable`'s `sortableKeyboardCoordinates`) so
every drag is achievable via keyboard.

- **Feeds** are `useSortable` items. Each feed's droppable container id encodes
  its group (folder id, or a sentinel like `root`). Dropping a feed inside its
  own group reorders it (`PATCH /feeds/:id` with `{ position }`); dropping it on
  a different group changes its folder (`PATCH /feeds/:id` with
  `{ folderId, position }`).
- **Folders** are a second sortable list scoped to their sibling group. Dragging
  a root folder reorders root folders (`PATCH /folders/:id` with `{ position }`).
  Dragging a folder onto/into another root folder reparents it
  (`PATCH /folders/:id` with `{ parentId, position }`); the UI must not offer
  dropping a folder into a folder that already has a parent, nor dropping a
  folder that itself has children into another folder (mirror the API's
  depth-1 rule so the user never triggers a 400).

Translate a drop into a target index within the destination group and send that
as `position`.

### Optimistic updates and rollback

Every mutation uses TanStack Query `useMutation` with the standard optimistic
pattern:

- `onMutate`: `await queryClient.cancelQueries` for `['feeds']` / `['folders']`,
  snapshot the current cache, apply the reorder/reparent/rename to the cache
  immediately, return the snapshot in the context.
- `onError`: restore the snapshot from context and surface an inline error
  (small text near the sidebar, or a toast if one exists). The tree returns to
  its pre-drag order.
- `onSettled`: `invalidateQueries(['feeds'])` and/or `['folders']` to reconcile
  with the server's renormalized positions.

Because the server renormalizes positions, the optimistic cache may briefly
disagree on exact integer values; the `onSettled` refetch is what makes them
converge. Order rows by `position` (tie-broken stably) so this reconciliation is
invisible.

### Persisted expand/collapse

Expanded/collapsed folder state persists in `localStorage` under key
`reader:sidebar-expanded` (a JSON array of folder ids). This is a per-device
display preference, not server state. Read it on mount, write on toggle; unknown
ids are ignored.

### Responsive / tokens

The sidebar stays `hidden md:flex` as today. Use existing design tokens
(`bg-accent`, `text-muted-foreground`, `border`, `bg-popover` for menus, `ring`
for focus) so the tree themes correctly in light and dark. Drag handles and
menu triggers get visible focus rings.

## Implementation notes

- Build and test the three endpoints (`PATCH /folders/:id`,
  `DELETE /folders/:id`, `PATCH /feeds/:id`) and the `GET /feeds` `position`
  addition **before** touching the UI. Reparenting, depth/cycle validation, and
  position renormalization are the parts most worth getting right in isolation.
- Do the folder-delete reparenting and every position renormalize inside a
  `db.transaction` so a mid-operation failure never leaves orphaned `folderId`
  references, deleted-by-cascade child folders, or duplicate positions.
- Order all validation (existence, ownership, depth/cycle) **before** any write.
- Keep the depth-1 rule enforced in exactly two spots that must agree: the API
  (`PATCH /folders/:id` checks 3 and 4) and the DnD drop-eligibility logic. If
  deeper nesting is ever wanted, both the API check and the UI must switch to a
  real ancestor walk; leave a comment to that effect.
- `PATCH /feeds/:id` returns the enriched (joined) row so the client can update
  the `['feeds']` cache without a second round trip.
- Reuse the existing `api<T>()` wrapper; it already includes credentials and
  throws typed errors that the mutation `onError` can read.

## Acceptance criteria

- [ ] From the sidebar the user can create a folder, rename it, and delete it.
- [ ] Dragging a feed onto a folder moves it there; dragging it out to root or
      to another folder moves it again; both persist across a page reload.
- [ ] Dragging to reorder feeds within a group, and folders within their
      sibling group, persists across a page reload.
- [ ] A feed can be renamed (sets `customTitle`) and unsubscribed from the
      sidebar; both persist.
- [ ] Deleting a folder does **not** delete its subscriptions or child folders;
      they reappear promoted to the deleted folder's former parent (or root).
- [ ] A folder can contain child folders one level deep. The API rejects (400,
      not 500 or silent no-op) any `PATCH /folders/:id` that would create a
      cycle, self-parent, exceed one level, or nest a folder that has children.
- [ ] `PATCH /feeds/:id` and `PATCH /folders/:id` reject a `folderId` /
      `parentId` that belongs to another user (400), and never touch another
      user's rows.
- [ ] Every drag action (move, reorder, reparent) is also achievable via
      keyboard through `@dnd-kit` sensors, and per-row/per-folder actions are
      reachable by keyboard, not hover-only.
- [ ] Expand/collapse state survives a reload via `localStorage`.
- [ ] A failed mutation rolls the tree back to its pre-drag state with a visible
      error.

## Testing

### API integration (Fastify `app.inject`, style of `health.test.ts`)

Set up two users (A and B), each with their own folders and subscriptions.

- `PATCH /folders/:id`:
  - rename (name changes, 200);
  - reparent to a valid root folder (200; `parentId` set);
  - reparent to itself -> 400 `invalid_parent`;
  - reparent to an already-nested folder -> 400;
  - reparent a folder that itself has a child folder -> 400 (depth-2 guard);
  - reparent to another user's folder -> 400 (or 404 if the id is unknown to A);
  - reorder via `position` -> siblings end up gap-free `0..n-1`, moved row at the
    requested index.
- `DELETE /folders/:id` on a folder containing both subscriptions and a child
  folder: assert the subscriptions and the child folder still exist afterward
  and have been reparented to the deleted folder's parent (or root), and that
  no positions collide.
- `PATCH /feeds/:id`:
  - move a subscription into a folder (200, `folderId` set);
  - move it back to root (`folderId: null`);
  - rename (`title` -> `customTitle`) and clear it (`title: null`);
  - reorder via `position`;
  - move into another user's folder -> 400 `invalid_folder`;
  - response shape matches a `GET /feeds` item (has `title`, `feedUrl`,
    `faviconUrl`, `folderId`, `position`).
- Scoping: any of user A's PATCH/DELETE requests referencing user B's ids return
  404/400 and leave B's `folders` / `subscriptions` rows untouched.
- `GET /feeds` now includes `position`.

### Web (component / manual)

- Drag a feed between folders and confirm the optimistic UI matches server state
  after the `onSettled` refetch.
- Reorder feeds and folders and reload; order persists.
- Force a mutation to fail (mock `api` to reject) mid-drag and confirm the tree
  rolls back to its prior order with a visible error.
- Keyboard-drive one reorder and one move end-to-end (Tab to a handle, Space to
  lift, arrows, Space to drop).
- Toggle folders, reload, and confirm expand/collapse state is restored.

## Open questions

- Should `folders.parentId` be changed from `ON DELETE cascade` to
  `ON DELETE set null` as a defense-in-depth fallback (promote orphaned children
  to root instead of deleting them)? The in-transaction reparenting makes the
  app correct either way; the question is whether to also harden the schema. If
  yes, it is a one-line schema edit plus `pnpm db:generate` / `pnpm db:migrate`.
- `@dnd-kit/core` v6 does not yet list React 19 in its peer deps. Confirm the
  benign warning is acceptable, or pin via a pnpm `peerDependencyRules` /
  override, before adding the dependency.
