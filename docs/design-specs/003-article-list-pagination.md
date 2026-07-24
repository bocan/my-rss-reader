# SPEC-003: Article list - keyset pagination and infinite scroll

- **Status:** Done
- **Phase:** 1
- **Depends on:** none
- **Estimated size:** M

## Context

`GET /articles` (`apps/api/src/routes/articles.ts`) is a stub. It resolves the
caller's subscribed `feedIds`, applies the `unread` / `starred` filters, orders
by `publishedAt desc`, takes `limit` rows, and always returns
`nextCursor: null`. `query.cursor`, `query.folderId`, and `query.q` are ignored
(the cursor and search cases are marked `TODO` in the route). Two correctness
gaps matter here:

1. It orders by `articles.publishedAt` alone, but `publishedAt` is **nullable**
   (`apps/api/src/db/schema.ts` line 115 - some feed entries have no parseable
   date). Null-published rows sort inconsistently and cannot be paginated
   safely.
2. There is no cursor, so the list can only ever show the first page.

`articleQuerySchema` (`packages/shared/src/schemas/article.ts`) already declares
`feedId`, `folderId`, `unread`, `starred`, `q`, `sort`, `cursor`, `limit`, so no
shared-schema change is needed. `articles` has one relevant index,
`articles_feed_published_idx` on `(feedId, publishedAt)` (schema line 119),
sized for a single feed's timeline, not a cross-feed "All items" view.
`fetchedAt` is `notNull().defaultNow()` (schema line 116), which is what makes
`COALESCE(publishedAt, fetchedAt)` a total, non-null sort key.

On the web side, `ReaderPage.tsx` renders a static `EmptyPane` in the
article-list `<section>`; nothing calls `GET /articles` yet. `apps/web/src/lib/api.ts`
already forwards an arbitrary query string and is unchanged by this spec. There
is no `apps/web/src/hooks/` directory yet; this spec creates it.

This spec makes the list real and paginated. Full-text search (`q`) stays out of
scope and is deferred to SPEC-006.

## Goal

`GET /articles` returns correctly ordered, filtered, keyset-paginated pages
scoped to the caller's subscriptions, and the article-list pane in `ReaderPage`
infinite-scrolls through them with no duplicate rows and no skipped rows across
page boundaries.

## Non-goals

- `q` full-text search. SPEC-006 owns the `tsvector` column and the query.
- Reading pane, article view modes, read / star mutations. SPEC-004, SPEC-005.
- Folder management UI. SPEC-007. This spec only makes `folderId` work as a list
  filter against existing subscription data.
- Alternate list renderings (cards / magazine / compact). SPEC-010. One plain
  list row is enough here to prove the pagination.

## Data model changes

Add one composite expression index to the `articles` table backing the keyset
order. This **is required**: the keyset ORDER BY uses
`coalesce(published_at, fetched_at)` across many feeds, and the existing
`articles_feed_published_idx` only helps single-feed, `published_at`-only scans.

In `apps/api/src/db/schema.ts`, add to the `articles` table's index list (the
array returned by the third `pgTable` argument, alongside
`articles_feed_published_idx`):

```ts
index('articles_sort_key_idx').on(
  sql`coalesce(${t.publishedAt}, ${t.fetchedAt}) desc`,
  t.id.desc(),
),
```

`sql` is already imported from `drizzle-orm` elsewhere in the repo; add it to the
schema file's imports if not present. `articles_feed_published_idx` stays: it
still serves single-feed timelines and the worker's dedup lookups.

Then run `pnpm db:generate` from `apps/api` and commit the emitted SQL under
`apps/api/drizzle`. **Verify the generated SQL** before committing. drizzle-kit
0.31.10 should emit an expression index equivalent to:

```sql
CREATE INDEX "articles_sort_key_idx" ON "articles"
  USING btree ((coalesce(published_at, fetched_at)) DESC, "id" DESC);
```

If the generated statement does not match that shape (expression indexes with a
mixed raw-`sql` expression plus a column are a known rough edge in drizzle-kit),
delete the generated statement for this index and hand-write exactly the SQL
above into the migration file. The double parentheses around `coalesce(...)` are
required by Postgres for an expression in an index column list.

No other schema changes.

## API changes

### `GET /articles` (existing route, real implementation)

Auth is unchanged: the route already runs under `{ preHandler: app.requireAuth }`
and reads `request.user!.id`.

