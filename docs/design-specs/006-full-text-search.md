# SPEC-006: Full-text search (Postgres tsvector)

- **Status:** Done
- **Phase:** 2
- **Depends on:** SPEC-003
- **Estimated size:** M

## Context

`GET /api/articles` (`apps/api/src/routes/articles.ts`) already accepts a `q`
param through `articleQuerySchema` (`packages/shared/src/schemas/article.ts`,
`q: z.string().min(1).max(200).optional()`), but the route ignores it: the body
carries the literal placeholder

```ts
// TODO: query.q -> Postgres full-text search over title + content.
```

SPEC-003 turns the same route into a real keyset-paginated list ordered by
`(coalesce(published_at, fetched_at), id)`, adds the cursor helpers in
`apps/api/src/lib/cursor.ts`, and wires the `unread` / `starred` / `feedId` /
`folderId` filters and subscription scoping. This spec makes `q` actually
search and reconciles relevance ordering with that keyset.

The database is Postgres 17 (`postgres:17-alpine`, see
`docker/docker-compose.yml`), so `websearch_to_tsquery`, generated `STORED`
columns, and GIN indexing are all available with no extension. Migrations live
in `apps/api/drizzle` and are applied at container start by
`apps/api/src/db/migrate.ts` (the `drizzle-orm/postgres-js` migrator reading
`drizzle/meta/_journal.json`); `pnpm db:generate` emits new ones.

Two article fields already exist and are searchable as-is: `articles.title` and
`articles.author`. The article body lives in `articles.contentHtml` (HTML,
sanitized at ingestion by SPEC-001) and `articles.summary`. Searching HTML
directly would index tag names and attributes, so this spec adds a
tag-stripped `contentText` column populated at ingestion and drives a generated
`tsvector` off it.

## Goal

A user types a query into the article list and gets back only articles from
their own subscriptions whose title, body, or author match, ranked by
relevance, still combinable with the `unread` / `starred` / `feedId` /
`folderId` filters from SPEC-003. Clearing the query returns to the normal
chronological SPEC-003 list.

## Non-goals

- Search suggestions, autocomplete, or saved searches.
- Searching feeds the user is not subscribed to. Subscription scoping from
  SPEC-003 is preserved verbatim.
- Fuzzy / typo-tolerant matching (`pg_trgm`, trigram similarity). Only
  dictionary-based `websearch_to_tsquery('english', ...)` is used here.
- Match highlighting (`ts_headline` snippets) in the result list. Noted as a
  follow-up in Open questions.
- A `COUNT(*)` of total matches for display. The UI derives an approximate
  count from loaded pages (see Web / UI changes).
- Combining relevance ranking with chronological `sort`. In search mode `sort`
  is ignored; see the ordering tradeoff in API changes.

## Data model changes

Two changes to the `articles` table in `apps/api/src/db/schema.ts`.

### 1. `contentText` - tag-stripped body text (nullable)

Add a plain nullable column, declared next to `contentHtml`:

```ts
contentText: text(),
```

In SQL this is `content_text text` (camelCase maps to snake_case via
`casing: 'snake_case'`). It holds the tag-stripped plain text of the sanitized
`contentHtml`, falling back to `summary` for feeds that ship only a summary.
Populating it at ingestion (see Implementation notes) means search never has to
strip HTML at query time.

### 2. `searchVector` - generated, stored `tsvector` with a GIN index

`drizzle-orm` (v0.32+) models generated `tsvector` columns through a
`customType` plus `.generatedAlwaysAs(...)`, and `drizzle-kit` emits the
`GENERATED ALWAYS AS (...) STORED` clause and the GIN index. Declare a
`tsvector` custom type once at the top of `schema.ts`:

```ts
import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// tsvector is not a first-class Drizzle column type; declare it once.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});
```

Then add the column and its GIN index to the `articles` table. Use the thunk
form of `generatedAlwaysAs` so the self-references to `articles.*` resolve
lazily:

