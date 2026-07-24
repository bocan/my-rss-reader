# SPEC-008: Keyboard navigation and shortcuts

- **Status:** Done
- **Phase:** 2
- **Depends on:** SPEC-004 (reading pane), SPEC-005 (read/star mutations)
- **Estimated size:** M

## Context

By SPEC-003/004/005, `ReaderPage.tsx` has a real infinite-scroll article list
(`use-articles.ts`), a `ReadingPane` opened by a `selectedArticleId`, and
optimistic read/star/mark-read mutations (`useToggleArticleState`,
`useMarkRead`). Everything is mouse-driven today: there is no way to move
through the list, open, or mark from the keyboard. Power users expect Reeder /
NetNewsWire / Google-Reader muscle memory (`j`/`k`, `o`, `s`, `?`). This spec
adds a single app-level keyboard layer that dispatches to actions the earlier
specs already built, plus the "selected article" concept the list needs for
keyboard focus. It touches only `apps/web`; no server or schema work.

## Goal

From the keyboard alone a user can move a selection through the article list,
open and close articles, toggle read/star, mark all read, jump between feeds,
refresh, focus search, and see a `?` overlay listing every shortcut. Keys are
context-aware (list-focused vs reader-open), never fire while the user is
typing in a field, and the selected row is always visible and scrolled into
view.

## Non-goals

- New mutations or routes: all actions call SPEC-004/005 code as-is.
- Full-text search UI - `/` only focuses the search input SPEC-006 adds; if
  that input does not exist yet, `/` is a no-op (registered, guarded).
- Folder tree navigation semantics beyond next/prev feed - SPEC-007.
- Per-user remappable shortcuts / a settings pane for keys - SPEC-011 may add
  it later; the registry is built to make that a later add, not now.
- Drag-reorder, mouse gestures, touch equivalents - out of scope.

## Data model changes

None.

## API changes

None. Every shortcut dispatches to an existing hook/mutation.

## Shortcut set

Context `list` = list focused, no reader open (or open but list still active on
`lg+`). Context `reader` = a reader is open. `global` = both.

| Key | Context | Action |
| --- | --- | --- |
| `j` | list | select next article (open in place if reader already open) |
| `k` | list | select previous article |
| `o` / `Enter` | list | open selected article in reader |
| `Esc` | reader/overlay | close reader (mobile) or dismiss the topmost overlay |
| `m` | global | toggle read on selected/open article |
| `u` | global | mark selected/open article unread |
| `s` | global | toggle star on selected/open article |
| `n` | global | next feed/folder in sidebar |
| `p` | global | previous feed/folder in sidebar |
| `a` | global | mark all read in current view (SPEC-005 `useMarkRead` scope) |
| `r` | global | refresh (invalidate `['articles']` + `['counts']`) |
| `/` | global | focus search input (SPEC-006); no-op if absent |
| `g` then `g` | global | jump list to top and select first article (chord) |
| `?` | global | toggle the shortcuts overlay |

Selection target: `m`/`u`/`s` act on the open article when a reader is open,
otherwise on the selected list row. `a` uses the active list filter's
`feedId`/`folderId` (unscoped = all), matching SPEC-005's "Mark all read".

## Web / UI changes

- `apps/web/src/lib/shortcuts/registry.ts` - a plain data array of
  `Shortcut { keys: string[]; chord?: string[]; contexts: Context[]; group:
  string; label: string; run: (ctx: ShortcutContext) => void }`. `keys` are
  normalized event descriptors (e.g. `'j'`, `'Enter'`, `'Escape'`, `'?'`).
  `ShortcutContext` is the live handle actions need: `{ selectedId, articles,
  select, open, close, toggleRead, markUnread, toggleStar, markAllRead,
  refresh, focusSearch, nextFeed, prevFeed, gotoTop, toggleOverlay,
  activeContext }`. The overlay is generated from this one array, so the help
  and the behavior can never drift.
- `apps/web/src/hooks/use-shortcuts.ts` - `useShortcuts(ctx)` mounted once at
  the app root (in `ReaderPage`, or `App` wrapping it). It attaches a single
  `keydown` listener on `document`, resolves the current `Context` from `ctx`,
  finds the first registry entry whose `contexts` includes it and whose key
  matches, calls `preventDefault()` + `run(ctx)`. One listener, not one per
  shortcut.
- Input-focus guard: before matching, bail if
  `event.target` is an `<input>`, `<textarea>`, `[contenteditable]`, or the
  event has `metaKey`/`ctrlKey`/`altKey` set (leave browser/OS chords alone).
  Only `Escape` is allowed through the guard, so a user can blur a focused
  field. Implement as `isEditableTarget(el)` helper, unit-tested.
- g-prefix chord: keep a `pendingChord` ref and a timer. On a bare `g` with no
  pending chord, set `pendingChord = 'g'` and start an ~800ms timeout; the next
  `keydown` within the window looks for a `chord: ['g', x]` entry and fires it,
  then clears; any non-matching key or timeout clears the pending state.
  `g g` is the only chord defined now; the mechanism generalizes.
- Selected-article state: lift `selectedId` (already introduced by SPEC-004 for
  open) plus a distinct `focusedId` for keyboard selection into `ReaderPage`.
  `j`/`k` move `focusedId` across the flattened `data.pages.flatMap(p =>
  p.items)`; `o`/`Enter` set `selectedId = focusedId` to open. On `lg+` where
  the reader is a persistent column, `j`/`k` open in place (selection and open
  move together) so navigation always shows content. When `focusedId` reaches
  the last loaded row and `hasNextPage`, call `fetchNextPage()` so `j` keeps
  working past a page boundary.
