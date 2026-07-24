# SPEC-004: Article reading pane and article view modes

- **Status:** Done
- **Phase:** 1
- **Depends on:** SPEC-001 (HTML sanitization), SPEC-003 (article list: keyset pagination + selection)
- **Estimated size:** L

## Context

`apps/web/src/routes/ReaderPage.tsx` is a three-pane skeleton. Its grid is
`grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[260px_360px_minmax(0,1fr)]`.
The right-hand `<article>` is a static `EmptyPane` ("Select an article");
nothing renders an article when a list row is selected, and there is no
component or route that fetches or displays an article body.

The pieces this spec builds on already exist:

- `packages/shared/src/types.ts` exports
  `ARTICLE_VIEWS = ['simplified', 'readable', 'web'] as const` and the
  `ArticleView` type. This spec implements exactly those three modes.
- SPEC-001 guarantees that everything stored in `articles.contentHtml` is
  already sanitized and safe to render with `dangerouslySetInnerHTML`. This
  spec renders it directly and never re-sanitizes on the way out.
- SPEC-003 turns the middle `<section>` into a real article list and gives it
  a notion of a selected article id. This spec consumes that selection, owns
  the reading pane it opens into, and owns the responsive rule that swaps the
  list for a full-screen reader below `lg`.

The `articles` row today (verified in `apps/api/src/db/schema.ts`) has:
`id, feedId, guid, url, title, author, contentHtml, summary, publishedAt,
fetchedAt` (SPEC-001 adds `sanitizedAt`, `sanitizerVersion`). This spec adds
the two `readable*` columns below.

The API mounts every route group under `/api` (`apps/api/src/app.ts` registers
`registerRoutes` with `{ prefix: '/api' }`, and `articleRoutes` adds no further
prefix), so a handler declared as `app.get('/articles/:id', ...)` is served at
`GET /api/articles/:id`.

## Goal

Clicking an article in the list opens it in the reading pane and loads its full
sanitized content plus feed context and this user's read/starred state. The
user can switch between three views: **Simplified** (server-extracted main
content via Mozilla Readability), **Readable** (the feed's own sanitized
content with good typography), and **Web** (the original publisher page). At
`lg` and above the reader is a persistent third column; below `lg`, opening an
article pushes a full-screen reader with a back control instead of a third
column.

## Non-goals

- Marking an article read on open (mark-read-on-open) and star toggles from the
  pane: SPEC-005. This spec only *reads and displays* the read/starred state.
- Keyboard shortcuts to move between articles or switch views: SPEC-008.
- Persisting the user's default view or per-feed view preference: SPEC-011. The
  view switcher is local, in-memory state here.
- Offline caching of reader content: SPEC-013.
- Changing the article *list* rendering, pagination, or filters: SPEC-003 owns
  the list. This spec only consumes the selected id and the below-`lg` swap.

## Data model changes

Edit the `articles` table in `apps/api/src/db/schema.ts`. Add two nullable
columns immediately after `fetchedAt` (columns are declared camelCase and
mapped to snake_case by `casing: 'snake_case'`, so these become
`readable_html` and `readable_fetched_at` in SQL). `text` and `timestamp` are
already imported, so no new imports are needed:

```ts
export const articles = pgTable('articles', {
  // ...existing columns: id, feedId, guid, url, title, author,
  // contentHtml, summary, publishedAt, fetchedAt,
  // (and SPEC-001's sanitizedAt, sanitizerVersion)...
  readableHtml: text(),
  readableFetchedAt: timestamp({ withTimezone: true }),
}, (t) => [
  uniqueIndex('articles_feed_guid_key').on(t.feedId, t.guid),
  index('articles_feed_published_idx').on(t.feedId, t.publishedAt),
]);
```

- `readableHtml` (nullable `text`): cached, sanitized, Readability-extracted
  HTML for the Simplified view. `NULL` means either "never attempted" or
  "attempted but nothing usable was extracted" - disambiguated by the next
  column.