**Effective sort key.** Define one effective sort key and use it identically in
the ORDER BY, the index, and the cursor comparison:
`coalesce(articles.published_at, articles.fetched_at)`. Because `fetched_at` is
`NOT NULL`, this expression is never null, so there is no `NULLS FIRST/LAST`
ambiguity and null-published rows sort by fetch time rather than sorting last.
Ordering is the tuple `(sortKey, id)`:

- `sort=newest` (default): both DESC.
- `sort=oldest`: both ASC.

`id` (a UUID primary key, therefore unique) is the tiebreaker, which makes the
tuple strictly unique. That uniqueness is what lets the keyset use a strict
comparison with no risk of dropping or duplicating a boundary row.

**Selecting the sort key.** The cursor is built from the last row's sort key, so
the query must select it. Add to the existing select map:

```ts
sortTs: sql<Date>`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`,
```

Strip `sortTs` from each item before returning (it is an internal field, not
part of the response contract).

**Cursor.** The cursor is an opaque base64url string, an implementation detail of
this route, not a client-facing contract. Its payload is the last returned row's
`{ t, id }` where `t` is the ISO string of that row's effective sort key. Add the
encode/decode helpers in a new file `apps/api/src/lib/cursor.ts`:

```ts
// apps/api/src/lib/cursor.ts
import { z } from 'zod';

const cursorPayloadSchema = z.object({
  t: z.string(),   // ISO timestamp of the row's effective sort key
  id: z.uuid(),
});
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

/** Encode the last row of a page into an opaque base64url cursor. */
export function encodeCursor(sortKey: Date, id: string): string {
  const json = JSON.stringify({ t: sortKey.toISOString(), id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode a cursor; returns null on any malformed input (never throws). */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

In the route, when `query.cursor` is present, decode it. A `null` result is a
bad cursor and must return **400**, not throw a 500:

```ts
let decoded: CursorPayload | null = null;
if (query.cursor) {
  decoded = decodeCursor(query.cursor);
  if (!decoded) {
    return reply.code(400).send({
      error: 'Bad Request',
      message: 'Invalid cursor',
      statusCode: 400,
    });
  }
}
```

(Add `reply` to the handler signature: `async (request, reply) => {...}`.)

**Keyset continuation (WHERE).** Use a single row-value comparison via Drizzle's
`sql` template so the tiebreak lives in one clause, matching how the route
already drops to `sql` for the `coalesce(...)` filters. Cast the cursor's id to
`uuid`; bind the timestamp as a `Date` so postgres-js sends it as `timestamptz`
(both sides of the row-value comparison must be the same composite type):

```ts
if (decoded) {
  const cursorTs = new Date(decoded.t);
  filters.push(
    query.sort === 'oldest'
      ? sql`(coalesce(${articles.publishedAt}, ${articles.fetchedAt}), ${articles.id}) > (${cursorTs}, ${decoded.id}::uuid)`
      : sql`(coalesce(${articles.publishedAt}, ${articles.fetchedAt}), ${articles.id}) < (${cursorTs}, ${decoded.id}::uuid)`,
  );
}
```

`(a, b) < (c, d)` in Postgres means `a < c OR (a = c AND b < d)`, which is
exactly the correct keyset predicate. Use `>` for `sort=oldest`.

**ORDER BY.** Match the index expression exactly so the planner can use
`articles_sort_key_idx`:

```ts
const sortKey = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;
// ...
.orderBy(
  query.sort === 'oldest'
    ? sql`${sortKey} asc, ${articles.id} asc`
    : sql`${sortKey} desc, ${articles.id} desc`,
)
```

**Page size and `nextCursor` (limit + 1 peek).** Fetch `query.limit + 1` rows.
If more than `limit` came back there is a next page; drop the extra row and build
the cursor from the last **kept** row. Otherwise this is the final page and
`nextCursor` is `null`. This makes `nextCursor` null exactly on the true last
page even when the total is an exact multiple of `limit` (no wasted empty
request):

```ts
.limit(query.limit + 1);

