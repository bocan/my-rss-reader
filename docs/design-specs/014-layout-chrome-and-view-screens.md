# SPEC-014: Layout chrome and view-driven screens

- **Status:** Done
- **Phase:** Design (do before the visual identity pass)
- **Depends on:** SPEC-003 (list + pagination), SPEC-004 (reading pane), SPEC-008 (keyboard), SPEC-010 (view renderers)
- **Estimated size:** L

## Context

SPEC-010 shipped four list renderings (list, compact, cards, magazine) but hosted
all of them **inside the middle column**, with the switcher in that column's
header. That is the wrong model: the view mode should decide **what the whole
screen is**, not just how one column paints its rows.

What exists today (`apps/web/src/routes/ReaderPage.tsx`):

- A fixed 3-column grid: `260px | 360px | 1fr` (sidebar, list, reader), with the
  sidebar `hidden md:flex` and no way to collapse it.
- `AppShell` renders a thin top bar (logo, theme toggle, user, sign out).
- `ArticleList` owns a great deal: the `useArticles` infinite query, the debounced
  search box, the scope title and unread count, mark-all-read, the
  `IntersectionObserver` sentinel, keyboard focus state, and the
  `ArticleListHandle` imperative surface used by SPEC-008.
- The four view components in `apps/web/src/components/reader/views.tsx` are
  already presentational and take `items` + callbacks, so they are reusable as-is.

This spec rearranges the shell around the view mode, makes the sidebar
collapsible, and moves scope chrome into the top bar. The **visual identity pass**
(palette, typography, personality) is deliberately *not* in this spec; see
Non-goals.

## Goal

The top bar is the permanent control surface: sidebar toggle, scope title and
unread count, search, mark-all-read, and the view switcher. Collapsing the
sidebar gives the content the full width. Choosing a view changes the entire
screen below the bar: list and compact keep the familiar list-beside-reader
columns, while cards and magazine take over the whole content area as a browse
surface that swaps in place to the article when you open one, with a back
control to return.

## Non-goals

- **Visual identity** (palette, type scale, personality, density). That is the
  separate redesign the user asked for and is tracked as SPEC-016; this spec is
  structural only and keeps the current tokens.
- **Tablet and phone layouts.** This spec defines desktop (`lg` and up).
  Below `lg` it must not break (see Responsive), but the real small-screen
  treatment belongs to SPEC-013.
- **New data, routes, or query changes.** Everything renders from the existing
  `GET /articles` infinite query and `?article=` param.
- Server-persisted view or sidebar state. `localStorage` only; SPEC-011 owns
  server persistence.

## Data model changes

None.

## API changes

None.

## Layout model

### Top bar (permanent, all modes)

One row, left to right:

1. Sidebar toggle (`PanelLeft` icon), `aria-expanded`, tooltip with its shortcut.
2. Product mark.
3. **Scope title + unread count** for the active filter ("All items 109",
   "Starred", a feed name, a folder name). Moves here from the list header.
4. **Search input** (the debounced `q` from SPEC-006). Moves here.
5. **Mark all read** for the active scope (SPEC-005). Moves here; hidden while
   searching and when the scope has zero unread, exactly as today.
6. **View switcher** (the 4-way control from SPEC-010, moved out of the list
   header).
7. Theme toggle, user, sign out (unchanged).

At narrow widths the scope title truncates first, then the search collapses to an
icon that expands on focus. The bar never wraps to two rows.

### Sidebar

Collapsible, **fully hidden** when collapsed (no icon rail): the content region
takes the full width. State persists in `localStorage` under
`reader:sidebar-collapsed`, read on mount. Toggling animates the grid column
width (respecting `prefers-reduced-motion`). Bind a shortcut through the SPEC-008
registry (`[`, group "App", label "Toggle sidebar") so it appears in the `?`
overlay for free.

### Content region, by view mode

| Mode | Content region |
| --- | --- |
| `list` | Two columns: article list (`360px`) then reading pane (`1fr`). Today's behavior. |
| `compact` | Same two columns as `list`, denser rows. |
| `cards` | **One region**: a grid of square cards filling the width. |
| `magazine` | **One region**: two columns of wide, non-square rows. |

So the grid template is:

```
sidebar?  +  (list | compact)  ->  [list 360px] [reader 1fr]
sidebar?  +  (cards | magazine) ->  [browse 1fr]
```

### Browse -> read -> back (cards and magazine only)

The existing `?article=<id>` search param already drives the reader and already
creates history entries. In cards and magazine:

- No `?article=`: the browse surface (grid) fills the region.
- With `?article=`: the grid is **replaced in place** by the reading pane, which
  gains a **Back** control (`ChevronLeft`, "Back to <view>") that clears the
  param. The browser/OS back gesture does the same thing for free.
- Returning restores the grid **with its scroll position and loaded pages
  intact**, so a reader does not lose their place after opening one item. Keep
  the grid mounted and hidden rather than unmounting it (same technique SPEC-004
  used to keep the list alive below `lg`).

In list and compact nothing changes: the reader is a persistent column and
selection updates it in place.

## Card and magazine anatomy

### Card (square)

Fixed square (`aspect-square`), `overflow-hidden`, contents in a single vertical
stack that translates on hover. Resting state, top to bottom: **image** (about
60% of the height, `object-cover`), then **feed name + date**, then **title**.

**Hover / focus reveal.** The card keeps its exact size; nothing reflows and no
neighbor moves. The inner stack translates up by the image height so the image
scrolls out of view, the feed/date/title ride up into its place, and the
**excerpt** (from `summary`, line-clamped) fades in below them. Drive it with a
single `transform` on the stack plus an opacity fade on the excerpt, both
`transition` + `motion-reduce:transition-none`. Trigger on `:hover` **and**
`:focus-within` so keyboard focus reveals the same content.