- `readableFetchedAt` (nullable `timestamptz`): set to `now()` whenever an
  extraction attempt runs, whether or not it produced content. So the two
  columns encode three states the client must distinguish:
  - `readableFetchedAt` is `NULL`                      -> never attempted (fetch lazily).
  - `readableFetchedAt` set, `readableHtml` non-null   -> extracted, cached, show it.
  - `readableFetchedAt` set, `readableHtml` is `NULL`  -> tried and failed (offer retry, fall back to Readable).

`articles` is a global, deduplicated table (see the design note at the top of
`schema.ts`): `readableHtml` is shared across all subscribers of the feed, not
per-user. That is intentional - the extracted body of an article is identical
for every reader.

After editing the schema, from the repo root run:

```
pnpm db:generate
```

This runs `drizzle-kit generate` and emits a new migration file into
`apps/api/drizzle` plus its `meta` snapshot. Commit the generated files as-is;
do not hand-write or edit the migration SQL. Containers apply migrations on
startup via `dist/migrate.js`.

## API changes

Add both handlers to `articleRoutes` in `apps/api/src/routes/articles.ts`. Both
require auth via `const auth = { preHandler: app.requireAuth };` (already
declared at the top of that function, matching the existing routes). All error
responses use the app-wide error shape `{ error, message, statusCode }` (see
`app.setErrorHandler` and `setNotFoundHandler` in `apps/api/src/app.ts`).

### `GET /api/articles/:id` (new)

Loads one article the caller is subscribed to, with feed context and this
user's state.