const hasMore = pageRows.length > query.limit;
const kept = hasMore ? pageRows.slice(0, query.limit) : pageRows;
const last = kept.at(-1);
const nextCursor = hasMore && last ? encodeCursor(last.sortTs, last.id) : null;
const items = kept.map(({ sortTs, ...rest }) => rest);
return { items, nextCursor } satisfies Paginated<(typeof items)[number]>;
```

**Filters**, all applied before the keyset WHERE (the keyset predicate is just
another entry pushed onto the same `filters` array):

- **Feed set resolution** (the per-user scoping step, kept as today). Resolve the
  caller's feed ids from `subscriptions`, always scoped by `subscriptions.userId`,
  narrowed by the optional `feedId` and `folderId`. Build the subscriptions WHERE
  from these parts:
  - always: `eq(subscriptions.userId, userId)`
  - `feedId` present: `eq(subscriptions.feedId, query.feedId)`
  - `folderId` present: `eq(subscriptions.folderId, query.folderId)`

  Folders are per-user and this resolution is always `userId`-scoped, so there is
  no cross-user leakage and the main `articles` query never needs `userId` except
  in the `article_states` join. If both `feedId` and `folderId` are sent they
  narrow together (feed within that folder) rather than erroring; the UI never
  sends both today. If the resolved feed set is empty, return
  `{ items: [], nextCursor: null }` without querying `articles`, as today.
- **`unread`** - unchanged. Left join `article_states` on
  `(articleId = articles.id AND userId = caller)`; a missing row means unread:
  `coalesce(article_states.read, false) = ${!query.unread}`.
- **`starred`** - unchanged: `coalesce(article_states.starred, false) = true`.
- **`sort`** - drives both the ORDER BY direction and the cursor comparison sign,
  as above.

**Response shape** stays `Paginated<T>` (`{ items, nextCursor }`) with each item
carrying the columns the stub already selects: `id`, `feedId`, `title`, `url`,
`author`, `summary`, `publishedAt`, `read`, `starred` (with `sortTs` stripped).

### `packages/shared`

No change. `articleQuerySchema` already declares every field this route reads,
`limit` already coerces, caps at 100, and defaults to 50, and `Paginated<T>` is
already exported from `packages/shared/src/types.ts`. The cursor helpers live in
`apps/api` on purpose: the cursor format is server-internal and must not leak
into the shared client contract.

## Web / UI changes

- `apps/web/src/lib/api.ts` - no changes. `api<T>()` already takes an arbitrary
  path-plus-query string and includes credentials.

- **New hook** `apps/web/src/hooks/use-articles.ts` (create the `hooks/`
  directory). `useInfiniteQuery` keyed on the active filters so a filter change
  produces a new query key and a fresh page 1:

  ```ts
  import { useInfiniteQuery } from '@tanstack/react-query';
  import type { Paginated } from '@rss/shared';
  import { api } from '@/lib/api';

  export interface ArticleListItem {
    id: string;
    feedId: string;
    title: string | null;
    url: string | null;
    author: string | null;
    summary: string | null;
    publishedAt: string | null;
    read: boolean;
    starred: boolean;
  }

  export interface ArticleFilters {
    feedId?: string;
    folderId?: string;
    unread?: boolean;
    starred?: boolean;
    sort: 'newest' | 'oldest';
  }

  function buildQuery(filters: ArticleFilters, cursor: string | null): string {
    const params = new URLSearchParams();
    if (filters.feedId) params.set('feedId', filters.feedId);
    if (filters.folderId) params.set('folderId', filters.folderId);
    if (filters.unread !== undefined) params.set('unread', String(filters.unread));
    if (filters.starred) params.set('starred', 'true');
    params.set('sort', filters.sort);
    if (cursor) params.set('cursor', cursor);
    return `?${params.toString()}`;
  }

  export function useArticles(filters: ArticleFilters) {
    return useInfiniteQuery({
      queryKey: ['articles', filters],
      queryFn: ({ pageParam }) =>
        api<Paginated<ArticleListItem>>(`/articles${buildQuery(filters, pageParam)}`),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    });
  }
  ```

  Because the query key includes `filters`, changing any filter is a distinct
  cache entry that starts from `initialPageParam` (`null`); no `pageParam` from
  the previous filter can leak in.

- **`ReaderPage.tsx`** - replace the static `EmptyPane` inside the article-list
  `<section>` with the rendered, paginated list. Drive it from `useArticles`
  with the currently active filters (for this spec, the sidebar's "All items" ->
  `{ sort: 'newest' }` and "Starred" -> `{ starred: true, sort: 'newest' }`;
  clicking a feed row sets `feedId`). Flatten pages with
  `data.pages.flatMap((p) => p.items)` and render one plain row per article
  (title, feed name, published date, and a read/unread affordance). Full styling
  is SPEC-004 / SPEC-010's job; a plain row is enough here.

  Required list states:
  - **Loading skeleton** for the initial fetch (`isLoading`).
  - **Empty state** when the flattened list is empty and not loading.
  - **Spinner row** while `isFetchingNextPage`.
  - **End-of-list marker** when `!hasNextPage` and at least one page has loaded.

- **Infinite scroll.** After the last row render a sentinel `<div>` and observe
  it with `IntersectionObserver` (a small inline hook - no new dependency). Call
  `fetchNextPage()` when the sentinel enters view and
  `hasNextPage && !isFetchingNextPage`. Set the observer `root` to the list's own
  scroll container (the article-list `<section>`, which is already
  `overflow-y-auto`) so appending pages does not move the viewport. Sketch:

  ```tsx
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null); // the list <section>

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: rootRef.current, rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  ```

- **Scroll reset.** Scroll the list container to top only on a filter change
  (e.g. an effect keyed on the serialized filters), never on `fetchNextPage`, so
  appended pages do not jump the reader.

## Implementation notes

- Do the row-value keyset comparison with Drizzle's `sql` template, not the query
  builder; it mirrors how the route already expresses the `coalesce(...)`
  filters and keeps the ORDER BY, index, and WHERE using one identical
  expression.
- Keep the `feedIds` pre-resolution step (subscriptions -> feed id list). It is
  what makes per-user scoping trivially correct, so the main `articles` query
  never needs `userId` beyond the `article_states` join.
- `limit` already caps at 100 and defaults to 50 in `articleQuerySchema`; reuse
  it directly and fetch `limit + 1` for the peek. No new schema field.
- **Order of work** (each step is independently testable): (1) `cursor.ts` with
  unit tests (pure functions); (2) the route (feed resolution + filters + keyset
  + the new index); (3) the web hook; (4) the `ReaderPage` list render and
  sentinel last, since it depends on the route's real response shape.
- Security: the only cross-user surface is `article_states`; every other filter
  is gated by the `userId`-scoped subscription resolution. A malformed or
  forged cursor can never widen scope because it only constrains the ordering
  window within the already-scoped feed set, and a bad cursor returns 400.

## Acceptance criteria

- [ ] Scrolling the article list auto-loads subsequent pages with no duplicate
      and no skipped article, across 3+ pages of a feed with more than `limit`
      articles.
- [ ] `nextCursor` is `null` exactly on the true final page (including when the
      total is an exact multiple of `limit`); every non-final page returns a
      usable cursor.
- [ ] Changing `feedId`, `folderId`, `unread`, `starred`, or `sort` resets the
      list to page 1 (fresh query key, no carried-over cursor).
- [ ] `sort=newest` and `sort=oldest` each produce a stable total order with no
      article duplicated or missing across a full paginated walk.
- [ ] Articles from feeds the caller is not subscribed to never appear.
- [ ] An article with `publishedAt = null` appears exactly once, ordered by its
      `fetchedAt`, in both sort directions.
- [ ] `folderId` returns the union of articles from every feed the caller
      subscribes to under that folder, and only for the caller.
- [ ] A malformed `cursor` returns HTTP 400 (not 500).

## Testing

- **Unit** (`cursor.ts`): `encodeCursor` -> `decodeCursor` round-trips a
  `{ Date, uuid }` pair; `decodeCursor` returns `null` for garbage base64, for
  valid base64 that is not JSON, and for valid JSON missing `t` or `id` or with a
  non-uuid `id`.
- **Integration - continuity**: walk a full result set page-by-page with
  `limit=2` against 5+ seeded articles and assert the concatenation of pages
  equals a single `limit=100` call, for both `sort` values, with no duplicate or
  missing id.
- **Integration - boundaries**: exact multiple of `limit` (assert `nextCursor`
  is null only on the true final page and there is no trailing empty page); zero
  articles; exactly one article; a set mixing dated articles with at least one
  `publishedAt = null` (assert it appears once, positioned by `fetchedAt`).
- **Integration - filters and scoping**: each filter alone (`feedId`,
  `folderId`, `unread`, `starred`) and two combined (e.g. `folderId` + `unread`);
  seed a second user with their own subscriptions and articles and assert their
  rows never leak into the first user's results under any filter.
- **Integration - bad cursor**: a decodable-looking but invalid cursor string
  returns 400.
- **Manual**: subscribe to a feed with 100+ articles, scroll the web list to the
  end, confirm the end-of-list marker, the spinner row during fetches, and no
  visible duplicate rows or viewport jump as pages append.

## Open questions

- Should `folderId` include sub-folders (`folders.parentId` nesting) or only
  exact matches? Nesting exists in the schema but no spec defines its UI
  semantics yet (SPEC-007). This spec assumes exact `folderId` match only;
  revisit if SPEC-007 introduces nested-folder rollup.