Cards **without an image** render the text layout directly (feed/date/title at
top, excerpt below) and do not translate on hover; only the excerpt fades in if
it was clamped.

Thumbnail fallbacks are unchanged from SPEC-010 (`ArticleThumbnail`: image, then
feed favicon, then generated tint + initial).

### Magazine row (wide)

Two columns of rows (`grid-cols-2` at `lg`, one column below). Each row is a
horizontal card: thumbnail on the left at a fixed width, and on the right the
title, feed name, date, author when present, and a two-line excerpt. Rows are
wider and shorter than cards, so more metadata fits without a hover reveal;
hover is a subtle lift only.

## Web changes

### The refactor that makes this possible

`ArticleList` currently owns the query, focus state, sentinel, and the SPEC-008
imperative handle, all bound to the middle column. Cards and magazine now live in
a different region, so that state must be lifted:

- New `apps/web/src/hooks/use-article-surface.ts`: owns the `useArticles`
  infinite query for the active filters, the flattened `items`, `fetchNextPage`,
  the keyboard `focusedId` with `focusNext/focusPrev/focusFirst/getFocused`, and
  a `registerRow` ref collector for scroll-into-view. Returns one object consumed
  by whichever surface is mounted.
- `ArticleList` becomes the **list/compact column** only: it renders `ListView`
  or `CompactView` plus the scroll container, sentinel, loading/empty/end states.
- New `apps/web/src/components/reader/BrowseSurface.tsx`: the cards/magazine
  region. Same scroll container, sentinel, and states, rendering `CardsView` or
  `MagazineView`.
- `ReaderPage` composes: top bar chrome, sidebar (collapsible), then either the
  two-column split or the browse surface, based on `view`.
- The `IntersectionObserver` sentinel and the focus state live in the surface
  wrappers, **outside** the switched view component, so changing view never
  refetches, never resets pagination, and never jumps scroll.

### Keyboard (SPEC-008)

All shortcuts keep working in every mode, driven by `use-article-surface`:

- `j` / `k` move focus through the flattened items in **grid order** in cards and
  magazine (visual row-major order equals array order, so no extra logic).
- `o` / `Enter` opens the focused article. In cards/magazine that means swapping
  the region to the reader.
- `Esc` returns to the grid (clears `?article=`) in cards/magazine; unchanged
  elsewhere. It still dismisses the shortcuts overlay first.
- Add `[` -> "Toggle sidebar" to the registry.
- Focused card gets the same visible `ring-2 ring-ring` and is scrolled into view.

### Motion

Keep it purposeful (the calibration from SPEC-010): the card hover reveal is the
signature move. Beyond it, only the sidebar collapse/expand, the grid<->reader
swap crossfade, and the existing entrance stagger. Everything carries
`motion-reduce:`.

## Responsive (interim)

Desktop (`lg`+) is what this spec designs. Below `lg` it must degrade sanely and
not break:

- Sidebar becomes an overlay/off-canvas panel over the content rather than a grid
  column, dismissed by the same toggle.
- Cards and magazine collapse to a single column.
- list/compact keep the SPEC-004 behavior (full-screen reader pushed over the
  list, back control).

A real phone/tablet information architecture is SPEC-013.

## Acceptance criteria

- [ ] The top bar holds the sidebar toggle, scope title + unread count, search,
      mark-all-read, and the view switcher; none of these remain in the article
      list header.
- [ ] The sidebar toggle collapses it fully (content takes the whole width) and
      expands it again; the state survives a reload and has a `?`-overlay
      shortcut.
- [ ] `list` and `compact` render list-beside-reader exactly as before.
- [ ] `cards` and `magazine` fill the whole content area with no middle column.
- [ ] In cards/magazine, opening an article replaces the grid in place with the
      reader plus a Back control; Back and the browser back gesture both return
      to the grid **with scroll position and loaded pages preserved**.
- [ ] A card is square, shows image + feed + date + title at rest, and on hover
      **or keyboard focus** slides the image out, raises the text, and reveals the
      excerpt, with the card's own size unchanged and no neighbor moving.
- [ ] An imageless card shows the text layout directly and never leaves a blank
      image area.
- [ ] Magazine renders two columns of wide rows with thumbnail, title, feed,
      date, and excerpt.
- [ ] `j`/`k`/`o`/`Enter`/`Esc` work in all four modes, focus is visible, and the
      focused item scrolls into view.
- [ ] Switching views never refetches, never resets pagination, and keeps the
      selected article selected.
- [ ] Every animation is disabled under `prefers-reduced-motion`.

## Testing

- Unit: sidebar-collapse hook (default expanded, reads a stored value, ignores a
  corrupt one, persists a toggle) using the web harness from SPEC-008.
- Unit: the shortcut registry gains "Toggle sidebar" and the overlay row count
  still equals `SHORTCUTS.length`.
- Component: mounting each of the four modes renders the expected region shape
  (two columns vs one browse region) over the same seeded items.
- Component: with `?article=` set, cards/magazine render the reader plus a Back
  control and the grid is not unmounted.
- Component: card hover/focus toggles the revealed state without changing the
  card's bounding box.
- Manual: collapse/expand the sidebar in each mode; open a card, hit Back, and
  confirm the grid is where you left it after scrolling several pages; drive the
  whole loop from the keyboard in cards and magazine; toggle reduced motion.

## Open questions

- Should list/compact also gain the browse -> read -> back flow when the sidebar
  is collapsed and there is room for three columns? Assumed no: those modes keep
  list-beside-reader at every width above `lg`.
- Magazine hero: SPEC-010 rendered a hero item plus a grid. This spec's magazine
  is uniform wide rows with no hero. Confirm the hero is dropped (assumed yes,
  since the user described "each article on its own row").