- **Scope / not-found:** the article's `feedId` must be present in the caller's
  `subscriptions`. Enforce it in the query (join or `inArray` against the
  caller's subscribed feed ids), not after the fact. If the id does not exist
  **or** the caller is not subscribed to its feed, respond
  `404 { error: 'NotFound', message: 'Article not found', statusCode: 404 }`.
  Return the same 404 for both cases - do not leak the existence of articles in
  feeds the user does not follow.
- **State defaulting:** left-join `article_states` on
  `(articleStates.articleId = articles.id AND articleStates.userId = :userId)`
  and `coalesce(...)` `read`/`starred` to `false` when the row is absent, using
  the exact pattern already in the list route (`GET /articles`):
  `read: sql<boolean>\`coalesce(${articleStates.read}, false)\``.
- **Feed join:** inner-join `feeds` for `feed.id`, `feed.title`, `feed.siteUrl`,
  `feed.faviconUrl`.
- **Response** (validated by `articleDetailSchema` below), a single object:

  ```jsonc
  {
    "id": "...",
    "title": "...",            // nullable
    "author": "...",           // nullable
    "url": "...",              // nullable (item.link may be absent)
    "contentHtml": "...",      // nullable, ALREADY sanitized by SPEC-001
    "summary": "...",          // nullable
    "publishedAt": "...",      // nullable ISO 8601 string
    "readableHtml": "...",     // nullable
    "readableFetchedAt": "...",// nullable ISO 8601 string
    "feed": { "id": "...", "title": "...", "siteUrl": "...", "faviconUrl": "..." },
    "read": false,
    "starred": false
  }
  ```

  Drizzle returns `timestamptz` columns as `Date`; serialize `publishedAt` and
  `readableFetchedAt` to ISO strings (Fastify's JSON serializer does this via
  `Date.prototype.toJSON`, so returning the `Date` is fine as long as the Zod
  response type treats them as ISO strings).

### `GET /api/articles/:id/readable` (new)

Read-through cache for the Simplified view. A `GET` is used deliberately: the
observable result is the extracted article body (idempotent for a given id),
and cache population is an internal side effect, not a client-visible state
change. **This endpoint is the only place readability extraction ever runs.**
The worker's `pollFeed` (SPEC-001) must never call it - extraction happens only
when a user opens Simplified for an article that has no cached result.

- **Query schema** (`readableQuerySchema`, see shared additions): a single
  optional `refresh` boolean parsed with `z.stringbool()` (the repo's Zod-4
  convention for query booleans, as used by `articleQuerySchema.unread`), so
  `?refresh=true` forces re-extraction.
- **Scope / not-found:** identical subscription scope check as
  `GET /api/articles/:id`. `404` with the same body if not found or not
  subscribed. Do this *before* any fetch.
- **Cache hit:** if `refresh` is not set and `readableFetchedAt` is non-null
  (an attempt has already run), return the current cached state without
  fetching the source page - even when `readableHtml` is `NULL` (a prior
  attempt failed; do not retry automatically).
- **No source URL:** if `article.url` is `NULL`, there is nothing to fetch.
  Respond `422 { error: 'UnprocessableEntity', message: 'Article has no source URL', statusCode: 422 }`.
  Do not stamp `readableFetchedAt` (nothing was attempted).
- **Extract:** otherwise (cache miss, or `refresh=true`), call
  `extractReadableHtml(article.url)` (see Implementation notes). Then, in the
  handler, persist the outcome and return the refreshed shape:
  - success (non-null string): set `readableHtml = <clean>`,
    `readableFetchedAt = now()`.
  - failure or empty extraction (`null`): set `readableHtml = null`,
    `readableFetchedAt = now()` (records the attempt so the client stops
    retrying automatically).
- **Response:** `200` with the **same object shape as `GET /api/articles/:id`**
  (re-read or reuse the loaded row, applying the just-written `readableHtml` /
  `readableFetchedAt`), so the client can drop it straight into the
  `['article', id]` query cache. On the failure path this is a `200` with
  `readableHtml: null` and `readableFetchedAt` set, not an error status - a
  failed extraction is a normal, expected outcome that the client handles by
  falling back to Readable.

### Shared schema additions

Add to `packages/shared/src/schemas/article.ts` (Zod 4 is the repo version;
`z.uuid()`, `z.iso.datetime()`, and `z.stringbool()` are all valid and already
used in this file):

```ts
export const articleFeedSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  siteUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
});

export const articleDetailSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  url: z.string().nullable(),
  contentHtml: z.string().nullable(),
  summary: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  readableHtml: z.string().nullable(),
  readableFetchedAt: z.iso.datetime().nullable(),
  feed: articleFeedSchema,
  read: z.boolean(),
  starred: z.boolean(),
});
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

export const readableQuerySchema = z.object({
  refresh: z.stringbool().optional(),
});
export type ReadableQuery = z.infer<typeof readableQuerySchema>;
```

`packages/shared/src/schemas/index.ts` re-exports `./article.js` already, so no
new export wiring is needed; `packages/shared` is source-only (no build step).
The web client imports `ArticleDetail` from `@rss/shared` for its query types.

## Web / UI changes

New files under `apps/web/src/components/reading-pane/`:

### `ArticleHtml.tsx` - the one sanitized-HTML renderer

The single component in the entire client that uses `dangerouslySetInnerHTML`.
Every view that renders article HTML goes through it; no other component may
call `dangerouslySetInnerHTML` directly.

```tsx
export function ArticleHtml({ html }: { html: string }) {
  return (
    <div
      className="prose prose-neutral dark:prose-invert max-w-none prose-a:text-primary"
      // Input is ALREADY sanitized server-side (SPEC-001 for contentHtml,
      // SPEC-004's extraction path for readableHtml). This component TRUSTS its
      // input and never re-sanitizes. Never wire an un-sanitized HTML source
      // into it.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- `prose ... dark:prose-invert` is Tailwind Typography. Dark mode in this repo
  is class-based (`@custom-variant dark (&:is(.dark *))` in `index.css`, toggled
  by AppShell's theme control), **not** `prefers-color-scheme`, so
  `dark:prose-invert` is the correct dark trigger.
- Map Typography's palette onto the app's design tokens so prose matches the
  rest of the UI in both themes. Add to `apps/web/src/index.css` (after the
  `@plugin` line), overriding the `--tw-prose-*` variables the plugin reads:

  ```css
  @layer base {
    .prose {
      --tw-prose-body: var(--foreground);
      --tw-prose-headings: var(--foreground);
      --tw-prose-links: var(--primary);
      --tw-prose-bold: var(--foreground);
      --tw-prose-quotes: var(--muted-foreground);
      --tw-prose-quote-borders: var(--border);
      --tw-prose-code: var(--foreground);
      --tw-prose-pre-bg: var(--muted);
      --tw-prose-pre-code: var(--foreground);
      --tw-prose-hr: var(--border);
      --tw-prose-captions: var(--muted-foreground);
      --tw-prose-th-borders: var(--border);
      --tw-prose-td-borders: var(--border);
      --tw-prose-bullets: var(--muted-foreground);
      --tw-prose-counters: var(--muted-foreground);
    }
  }
  ```

  This makes `dark:prose-invert` unnecessary for color (the tokens already flip
  under `.dark`), but keep it on the element as a safe default for any variable
  not overridden above. Both approaches agree, so ship both.

### `ReadingPane.tsx` - the pane shell + view switcher

Props: `{ articleId: string }`. Behavior:

- Fetch with TanStack Query:
  `useQuery({ queryKey: ['article', articleId], queryFn: () => api<ArticleDetail>(\`/articles/${articleId}\`), enabled: !!articleId })`.
  Use the existing `api()` helper (`apps/web/src/lib/api.ts`), which prefixes
  `/api` and includes credentials; pass the path *without* the `/api` prefix
  (e.g. `/articles/${id}`).
- Loading and error states: while `isLoading`, show a lightweight skeleton
  (reuse the `EmptyPane` visual language or a spinner). On error, show the error
  message; if the fetch 404s (an `ApiRequestError` with `status === 404`), show
  "Article not found or you are not subscribed to its feed."
- Header (rendered above the body for all three views): title (`<h1>`), a
  metadata row with feed favicon (`feed.faviconUrl`, fall back to a
  `lucide-react` `Rss` icon) + feed title (`feed.title` ?? `feed.siteUrl`),
  author (when present), and a formatted `publishedAt`. Include a persistent
  "Open original" external link to `article.url` (an `<a target="_blank"
  rel="noopener noreferrer">` with an `ExternalLink` icon) whenever `url` is
  non-null.
- View switcher: a segmented control with the three `ARTICLE_VIEWS`
  (`'simplified' | 'readable' | 'web'`), current view held in local
  `useState<ArticleView>('simplified')`. Not persisted (SPEC-011). Switching
  views must **not** re-issue the `['article', id]` query - all three views read
  from the same already-fetched `ArticleDetail` (Web needs only `url`,
  Simplified may trigger a *separate* `['article', id, 'readable']` request; see
  below). Reset the local view to `'simplified'` when `articleId` changes (key
  the switcher on `articleId`, or a `useEffect` on `articleId`).

### The three views

- **Readable:** `article.contentHtml` is already sanitized (SPEC-001). Render
  `<ArticleHtml html={article.contentHtml} />` directly. If `contentHtml` is
  `null`, show `article.summary` as a fallback, and if that is also null, an
  empty-state note. No network call.
- **Simplified:** decide from the two `readable*` fields on the already-loaded
  `ArticleDetail`:
  - `readableHtml` present -> `<ArticleHtml html={article.readableHtml} />`.
  - `readableFetchedAt === null` (never attempted) -> show a loading state and
    fire the readable fetch exactly once. Use a mutation or a query keyed on
    `['article', articleId, 'readable']` that calls
    `api<ArticleDetail>(\`/articles/${articleId}/readable\`)`. On success, write
    the returned object into the `['article', articleId]` cache
    (`queryClient.setQueryData`) so all fields stay consistent. Trigger it from
    a `useEffect` keyed on `[articleId, view]` (fire only when
    `view === 'simplified'` and not yet attempted), **not** on every render, so
    it runs once per article, not per keystroke or re-render.
  - `readableFetchedAt` set but `readableHtml === null` (tried and failed) ->
    show "Couldn't extract a clean version of this article." with a **Try
    again** button that calls the readable endpoint with `?refresh=true`, and a
    link/button that switches the view to Readable.
- **Web:** a best-effort sandboxed iframe plus an always-present open-in-new-tab
  control (the safe default):

  ```tsx
  <div className="flex h-full flex-col">
    <div className="flex items-center gap-2 border-b p-2 text-sm">
      <a href={article.url} target="_blank" rel="noopener noreferrer"
         className="inline-flex items-center gap-1 text-primary">
        <ExternalLink className="size-4" /> Open original in new tab
      </a>
      <span className="text-muted-foreground">
        If the page below is blank, the site blocks embedding - use the link above.
      </span>
    </div>
    {article.url && (
      <iframe
        src={article.url}
        title={article.title ?? 'Original page'}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="h-full w-full border-0"
      />
    )}
  </div>
  ```

  Many publishers send `X-Frame-Options: DENY/SAMEORIGIN` or a
  `Content-Security-Policy: frame-ancestors` directive and will render blank
  inside the iframe. **Do not try to detect the blank frame** (cross-origin
  frames expose no reliable load/error signal); the persistent
  open-in-new-tab link and the note above it are the contract. If `article.url`
  is `null`, render only the note ("No original URL for this item").

### `ReaderPage.tsx` wiring + responsive behavior

- **Selection state via the URL.** Drive selection from a search param so
  browser back works as the "pushed route" on mobile and so a refresh restores
  the open article. Use react-router's `useSearchParams` (react-router 8.3.0 is
  a dependency): the selected id is `searchParams.get('article')`. The article
  list (SPEC-003) selects by setting `?article=<id>`; the reading pane's back
  control clears it (`setSearchParams` removing the param). Because each change
  is a history entry, the device Back gesture returns to the list below `lg`.
- **`lg` and up (three columns):** the grid already reserves the third column.
  Render `<ReadingPane articleId={selectedId} />` in the `<article>` when
  `selectedId` is set, otherwise keep the `EmptyPane` "Select an article". List
  selection updates the pane in place (the `['article', id]` query key changes).
- **Below `lg` (full-screen push):** when `selectedId` is set, the reading pane
  takes over the content area at full width and the list is visually hidden;
  when it is unset, the list shows. Keep the list component **mounted** (toggle
  with a `hidden`/`lg:flex` utility rather than unmounting it) so its scroll
  position, infinite-scroll pages, and active filters survive returning from the
  reader. The reader gets a back control at the top - a `lucide-react`
  `ChevronLeft` + "Back to articles" button, visible only below `lg`
  (`lg:hidden`) - that clears the `article` param.
- Concretely, the reading pane container spans the content area below `lg`:
  render the reader in a wrapper that is `hidden` when no selection and
  `fixed inset-0 z-… bg-background` (or a full-area grid cell) when selected and
  below `lg`, while at `lg+` it is simply the third grid column. Prefer the
  grid-cell approach (an element that occupies the third column at `lg+` and the
  whole content region below `lg`) over a portal/overlay to keep it simple.

Do not restructure the sidebar or the list's own rendering - those belong to
SPEC-003. This spec only adds the `article` search param, the `ReadingPane`
mount, and the below-`lg` show/hide rule.

## Implementation notes

Add dependencies (match the repo convention of exact, un-prefixed versions):

- `apps/api/package.json` `dependencies`: `@mozilla/readability`, `linkedom`.
  `linkedom` is a lightweight DOM with no native deps (unlike `jsdom`), which
  keeps the API image small and the build fast. `undici` (already a dependency,
  used in `poll.ts`) provides the fetch.
- `apps/web/package.json` `dependencies`: `@tailwindcss/typography`. Register it
  in `apps/web/src/index.css` with Tailwind v4 plugin syntax (there is no
  `tailwind.config.js` in this project - Tailwind v4 is configured in CSS):

  ```css
  @import 'tailwindcss';
  @import 'tw-animate-css';
  @plugin '@tailwindcss/typography';
  ```

Install with `pnpm install` from the repo root so the workspace lockfile
updates.

### `apps/api/src/lib/readability.ts`

A pure fetch + parse + sanitize function with no DB access, unit-testable like
SPEC-001's sanitizer. The route handler owns all DB reads/writes.

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { request } from 'undici';
import { sanitizeArticleHtml } from './sanitize.js'; // from SPEC-001

const FETCH_TIMEOUT_MS = 15_000; // matches rss-parser's timeout in poll.ts
// A browser-like UA: bare/library UAs are blocked by some publishers.
const USER_AGENT =
  'Mozilla/5.0 (compatible; rss-reader/0.1; +https://github.com/your/rss-reader)';

/**
 * Fetch `url`, extract the main article with Readability, and return sanitized
 * HTML, or null on any failure (network, timeout, non-HTML, empty extraction).
 * Never throws for expected failures.
 */
export async function extractReadableHtml(url: string): Promise<string | null> {
  try {
    const res = await request(url, {
      method: 'GET',
      // undici's request() does NOT follow redirects unless told to (see the
      // note in poll.ts). Article URLs frequently redirect, so opt in.
      maxRedirections: 5,
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: FETCH_TIMEOUT_MS,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });

    if (res.statusCode >= 400) {
      res.body.dump(); // drain to free the socket
      return null;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (!contentType.includes('html')) {
      res.body.dump();
      return null;
    }

    const html = await res.body.text();
    const { document } = parseHTML(html);
    const parsed = new Readability(document).parse();
    if (!parsed?.content) return null;

    // linkedom does not track the document's URL, so Readability cannot
    // absolutize relative links itself; the sanitizer resolves them against
    // `url` (its baseUrl argument), matching SPEC-001's ingestion path.
    const clean = sanitizeArticleHtml(parsed.content, url);
    return clean.trim() ? clean : null;
  } catch {
    // Timeouts, DNS/connection errors, malformed HTML: all treated as "no
    // readable version", never surfaced as a 5xx to the client.
    return null;
  }
}
```

### Route handler for `GET /api/articles/:id/readable`

Owns the DB read/write around the pure function:

1. Parse `request.query` with `readableQuerySchema`.
2. Load the article with the same scoped join as `GET /api/articles/:id`
   (404 if not found / not subscribed).
3. If not `refresh` and `readableFetchedAt` is non-null, return the current row
   shape (cache hit, no fetch).
4. If `article.url` is null, `422` as specified.
5. `const clean = await extractReadableHtml(article.url);`
6. `await db.update(articles).set({ readableHtml: clean, readableFetchedAt: new Date() }).where(eq(articles.id, id));`
7. Return the `ArticleDetail` shape with the updated `readableHtml` /
   `readableFetchedAt` (and the same feed + state fields as the detail route).

Factor the "load article detail for user" query into a small shared helper used
by both routes so the scope check, feed join, and state coalescing are written
once.

### Security

- **XSS / render trust.** Both `contentHtml` (SPEC-001, at ingestion) and
  `readableHtml` (this spec, at extraction time via `sanitizeArticleHtml`) are
  sanitized *before storage*. `ArticleHtml` renders already-clean HTML and does
  not re-sanitize. This is the invariant: never feed `ArticleHtml` a string that
  has not passed `sanitizeArticleHtml` server-side.
- **Web-view iframe.** It intentionally loads third-party publisher origins.
  `sandbox="allow-scripts allow-same-origin allow-popups"` is safe here because
  the framed page is always a *different* origin than the app: `allow-scripts` +
  `allow-same-origin` together only grant the frame access to *its own* origin,
  not the parent's. Do **not** add `allow-forms`, `allow-top-navigation`, or
  `allow-modals`. `referrerpolicy="no-referrer"` avoids leaking the reader URL.
  The app's Helmet config currently disables CSP
  (`contentSecurityPolicy: false` in `app.ts`), so our own CSP will not block
  the frame; the publisher's `X-Frame-Options` still may, which is expected and
  handled by the open-in-new-tab fallback.
- **SSRF (server-side fetch).** `extractReadableHtml` fetches an
  attacker-influenceable URL (feed authors control `article.url`) from inside
  the API's network. Mitigate: only ever fetch `http:`/`https:` URLs (reject
  others before fetching), and prefer blocking requests that resolve to private
  / loopback / link-local ranges (`127.0.0.0/8`, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16`, `::1`, fc00::/7). At minimum, add a scheme guard
  in this spec and record the private-range block as an open question below if
  you do not implement it now. Never echo the fetched response body except as
  sanitized extracted content.

### Build order

1. Schema + `pnpm db:generate` migration.
2. `readability.ts` + its unit test.
3. The shared schemas (`articleDetailSchema`, `readableQuerySchema`).
4. The two API routes + integration tests.
5. `@tailwindcss/typography` wiring in `index.css` + `ArticleHtml`.
6. `ReadingPane` and the three views.
7. `ReaderPage` selection param + responsive swap last.

### Test infrastructure note (web)

`apps/web` currently has **no test runner** (no `vitest`, `@testing-library/*`,
or `jsdom` in its `package.json`, and no `test` script). The component tests
below require adding, to `apps/web` `devDependencies`: `vitest`,
`@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (and reusing the
already-present `@vitejs/plugin-react`); a `test: "vitest run"` script; and a
Vitest config with `environment: 'jsdom'` plus a setup file importing
`@testing-library/jest-dom`. Do this as part of this spec, or, if deferring the
web test harness, implement the two component checks as the listed manual steps
and note the deferral. The API tests need no new infra (`vitest` is already an
`apps/api` devDependency and `app.inject` is the established pattern).

## Acceptance criteria

- [ ] `articles.readableHtml` (nullable `text`) and `articles.readableFetchedAt`
      (nullable `timestamptz`) exist in `apps/api/src/db/schema.ts` and in a
      committed Drizzle migration under `apps/api/drizzle` generated by
      `pnpm db:generate`.
- [ ] `GET /api/articles/:id` returns the full `articleDetailSchema` shape
      (article fields + `feed` object + `read`/`starred`) for an article in one
      of the caller's subscriptions.
- [ ] `GET /api/articles/:id` returns `read: false` / `starred: false` when the
      caller has no `article_states` row for that article.
- [ ] `GET /api/articles/:id` returns `404` (with body
      `{ error, message, statusCode: 404 }`) both for a non-existent id and for
      an article whose feed the caller is not subscribed to - indistinguishable
      from the outside.
- [ ] `GET /api/articles/:id/readable` on first call (no prior
      `readableFetchedAt`) runs extraction once, stores `readableHtml` +
      `readableFetchedAt`, and returns the updated shape.
- [ ] A second `GET /api/articles/:id/readable` for the same article does **not**
      re-fetch the source page (cache hit), but `?refresh=true` does re-fetch.
- [ ] A failed extraction returns `200` with `readableHtml: null` and a set
      `readableFetchedAt` (not a 5xx), and subsequent non-`refresh` calls do not
      retry.
- [ ] `GET /api/articles/:id/readable` returns `422` when `article.url` is null,
      without stamping `readableFetchedAt`.
- [ ] `GET /api/articles/:id/readable` enforces the same subscription scope
      (`404` when not subscribed) and never extracts before the scope check.
- [ ] `pollFeed` (worker) does not call the readable endpoint or
      `extractReadableHtml` - extraction is lazy and user-triggered only.
- [ ] Clicking an article loads `GET /api/articles/:id` and renders it in the
      reading pane with header (title, feed, author, date) and an "Open original"
      link.
- [ ] Readable view renders `contentHtml` through `ArticleHtml` with typography
      readable in both light and dark themes (prose colors follow the design
      tokens).
- [ ] Simplified view: first open triggers `GET /api/articles/:id/readable` once
      (effect keyed on article, not per render), shows a loading state, then the
      extracted content; the tried-and-failed state shows a "Try again" (refresh)
      control and a link to Readable.
- [ ] Web view shows the sandboxed iframe attempt plus an always-visible
      open-in-new-tab link that works even when the frame is blank.
- [ ] Switching among the three views does **not** re-issue the
      `['article', id]` query.
- [ ] `ArticleHtml` is the only component in `apps/web/src` using
      `dangerouslySetInnerHTML`; no `<script>` executes and no inline handler
      fires when rendering `contentHtml` or `readableHtml`.
- [ ] Below `lg`, selecting an article shows a full-screen reader with a
      "Back to articles" control; returning to the list preserves its scroll
      position and filters (list stays mounted).
- [ ] At `lg` and above, the reading pane is a persistent third column and list
      selection updates it in place.
- [ ] Selection is reflected in a `?article=<id>` URL param, so browser Back
      returns to the list and a refresh restores the open article.

## Testing

### Unit (`apps/api`, Vitest - `pnpm --filter @rss/api test`)

`apps/api/src/lib/readability.test.ts`, mocking `undici`'s `request` (e.g.
`vi.mock('undici')`) so no real network happens:

- A fixture of clear article markup (a `<main>`/`<article>` with headings and
  paragraphs) yields non-null extracted HTML that contains the body text and no
  `<script>` (post-sanitize).
- A content-free fixture (nav/boilerplate only, or Readability returns null)
  yields `null`.
- A simulated fetch rejection (thrown error) and a simulated timeout yield
  `null` and do **not** throw.
- A non-HTML `content-type` (e.g. `application/json`) yields `null` without
  attempting to parse.
- An HTTP `>= 400` status yields `null`.

### Integration (`apps/api`, `app.inject` per `health.test.ts`)

Seed a user, a feed, a subscription, and an article (and a second user/feed the
first user is *not* subscribed to). Mock `extractReadableHtml` (or the underlying
`undici.request`) to control fetch behavior and count calls.

- `GET /api/articles/:id` for a subscribed article -> `200`, full detail shape,
  `read`/`starred` default to `false` with no state row, and reflect an existing
  `article_states` row when present.
- `GET /api/articles/:id` for a non-subscribed feed's article -> `404`; for a
  random uuid -> `404`; both bodies identical.
- `GET /api/articles/:id` unauthenticated -> `401`.
- `GET /api/articles/:id/readable` first call -> extraction runs once (assert
  mock call count `=== 1`), row is updated, response carries `readableHtml`.
- Second `GET /api/articles/:id/readable` -> call count stays `1` (cache hit);
  with `?refresh=true` -> call count becomes `2`.
- Failed extraction (mock returns `null`) -> `200`, `readableHtml: null`,
  `readableFetchedAt` set; a following non-refresh call does not re-invoke the
  extractor.
- `GET /api/articles/:id/readable` for an article with `url = null` -> `422`,
  no extractor call, `readableFetchedAt` still null.
- `GET /api/articles/:id/readable` for a non-subscribed article -> `404` with no
  extractor call.

### Component (`apps/web` - requires the test harness in the note above)

- `ArticleHtml` renders a fragment containing `<script>` / `onerror` markup and
  the rendered DOM contains no `<script>` node and no inline handler fires
  (belt-and-suspenders check that the trust boundary holds; the real guarantee
  is server-side sanitization).
- `ReadingPane`'s view switcher: mounting with mocked query data, clicking
  Simplified -> Readable -> Web changes the rendered body without re-issuing the
  `['article', id]` query (assert the query fn call count stays `1`).

### Manual

- Resize below `lg`: confirm selecting an article pushes a full-screen reader,
  the Back control returns to the list with scroll position and filters intact,
  and the device/browser Back gesture also returns to the list.
- Open a Simplified view on a real article and confirm it caches (second open is
  instant, no network for the source page in devtools).
- Open the Web view on a site that sends `X-Frame-Options: DENY` (e.g. many news
  sites) and confirm the frame is blank but the open-in-new-tab link works.
- Toggle the theme and confirm prose colors flip correctly in Readable and
  Simplified.

## Open questions

- **SSRF hardening depth.** This spec mandates an `http`/`https` scheme guard on
  the readability fetch. Whether to also block private/loopback/link-local
  resolution (and how - DNS pre-resolution plus an allowlist, or an egress
  proxy) is unresolved; for a self-hosted single-tenant instance the risk is
  lower, but multi-user instances should block it. Track as a follow-up if not
  implemented here.
- **Readable-view empty content.** When `contentHtml` is null but `summary`
  exists, Readable falls back to the summary. If, in practice, many feeds ship
  only summaries, consider auto-selecting Simplified as the default view for
  those articles (currently Simplified is always the default). Defer to SPEC-011
  (per-user/per-feed view preferences) if it becomes a real annoyance.
- **`readableHtml` staleness.** The cache never expires; if a publisher updates
  an article, the extracted copy will not refresh unless a user hits
  `?refresh=true`. A TTL on `readableFetchedAt` could trigger silent
  re-extraction later; out of scope here.
