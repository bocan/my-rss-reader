# SPEC-010: Reading list views - cards / list / magazine / compact

- **Status:** Done
- **Phase:** 2
- **Depends on:** SPEC-003
- **Estimated size:** M

## Context

SPEC-003 makes the article list real: `use-articles.ts` exposes an
`useInfiniteQuery` keyed on `['articles', filters]`, and `ReaderPage.tsx`
renders one plain row per article in the middle `<section>` with an
`IntersectionObserver` sentinel driving `fetchNextPage()`. That single layout
was explicitly "enough to prove the pagination" and deferred richer renderings
here. `packages/shared/src/types.ts` already declares the target modes:
`VIEW_MODES = ['cards', 'list', 'magazine', 'compact']` and the `ViewMode`
type. SPEC-008 (keyboard nav) adds a selected-article index over that same flat
list. This spec turns the one layout into four interchangeable presentational
components fed by the same query data, plus a switcher, without touching the
API's pagination contract.

The one data gap: cards and magazine need a per-article image, and `articles`
has no image column today. This spec adds it.

## Goal

The user can switch the article list between four views (list, compact, cards,
magazine) from a control in the list header. The choice persists across
reloads, every view scrolls infinitely and keeps the current selection, and
cards/magazine show a thumbnail (with a graceful fallback when an article has
no image). Cards and magazine reflow to a single column on mobile.

## Non-goals

- Server-persisted view preference and per-folder overrides - SPEC-011. This
  spec persists to `localStorage` only and leaves a note where SPEC-011 takes
  over.
- The reading pane and article body view modes (`ARTICLE_VIEWS`) - SPEC-004.
  "Views" here means only how the *list* renders, not the article body.
- Any change to `GET /articles` ordering, filtering, or the cursor - SPEC-003
  owns that. This spec only adds a field to each item's shape.
- Backfilling `imageUrl` for already-stored articles - the column is populated
  going forward by the fetch path; a backfill is optional and out of scope.

## Data model changes

Add one nullable column to `articles` (`apps/api/src/db/schema.ts`):

```ts
// articles table
imageUrl: text(),
```

Nullable, no index (it is only ever read alongside the row, never filtered or
sorted on). Run `pnpm db:generate` from `apps/api`, review the emitted
`ALTER TABLE ... ADD COLUMN` in `apps/api/drizzle`, and commit it. Existing
rows keep `imageUrl = null` and rely on the fallback described below.

`GET /articles` must add `imageUrl` to each item it selects/returns; extend the
item type in `use-articles.ts` accordingly. No new route or query param.

## API changes

None to routes, params, or the cursor. The only wire change is the extra
`imageUrl: string | null` field on each article item in the `GET /articles`
response, which flows through unchanged pagination.

Image extraction happens in the worker/feed-fetch path (`apps/api/src/worker`,
alongside the SPEC-001 sanitize step), computed once when an article is first
inserted and stored on the row. Resolution order, first hit wins:

1. First suitable `<img>` in the sanitized `contentHtml` - skip tracking-pixel
   sized / 1x1 / data-URI spacers; take the first with a usable `src`.
2. Feed enclosure or `media:content` / `media:thumbnail` URL for the entry, if
   the parser exposes one.
3. `og:image` from the article's `url` - only if cheap to obtain; do not add a
   blocking per-article HTTP fetch to the poll loop for this. If the fetch
   pipeline already retrieves the page (e.g. for readability), reuse it;
   otherwise skip and leave `null`.

Resolve to an absolute URL against the article `url`/feed `siteUrl`. Store
`null` when nothing qualifies. This runs inside the existing insert path, so it
adds no new route and no new external dependency beyond what SPEC-001 pulls in.

## Web / UI changes

All new code lives in `apps/web/src/components/reader/`. Data still comes from
the single SPEC-003 `useInfiniteQuery`; these are presentational only.

- **Shared item logic** - `use-article-row.ts`: a hook/helper taking a raw
  article item and returning the derived, view-agnostic fields every layout
  needs: display title, feed name + `faviconUrl`, relative time (`published-at`
  formatting), `isRead`, `isStarred`, `href`/select handler, and a resolved
  `thumbnail` (see fallback below). Each view component consumes this so the
  read/star/relative-time rules live in one place.