```ts
export const articles = pgTable('articles', {
  // ...existing columns: id, feedId, guid, url, title, author,
  // contentHtml, summary, publishedAt, fetchedAt, plus the SPEC-001
  // sanitizedAt / sanitizerVersion columns...
  contentText: text(),
  // Managed as a generated STORED column; never written by app code.
  searchVector: tsvector('search_vector').generatedAlwaysAs(
    (): SQL =>
      sql`setweight(to_tsvector('english', coalesce(${articles.title}, '')), 'A') || ` +
      sql`setweight(to_tsvector('english', coalesce(${articles.contentText}, '')), 'B') || ` +
      sql`setweight(to_tsvector('english', coalesce(${articles.author}, '')), 'C')`,
  ),
}, (t) => [
  uniqueIndex('articles_feed_guid_key').on(t.feedId, t.guid),
  index('articles_feed_published_idx').on(t.feedId, t.publishedAt),
  // SPEC-003 also adds articles_sort_key_idx here.
  index('articles_search_vector_idx').using('gin', t.searchVector),
]);
```

`SQL` and `sql` come from `drizzle-orm`; `customType`, `index`, and
`uniqueIndex` from `drizzle-orm/pg-core`. (If concatenating `sql` fragments with
`+` is awkward in the real file, write the expression as one `sql` template
literal - the SQL it must produce is fixed below.)

**Weighting.** `title` is weight `A` (strongest), the body `contentText` is
weight `B`, and `author` is weight `C`. This satisfies the "title A, body B"
requirement and still makes an author-name query surface that author's
articles, without letting a common author name outrank a genuine title or body
match. Weights are trivially retunable later by editing the expression and
re-issuing the migration.

### Migration

Run `pnpm db:generate` from `apps/api` after editing the schema. Drizzle-kit
emits the next-numbered file into `apps/api/drizzle` (call it
`NNNN_<slug>.sql`, where `NNNN` is the next free 4-digit prefix after the files
already committed - do not assume a fixed number; SPEC-001 and SPEC-003 also
add migrations) and updates `drizzle/meta/_journal.json` and the snapshot for
you. **Open the emitted SQL and confirm it contains exactly** the generated
column and the GIN index (Drizzle's identifier quoting and
`--> statement-breakpoint` separators, matching `0000_lying_maginty.sql`):

```sql
ALTER TABLE "articles" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "articles"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("content_text", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("author", '')), 'C')
  ) STORED;--> statement-breakpoint
CREATE INDEX "articles_search_vector_idx" ON "articles" USING gin ("search_vector");
```

Adding a `GENERATED ... STORED` column rewrites the table once (existing rows
get `search_vector` computed immediately, from `title` and `author` only, since
`content_text` is still `NULL` until the backfill runs). On a large table this
is a one-time, blocking `ALTER`; acceptable for a self-hosted single-node
deploy, but note it in the migration.

**Keeping Drizzle in sync.** The `searchVector` declaration in `schema.ts` is
the single source of truth: because the column is declared with
`.generatedAlwaysAs(...)`, drizzle-kit records the full generated expression in
`drizzle/meta/<n>_snapshot.json`, so subsequent `pnpm db:generate` runs see no
drift and never try to "fix" or drop the `GENERATED` clause. Do not ever
declare `searchVector` as a plain `tsvector('search_vector')` without the
generated expression: drizzle-kit would then diff it as a normal column and
emit an `ALTER COLUMN` that strips the generation.

**Fallback if drizzle-kit mis-emits the ADD COLUMN.** Some drizzle-kit versions
are weak at adding a `GENERATED STORED` column to an existing table and may
emit a plain `ADD COLUMN "search_vector" tsvector` (no generation) or omit it.
If the emitted SQL is not exactly the block above, hand-edit that one statement
in the emitted migration file to match the block above, and leave the generated
snapshot untouched - the snapshot already models the column correctly (from the
schema declaration), so future diffs stay clean. Do not split it into a
separately hand-journaled file; editing the emitted statement keeps
`_journal.json` and the snapshot consistent for free.

## API changes

`articleQuerySchema` already declares `q`, `cursor`, `sort`, and `limit` - no
shared-schema change. All changes are in `apps/api/src/routes/articles.ts`,
inside the existing `GET /articles` handler, layered on top of SPEC-003.

Let `isSearch = query.q !== undefined`. When `isSearch`:

```ts
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

const tsQuery = sql`websearch_to_tsquery('english', ${query.q})`;
// Cast to float8 so the keyset comparison below is exact and stable
// (ts_rank returns real/float4).
const rankExpr = sql<number>`ts_rank(${articles.searchVector}, ${tsQuery})::float8`;
filters.push(sql`${articles.searchVector} @@ ${tsQuery}`);
```

`websearch_to_tsquery` (not `plainto_tsquery`) is used because it understands
`"exact phrase"`, `-exclude`, and `OR`, and never throws on malformed input. A
query that reduces to no lexemes (only stopwords or punctuation) yields an empty
tsquery that matches nothing, so the handler returns `{ items: [], nextCursor:
null }` rather than erroring.

Subscription scoping (`inArray(articles.feedId, feedIds)`), the
`unread` / `starred` / `feedId` / `folderId` resolution, and the empty-feed-set
early return are all unchanged from SPEC-003 and compose as additional `AND`
predicates alongside `@@`.

**Selecting rank for the cursor.** In search mode add the rank to the select so
the handler can read the last row's rank to build the cursor, then strip it
before returning (the response item shape and the shared `Article` type stay
exactly as SPEC-003 defines them):

```ts
const rows = await db
  .select({
    id: articles.id,
    feedId: articles.feedId,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    publishedAt: articles.publishedAt,
    read: sql<boolean>`coalesce(${articleStates.read}, false)`,
    starred: sql<boolean>`coalesce(${articleStates.starred}, false)`,
    ...(isSearch ? { _rank: rankExpr } : {}),
  })
  // ...leftJoin(articleStates ...), .where(and(...filters))
  .orderBy(
    isSearch
      ? sql`${rankExpr} desc, ${articles.id} desc`
      : /* SPEC-003 chronological order */ desc(articles.publishedAt),
  )
  .limit(query.limit);
```

### Ordering tradeoff (explicit)

SPEC-003 keyset-paginates on `(coalesce(published_at, fetched_at), id)`.
`ts_rank` is not monotonic with the publish date, so relevance and chronology
cannot share one cursor. When `q` is present the route switches pagination mode
rather than forcing them together:

- **Order** is `ts_rank(...) DESC, id DESC`. A title match ranks above a
  body-only match, all else equal (weight A vs B). `id DESC` breaks ties on
  equal rank so the total order is stable and deterministic.
- **`sort` is ignored while `q` is present.** Documented in the route comment;
  a future `sort=newest&q=...` combination is out of scope here.
- **Cursor** becomes a rank keyset. Because `_rank` is a computed float and not
  a stored column, the tiebreak comparison repeats the rank expression:

  ```ts
  filters.push(
    sql`(${rankExpr}, ${articles.id}) < (${cursor.r}::float8, ${cursor.id}::uuid)`,
  );
  ```

  Both tuple positions are type-matched (`float8`, `uuid`); with both sort keys
  DESC, "the next page" is exactly the rows tuple-less-than the cursor.
- **Capped depth.** Deep, rank-ordered keyset paging re-scans the full match
  set on every page (the GIN index accelerates `@@` but not the `ts_rank`
  cutoff), a known Postgres FTS trap. Cap total search results at
  `SEARCH_RESULT_CAP = 500` rows (10 pages at `limit=50`). Carry a running seen
  count in the cursor and return `nextCursor: null` at the cap even if more rows
  match. `_rank` is used for ordering and the cursor only; it never appears in
  the response items.

### Cursor helpers

SPEC-003 owns `apps/api/src/lib/cursor.ts` with the chronological
`encodeCursor(sortKey: Date, id)` / `decodeCursor` (base64url JSON `{ t, id }`,
returning `null` on any malformed input). Add a parallel pair for search mode in
the same file:

```ts
// Search-mode cursor: relevance rank + id tiebreak + running seen-count
// (for the SEARCH_RESULT_CAP). Same base64url-JSON, null-on-garbage contract.
export function encodeSearchCursor(rank: number, id: string, seen: number): string;
export function decodeSearchCursor(cursor: string): { r: number; id: string; n: number } | null;
```