- Row rendering (SPEC-003's list): the focused row gets an
  `aria-selected`/`data-focused` state and a visible ring
  (`ring-2 ring-ring`), and is scrolled into view via `ref.scrollIntoView({
  block: 'nearest' })`. Use the list `<ul>` with `role="listbox"` and rows
  `role="option"` so selection is exposed to assistive tech.
- Shortcuts overlay: `apps/web/src/components/shortcuts/ShortcutsOverlay.tsx`,
  a shadcn `Dialog` opened by `?` (and a `?` affordance in the header). It maps
  the registry grouped by `group` into a two-column key/label table, rendering
  `keys`/`chord` as `<kbd>` elements. Because it reads the registry, adding a
  shortcut adds a help row for free.

## Implementation notes

- **Hand-rolled listener, not `tinykeys`.** `tinykeys` is tiny and handles
  chords, but our dispatch needs three things it does not model: per-context
  resolution (`list` vs `reader`), the shared `ShortcutContext` action handle,
  and a single registry that also drives the help overlay. Wrapping `tinykeys`
  would mean re-deriving bindings per context and keeping a parallel help list.
  A ~60-line `keydown` handler over one registry array is less code, no new
  dependency (the repo already keeps deps lean), and keeps behavior and help
  provably in sync. Revisit only if user-remappable keys (SPEC-011) arrive.
- Match on `event.key` (layout-aware, gives `'?'`, `'Enter'`, `'Escape'`
  directly); do not use `keyCode`. Compare case-sensitively so `?` (shift+/)
  and `/` stay distinct and `J` (shift) does not trigger `j`.
- Reuse SPEC-005 hooks directly inside `ReaderPage` and pass their `.mutate`
  fns into `ShortcutContext`; the shortcut layer holds no server state and adds
  no new TanStack Query keys. `r` is `queryClient.invalidateQueries` for
  `['articles']` and `['counts']`.
- Accessibility: the focus ring uses the existing `--ring` token and must be
  visible in light and dark. Do not trap focus - the overlay `Dialog` is the
  only modal and returns focus to its trigger on close (shadcn default). Wrap
  `scrollIntoView` so it uses `behavior: 'smooth'` only when
  `matchMedia('(prefers-reduced-motion: reduce)')` is false, else `'auto'`.
- Order of work: `registry.ts` + `isEditableTarget` (pure, unit-tested) first,
  then `use-shortcuts.ts` with chord handling, then wire `focusedId`/selection
  and row focus styling into the list, then the overlay last (it just reads the
  registry).

## Acceptance criteria

- [ ] Each shortcut fires the correct action, and context-scoped keys (`j`/`k`
      in `list`, `Esc` in `reader`) only fire in their context.
- [ ] No shortcut fires while focus is in an `<input>`, `<textarea>`, or
      `contenteditable`; `Esc` still blurs such a field.
- [ ] `g` then `g` within the window jumps to the top and selects the first
      article; `g` followed by an unmapped key or a pause does nothing.
- [ ] The `?` overlay lists every registry entry, grouped, with correct key
      hints, and adding a registry entry adds an overlay row with no other edit.
- [ ] The focused row is visibly highlighted and scrolled into view; `j`/`k`
      move it one row and never leave it off-screen.
- [ ] `j` past the last loaded row triggers `fetchNextPage` and continues into
      the newly loaded articles with no duplicate or skipped selection.
- [ ] `m`/`u`/`s`/`a` produce the same optimistic updates and rollback as the
      SPEC-005 buttons, targeting the open article when a reader is open.
- [ ] Focus ring is visible in light and dark; opening/closing the overlay
      returns focus to its trigger and never traps focus.
- [ ] With `prefers-reduced-motion`, `scrollIntoView` does not animate.

## Testing

- Unit: `isEditableTarget` for input/textarea/contenteditable/normal nodes and
  the modifier-key guard.
- Unit: registry dispatch - given a `Context` and a synthetic `key`, the
  resolver returns the expected `Shortcut` (and none for a wrong-context key).
- Unit: chord state machine - `g`+`g` fires; `g`+`x` clears; `g` then timeout
  clears; a second `g` after timeout starts a fresh pending state.
- Component: mount `useShortcuts`, dispatch `keydown` events, assert the mocked
  action handlers fire per context and do not fire when the event target is an
  input.
- Component: overlay renders exactly one row per registry entry (assert count
  equals `registry.length`) with the right group headings.
- Component: `j`/`k` move the highlighted row and call `scrollIntoView`;
  `j` at the list end calls the mocked `fetchNextPage`.
- Manual: drive the whole reading loop (`j`/`k`/`o`/`m`/`s`/`n`/`a`/`Esc`/`?`)
  with no mouse across a multi-page feed; confirm no key fires while typing in
  the subscribe or search box.

## Open questions

- Should `j`/`k` on `lg+` open in place (shown above) or only move focus and
  require `o` to open, matching the mobile flow? Assumed open-in-place on
  `lg+`; revisit if it causes excess mark-read-on-open churn under SPEC-005.
- Chord timeout of 800ms is a guess; confirm it feels right in manual use.