- **Thumbnail + fallback** - `ArticleThumbnail.tsx`: renders `imageUrl` when
  present with `loading="lazy"` and `decoding="async"`, fixed aspect ratio, and
  `object-cover`. On `null` or an `onError`, fall back in order: the feed's
  `faviconUrl`, else a generated placeholder (deterministic tint from the feed
  id + the title's first initial). Never render a broken-image icon.
- **Four view components**, each mapping over the flattened
  `data.pages.flatMap(p => p.items)`:
  - `ListView` (dense one-line rows): title, feed name, relative time, and
    read/star affordances on a single line; unread rows weighted, read rows
    muted. No thumbnail. This replaces the SPEC-003 plain row as the default.
  - `CompactView` (title-only, very dense): title per line, minimal padding,
    small unread dot + star only; for scanning long lists fast.
  - `CardsView`: vertical stack of cards, each with `ArticleThumbnail` +
    title + excerpt (from `summary`) + meta line (feed, time, star). One column
    on mobile, comfortable single column in the list pane's width.
  - `MagazineView`: a hero item (first article, larger thumbnail + excerpt)
    followed by a responsive grid of larger-thumbnail cards
    (`grid-cols-1 sm:grid-cols-2` within the pane), collapsing to a single
    column on mobile.
- **Switcher** - `ViewSwitcher.tsx` in the list-pane header: a 4-way segmented
  control (shadcn/ui toggle group) with a `lucide-react` icon per mode
  (`List`, `Rows`/`AlignJustify`, `LayoutGrid`, `Newspaper`), `aria-label` per
  option and `aria-pressed` state. Selecting a mode updates the persisted view.
- **View state** - `use-list-view.ts`: reads/writes the active `ViewMode` in
  `localStorage` under `reader.listView`, validated against `VIEW_MODES` on
  read (fall back to `'list'` for a missing/invalid value). Exposes
  `[view, setView]`. Add a one-line note: SPEC-011 replaces this with a
  server-persisted preference plus a per-folder override, so keep the
  read/write behind this hook so only the hook changes then.
- **`ReaderPage.tsx` wiring**: keep the existing scroll container, sentinel,
  spinner row, empty state, and end-of-list marker from SPEC-003; swap the
  hard-coded row map for `<CurrentView />` chosen by `view`. The
  `IntersectionObserver` sentinel and the SPEC-008 selection index sit *outside*
  the switched view so both survive a view change with no refetch and no scroll
  jump.

Responsive: cards and magazine multi-column layouts use Tailwind breakpoints
and collapse to `grid-cols-1` at the mobile breakpoint. List and compact are
already single-column. Design tokens (`bg-accent`, `text-muted-foreground`,
borders) come from `src/index.css`; no new tokens.

## Implementation notes

- Order of work: schema column + migration and the worker extraction first
  (so real `imageUrl` values exist to build against), then `use-list-view.ts`
  and `ViewSwitcher`, then the shared `use-article-row.ts`, then the four view
  components, then `ReaderPage` wiring last.
- Selection is preserved by identity, not position: SPEC-008 keys selection to
  the article `id`, so a view swap re-renders the same list and keeps the
  selected id highlighted. Verify the switch does not remount the query or
  reset `fetchNextPage` state.
- No new runtime dependency: relative-time formatting reuses whatever SPEC-003
  used for the plain row; the placeholder is a CSS/inline-SVG data-URI, not an
  image library.
- Security: `imageUrl` is stored from feed-controlled content. It is only ever
  used as an `<img src>` (SPEC-001 sanitization already governs `contentHtml`);
  still validate it is an `http(s)` absolute URL before storing, and let the
  `onError` fallback cover anything that fails to load. Never interpolate it
  into HTML or a CSS `url()` without escaping.
- Excerpt text comes from `summary` (already sanitized/plain per SPEC-001);
  clamp with CSS line-clamp, do not render `contentHtml` in the list.

## Acceptance criteria

- [ ] The list header shows a 4-way switcher; selecting each of list, compact,
      cards, magazine re-renders the visible list in that layout without a
      network refetch.
- [ ] Cards and magazine each collapse to a single column at the mobile
      breakpoint and show multiple columns / hero + grid above it.
- [ ] An article with a real `imageUrl` shows its thumbnail in cards/magazine;
      an article with `imageUrl = null` shows the feed favicon, and one whose
      image fails to load falls back to the generated placeholder - never a
      broken-image icon.
- [ ] List thumbnails use `loading="lazy"`; offscreen images are not fetched
      until scrolled near.
- [ ] Scrolling to the bottom in any of the four views loads the next page via
      the same infinite-scroll sentinel, with no duplicate or skipped rows.
- [ ] Selecting an article (SPEC-008) and switching views keeps the same
      article selected and highlighted, with no scroll jump.
- [ ] The chosen view persists across a full page reload; a
      missing/corrupt `reader.listView` value falls back to `list`.
- [ ] Each view renders the SPEC-003 empty state when the filter yields zero
      articles.

## Testing

- Unit: `use-list-view` reads a valid stored value, ignores an invalid one
  (falls back to `list`), and writes on change; `use-article-row` derives
  read/star/relative-time/thumbnail correctly for present-image, null-image,
  and read vs unread inputs.
- Unit: `ArticleThumbnail` renders `<img>` for a URL, favicon on null, and
  placeholder after an `onError`; asserts `loading="lazy"`.
- Unit: worker image extraction picks the first non-spacer `<img>`, then
  enclosure/`media:content`, then falls back to `null`; resolves relative to
  absolute; rejects non-http(s) values.
- Component/integration: render each of the four views over a seeded multi-page
  query; assert layout markers (single line vs card vs hero+grid) and that all
  four flatten the same items in the same order.
- Manual: with a real feed, switch all four views live, resize across the
  mobile breakpoint in cards and magazine, scroll several pages in each view,
  select an article then switch views, reload and confirm the view sticks, and
  view a feed whose articles have no images to confirm the fallback chain.

## Open questions

- Should compact and list expose the star/read toggles inline, or only surface
  them on hover/selection to stay dense? Assume hover/selection reveal for
  compact, always-visible for list; revisit if it feels noisy.
- Magazine hero selection is "first item in the current sort" for now. A
  future ranking (most images, freshest) is out of scope unless SPEC-011
  introduces a preference for it.