`decodeSearchCursor` returns `null` for bad base64, bad JSON, or missing/
wrong-typed fields, exactly like `decodeCursor`. The route picks the decoder by
mode and rejects a mismatched cursor as a 400 (Zod re-check of the decoded
shape, not a 500): a chronological cursor sent with `q` fails
`decodeSearchCursor`, and a search cursor sent without `q` fails `decodeCursor`.

### Building `nextCursor` in search mode

```ts
const CAP = 500; // SEARCH_RESULT_CAP
const items = rows.map(({ _rank, ...r }) => r); // strip _rank from the response
const seen = (cursor?.n ?? 0) + rows.length;
const last = rows.at(-1);
const nextCursor =
  isSearch && last && rows.length === query.limit && seen < CAP
    ? encodeSearchCursor(last._rank as number, last.id, seen)
    : isSearch
      ? null
      : /* SPEC-003 chronological nextCursor logic */ null;
return { items, nextCursor } satisfies Paginated<(typeof items)[number]>;
```

## Web / UI changes

- A debounced (~300ms) search `<input>` in the article list pane header
  (wherever SPEC-003 places its filter bar), bound to the active `q` and folded
  into the TanStack Query key. Debounce so each keystroke does not fire a
  request; commit `q` to the query key only after the pause.
- Adding `q` to the `useInfiniteQuery` key (SPEC-003's
  `['articles', filters]`, extended with `q`) starts a fresh page 1 and resets
  the cursor chain, exactly as any other filter change does in SPEC-003. Same
  list renderer, same hook, different params - there is no separate "search
  mode" component.
- While `q` is non-empty, show the literal query (e.g. `Results for "quantum"`)
  and an approximate result count derived from loaded pages: `data.pages
  .flatMap(p => p.items).length`, suffixed with `+` while `hasNextPage` is true
  (and thus capped-page-aware, since the API returns `nextCursor: null` at the
  cap). No extra `COUNT(*)` request just for display.
- Clearing the input removes `q` from the query key, reverting to the normal
  SPEC-003 chronological keyset list with no reload flicker beyond the key
  change.
- The existing `unread` / `starred` / `feedId` / `folderId` filter pills stay
  active while searching and re-run the search when toggled (they are part of
  the same query key).

## Implementation notes

Do the work in this order.

1. **Text extraction helper.** Add `extractText(html: string): string` to
   `apps/api/src/lib/sanitize.ts` (created by SPEC-001, already imported by the
   worker and the resanitize script). Reuse the `sanitize-html` dependency
   SPEC-001 added, with `{ allowedTags: [], allowedAttributes: {} }`, then
   collapse whitespace. No new dependency.

2. **Ingestion.** In `apps/api/src/worker/poll.ts`, inside the
   `parsed.items.map(...)` callback, after SPEC-001 computes the sanitized
   `contentHtml`, derive `contentText`. Prefer the body, fall back to the
   summary so summary-only feeds (very common) remain searchable:

   ```ts
   const cleanHtml = raw ? sanitizeArticleHtml(raw, baseUrl) : null;
   const contentText = cleanHtml
     ? extractText(cleanHtml)
     : (item.contentSnippet ?? item.summary)
       ? extractText(item.contentSnippet ?? item.summary ?? '')
       : null;
   // ...contentHtml: cleanHtml, contentText, ...
   ```

   `searchVector` is `STORED GENERATED`; it recomputes automatically whenever
   `title` / `author` / `content_text` are written, so the insert never sets it.

3. **Backfill.** Add `apps/api/src/scripts/backfill-search-text.ts`, mirroring
   SPEC-001's `resanitize.ts` (keyset over the `id` uuid, batched). It selects
   rows where `content_text IS NULL`, derives `content_text` from the already
   sanitized `content_html` (falling back to `summary`), and `UPDATE`s in
   place; the generated `search_vector` recomputes per updated row. Run once
   after the migration:

   ```
   pnpm --filter @rss/api exec tsx src/scripts/backfill-search-text.ts
   ```

   `search_vector` itself needs no backfill of its own.

4. **Route.** Implement the search branch as above, on top of the SPEC-003
   handler. Import `SEARCH_RESULT_CAP` as a local const.

5. **Web.** Debounced input, query-key wiring, result header, count.

Security: `q` is validated by `articleQuerySchema` (1-200 chars) and passed only
as a bound parameter to `websearch_to_tsquery`, never string-concatenated into
SQL - no injection surface. Subscription scoping is unchanged, so search cannot
reach articles from feeds the caller is not subscribed to.

## Acceptance criteria

- [ ] `articles.contentText` (nullable `text`) and `articles.searchVector`
      exist; `search_vector` is a `GENERATED ALWAYS AS (...) STORED` `tsvector`
      with a GIN index (`articles_search_vector_idx`), applied via a committed
      migration in `apps/api/drizzle`, and `pnpm db:generate` reports no drift
      afterward.
- [ ] `contentText` is populated at ingestion (tag-stripped body, falling back
      to summary) and by the backfill for pre-existing rows.
- [ ] `GET /api/articles?q=...` returns only matching articles, scoped to the
      requesting user's subscriptions; a match from a feed the user is not
      subscribed to never appears.
- [ ] Results are ordered by `ts_rank` descending; a title-only match ranks
      above a body-only match, all else equal; an author-name query surfaces
      that author's articles.
- [ ] `q` composes correctly with `unread`, `starred`, `feedId`, and
      `folderId`, individually and in combination.
- [ ] `sort` is ignored while `q` is present (relevance order), and the route
      comment says so.
- [ ] Omitting `q` (or clearing it in the UI) behaves exactly as the plain
      SPEC-003 chronological list.
- [ ] Search-mode pagination advances via the `(rank, id)` cursor, returns
      disjoint correctly ordered pages, and terminates with `nextCursor: null`
      at `SEARCH_RESULT_CAP` (500) without erroring.
- [ ] A chronological cursor sent with `q`, or a search cursor sent without
      `q`, is rejected as a 400, not a 500.
- [ ] A query that reduces to no lexemes (e.g. `the a of`) returns
      `{ items: [], nextCursor: null }` rather than an error.
- [ ] `"exact phrase"` and `-exclude` syntax behave as `websearch_to_tsquery`
      documents.
- [ ] Against a large seeded table (10k+ articles) the query uses the GIN index
      (`EXPLAIN` shows a bitmap index scan on `articles_search_vector_idx`, not
      a sequential scan).

## Testing

- **Unit (query building).** Assert the `websearch_to_tsquery` predicate, the
  `ts_rank(...)::float8` rank expression, and the `ts_rank DESC, id DESC` order
  are added only when `q` is present, and that `sort` is dropped in that branch.
- **Unit (cursor).** `encodeSearchCursor` / `decodeSearchCursor` round-trip
  (`{ r, id, n }`); `decodeSearchCursor` returns `null` for garbage base64,
  valid base64 with invalid JSON, and valid JSON missing or mistyping `r` / `id`
  / `n`; a chronological `{ t, id }` cursor fails `decodeSearchCursor` and vice
  versa.
- **Integration (DB-backed, in the SPEC-003 `articles.test.ts` style).** Seed
  articles with distinct title / body / author matches and assert ranking order
  (title match ahead of body-only). Assert a search never returns a matching
  article from a feed the user is not subscribed to. Assert `q` combined with
  each filter and with several filters at once. Assert phrase (`"foo bar"`) and
  exclusion (`foo -bar`) queries. Assert an all-stopword query returns empty.
  Assert pagination across 3+ pages returns disjoint, correctly ordered items
  and terminates at the 500-row cap (seed 600+ matches, walk with a small
  `limit`, confirm `nextCursor: null` at the cap and no duplicates or gaps).
  Assert a mismatched cursor yields 400.
- **Manual / performance.** Seed 10k+ articles and confirm `EXPLAIN ANALYZE` on
  the search query hits `articles_search_vector_idx` (bitmap index scan), not a
  sequential scan. Confirm the backfill populates `content_text` and that
  `search_vector` recomputes (a body-word search matches a backfilled row).

## Open questions

- `ts_headline` snippet highlighting in the result list is deferred to a likely
  follow-up spec, not this one.
- The English dictionary (`to_tsvector('english', ...)`) is hard-coded. A
  future per-user or per-feed language setting (SPEC-011) could parameterize the
  regconfig, but that would change the generated column and force a migration,
  so it is out of scope here.
