# SPEC-001: HTML sanitization pipeline

- **Status:** Done
- **Phase:** 1
- **Depends on:** none
- **Estimated size:** M

## Context

The feed poller lives in `apps/api/src/worker/poll.ts`. Inside `pollFeed()` it
parses each feed with `rss-parser` and builds article rows in the
`parsed.items.map(...)` callback (around lines 66-82). Today that callback
writes raw publisher HTML straight into `articles.contentHtml` with the
placeholder left in place:

```ts
// apps/api/src/worker/poll.ts, inside parsed.items.map(...)
// TODO: sanitize HTML before rendering it in the client.
contentHtml: item['content:encoded'] ?? item.content ?? null,
```

Those rows are then bulk-inserted with `db.insert(articles).values(rows)`
(around line 86). The HTML comes from arbitrary, untrusted third-party feeds,
so any `<script>`, `onerror=` handler, `javascript:` URL, or CSS
`expression(...)` a publisher (or a compromised feed) includes would execute
verbatim the moment the reading pane renders it.

SPEC-004 (article reading pane) will render `articles.contentHtml` in the
browser. This spec must land first so that everything stored in
`articles.contentHtml` is already safe, and 004 can render it without doing its
own sanitization. This spec has no dependencies and is a self-contained Phase 1
unit, so it can be picked up immediately.

## Goal

Every `contentHtml` value stored in the `articles` table is sanitized HTML that
is safe to render with `dangerouslySetInnerHTML` (or an equivalent) in the
browser: no executable script, no event-handler attributes, no
`javascript:`/`data:` script vectors, no CSS-based vectors, and no
render-time network calls beyond the images, media, and links the article
legitimately contains. Sanitization happens once, at ingestion, in the worker.

## Non-goals

- The reading-pane rendering component and its view modes (simplified /
  readable / web) plus readability extraction: that is SPEC-004. This spec only
  guarantees the stored HTML is clean; it does not render anything.
- Sanitizing feed-level or article-level text fields (`feeds.title`,
  `feeds.description`, `articles.title`, `articles.summary`). Those are rendered
  as text nodes, not as HTML, so they need escaping at render time (React does
  this by default), not HTML sanitization here.
- Client-side sanitization as the primary defense. The contract established
  here is that server-stored `contentHtml` is already safe. SPEC-004 may add
  defense-in-depth but must not rely on it.
- Full-text search indexing of the sanitized content: that is SPEC-006.

## Data model changes

Edit the `articles` table in `apps/api/src/db/schema.ts`. Add two nullable
columns immediately after the existing `fetchedAt` column (columns are declared
camelCase and mapped to snake_case by the `casing: 'snake_case'` setting, so
these become `sanitized_at` and `sanitizer_version` in SQL):

```ts
export const articles = pgTable('articles', {
  // ...existing columns: id, feedId, guid, url, title, author,
  // contentHtml, summary, publishedAt, fetchedAt...
  sanitizedAt: timestamp({ withTimezone: true }),
  sanitizerVersion: integer(),
}, (t) => [
  uniqueIndex('articles_feed_guid_key').on(t.feedId, t.guid),
  index('articles_feed_published_idx').on(t.feedId, t.publishedAt),
]);
```

- `sanitizedAt` (nullable `timestamptz`): set to the current time whenever the
  sanitizer processes the row.
- `sanitizerVersion` (nullable `integer`, no default): the policy version that
  produced the current `contentHtml`. Nullable with no default so that rows
  created before this migration read back as `NULL` and are picked up by the
  backfill (see below). `integer` is already imported in `schema.ts`;
  `timestamp` is too, so no new imports are needed.

`contentHtml` keeps its current column and type (`text()`, nullable). Its
meaning changes from "raw feed HTML" to "sanitized HTML". There is no separate
raw/original column; storing both would double content storage. The backfill
re-sanitizes the already-stored HTML rather than re-deriving from a raw copy,
which is why sanitization must be applied before the first write.

After editing the schema, from the repo root run:

```
pnpm db:generate
```

This runs `drizzle-kit generate` and emits a new migration file into
`apps/api/drizzle` (alongside the existing `0000_lying_maginty.sql`) plus its
`meta` snapshot. Commit the generated files as-is; do not hand-write or edit the
migration SQL. Containers apply migrations on startup via `dist/migrate.js`, so
no manual `pnpm db:migrate` step is part of this spec beyond local verification.

## API changes

None. No route reads or writes these columns. Because sanitization happens at
ingestion, SPEC-004 reads `articles.contentHtml` as-is with no on-the-way-out
sanitization, and no new Zod schema in `packages/shared` is required.

## Web / UI changes

None. Rendering the sanitized `contentHtml` is entirely SPEC-004's
responsibility.

## Implementation notes

Do the work in this order.

### 1. Add the dependency

Add to `apps/api/package.json` (match the repo convention of exact, un-prefixed
versions; use the current `sanitize-html` 2.x line):

- `dependencies`: `"sanitize-html"` (the runtime sanitizer).
- `devDependencies`: `"@types/sanitize-html"` (its TypeScript types).

Install with `pnpm install` from the repo root so the workspace lockfile
updates.

### 2. Create the shared sanitizer module

Create `apps/api/src/lib/sanitize.ts` (new `lib` directory). It must be a pure
module with no dependency on Fastify or Drizzle types, so it is trivially unit
testable and importable from both the worker and the backfill script. Exact
contents:

```ts
import sanitizeHtml from 'sanitize-html';

/**
 * Bump this whenever the policy below changes in a way that should force a
 * re-sanitize of already-stored rows. After bumping, run the backfill:
 *   pnpm --filter @rss/api exec tsx src/scripts/resanitize.ts
 */
export const SANITIZER_VERSION = 1;

/** Allow known third-party video embeds (YouTube / Vimeo). */
const ALLOW_EMBEDS = true;

const ALLOWED_IFRAME_HOSTNAMES = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
];

/**
 * Resolve a possibly-relative URL against the article's own URL (falling back
 * to the feed's site URL). Returns an absolute URL string, or null if it can
 * not be parsed (in which case the caller drops the attribute).
 */
function resolveUrl(value: string | undefined, base: string | null): string | null {
  if (!value) return null;
  try {
    return base ? new URL(value, base).href : new URL(value).href;
  } catch {
    return null;
  }
}

/** Merge the required hardening tokens into any existing rel value. */
function hardenRel(existing: string | undefined): string {
  const tokens = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  tokens.add('noopener');
  tokens.add('noreferrer');
  tokens.add('nofollow');
  return [...tokens].join(' ');
}

/**
 * Sanitize untrusted feed HTML for safe storage in articles.contentHtml.
 * @param html    Raw HTML from the feed item.
 * @param baseUrl The article URL (item.link) or feed site URL, for resolving
 *                relative links/images. May be null.
 */
export function sanitizeArticleHtml(html: string, baseUrl: string | null): string {
  return sanitizeHtml(html, {
    allowedTags: [
      // Text + structure
      'p', 'a', 'blockquote', 'cite', 'q',
      'code', 'pre', 'kbd', 'samp', 'var',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup',
      'small', 'mark', 'abbr', 'time', 'span', 'div',
      'hr', 'br', 'wbr',
      // Tables
      'table', 'caption', 'colgroup', 'col',
      'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
      // Media
      'img', 'figure', 'figcaption', 'picture',
      'video', 'audio', 'source', 'track',
      // Embeds (only when ALLOW_EMBEDS; hosts are restricted below)
      ...(ALLOW_EMBEDS ? ['iframe'] : []),
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      video: ['src', 'controls', 'poster', 'width', 'height', 'preload'],
      audio: ['src', 'controls', 'preload'],
      source: ['src', 'type', 'media'],
      track: ['src', 'kind', 'srclang', 'label', 'default'],
      abbr: ['title'],
      time: ['datetime'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      col: ['span'],
      colgroup: ['span'],
      ...(ALLOW_EMBEDS
        ? { iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'title'] }
        : {}),
    },
    // No 'data' scheme: blocks data:text/html and data:image payloads.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      // Media sources must be network URLs, never mailto.
      img: ['http', 'https'],
      video: ['http', 'https'],
      audio: ['http', 'https'],
      source: ['http', 'https'],
      ...(ALLOW_EMBEDS ? { iframe: ['http', 'https'] } : {}),
    },
    allowProtocolRelative: false,
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTNAMES,
    // Default behavior, stated for clarity: disallowed tags are dropped but
    // their text is kept, EXCEPT the default nonTextTags (script, style,
    // textarea, option) whose text content is also discarded. That is what
    // neutralizes <script>alert(1)</script> and <style>...</style> completely.
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        const href = resolveUrl(attribs.href, baseUrl);
        if (href) next.href = href;
        else delete next.href;
        next.target = '_blank';
        next.rel = hardenRel(attribs.rel);
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        const resolved = resolveUrl(attribs.src, baseUrl);
        if (resolved) {
          const u = new URL(resolved);
          if (u.protocol === 'http:') {
            u.protocol = 'https:'; // upgrade http -> https
            next.src = u.href;
          } else if (u.protocol === 'https:') {
            next.src = u.href;
          } else {
            delete next.src; // any other scheme: drop it
          }
        } else {
          delete next.src;
        }
        next.loading = 'lazy';
        next.decoding = 'async';
        return { tagName, attribs: next };
      },
    },
    // Drop 1x1 tracking pixels.
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && frame.attribs.width === '1' && frame.attribs.height === '1',
  });
}
```

Notes on why this is safe:

- `on*` event handlers (`onerror`, `onload`, `onclick`, ...) are never in
  `allowedAttributes`, and `sanitize-html` drops every attribute not
  explicitly allowlisted. So `<img src=x onerror="alert(1)">` keeps `src`
  (resolved/upgraded) and loses `onerror`.
- `script`, `style`, `object`, `embed`, `form`, `input`, `button`, `svg`,
  `link`, `meta`, `base` are not in `allowedTags`, so they are stripped.
  `script` and `style` are default `nonTextTags`, so their inner text is
  discarded too (not escaped into visible output). `<svg onload=...>` is
  removed wholesale because `svg` is not allowed.
- No `style` attribute and no `<style>` tag are ever allowed, so CSS vectors
  like `style="background:url(javascript:...)"` and `expression(...)` cannot
  survive.
- `javascript:` URLs: `sanitize-html` lowercases the scheme and strips
  whitespace and control characters before matching `allowedSchemes`, so
  `javascript:`, `JavaScript:`, and `jav&#9;ascript:`/`jav\tascript:` variants
  all fail the `http`/`https`/`mailto` allowlist and the attribute is dropped.
  The `transformTags` step runs before scheme filtering, so resolving a
  `javascript:` href through the `URL` constructor does not launder it; the
  scheme allowlist still removes it afterward.
- `iframe` is allowed only when `ALLOW_EMBEDS` is true, and even then
  `allowedIframeHostnames` strips any iframe whose `src` host is not in the
  list, so arbitrary `<iframe src="https://evil.example.com/">` is removed.
  Flip `ALLOW_EMBEDS` to `false` to drop all iframes.
- Relative `href`/`src` are resolved to absolute URLs against `baseUrl` (the
  article URL, then the feed site URL). If resolution throws (malformed URL, or
  a relative URL with no base), the attribute is dropped rather than left
  relative.

### 3. Wire the sanitizer into the worker

In `apps/api/src/worker/poll.ts`:

- Add the import near the top (relative imports use `.js` specifiers per repo
  convention):

  ```ts
  import { SANITIZER_VERSION, sanitizeArticleHtml } from '../lib/sanitize.js';
  ```

- Replace the `parsed.items.map(...)` row builder so it computes the base URL,
  removes the `// TODO: sanitize HTML` comment, sanitizes `contentHtml`, and
  stamps the two new columns on every inserted row:

  ```ts
  const rows = parsed.items
    .map((item) => {
      const guid = item.guid ?? item.link ?? item.id;
      if (!guid) return null;
      const raw = item['content:encoded'] ?? item.content ?? null;
      const baseUrl = item.link ?? feed.siteUrl ?? null;
      return {
        feedId: feed.id,
        guid,
        url: item.link ?? null,
        title: item.title ?? null,
        author: item.creator ?? item.author ?? null,
        contentHtml: raw ? sanitizeArticleHtml(raw, baseUrl) : null,
        summary: item.contentSnippet ?? item.summary ?? null,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        sanitizedAt: new Date(),
        sanitizerVersion: SANITIZER_VERSION,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  ```

The existing insert stays as-is: `db.insert(articles).values(rows)` with
`.onConflictDoNothing({ target: [articles.feedId, articles.guid] })`. Only new
`(feedId, guid)` pairs are inserted, so existing rows are never re-sanitized on
poll; those are handled by the backfill. The `sanitizedAt` / `sanitizerVersion`
stamps are set unconditionally on insert so every ingested row records which
policy version produced it, even when `contentHtml` is null.

### 4. Backfill script

Create `apps/api/src/scripts/resanitize.ts` (new `scripts` directory). It
re-sanitizes already-stored `contentHtml` for rows whose `sanitizerVersion` is
null or behind `SANITIZER_VERSION`, using keyset pagination over the `id` uuid
so it never re-scans rows it has already updated. It re-uses the stored HTML as
input (no re-fetch from the source feed) and closes the shared Postgres pool on
exit. Exact contents:

```ts
/**
 * One-off backfill: re-run the current sanitizer over already-stored article
 * HTML. Run it manually after bumping SANITIZER_VERSION in
 * apps/api/src/lib/sanitize.ts:
 *
 *   pnpm --filter @rss/api exec tsx src/scripts/resanitize.ts
 *
 * It re-sanitizes the HTML already in articles.contentHtml (no network fetch),
 * which is why the policy must also run at ingestion in poll.ts.
 */
import { and, asc, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { client, db } from '../db/index.js';
import { articles, feeds } from '../db/schema.js';
import { SANITIZER_VERSION, sanitizeArticleHtml } from '../lib/sanitize.js';

const BATCH = 500;

async function main(): Promise<void> {
  let cursor: string | null = null; // last processed articles.id (uuid)
  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (;;) {
    const batch = await db
      .select({
        id: articles.id,
        contentHtml: articles.contentHtml,
        url: articles.url,
        siteUrl: feeds.siteUrl,
      })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(
        and(
          isNotNull(articles.contentHtml),
          or(
            isNull(articles.sanitizerVersion),
            lt(articles.sanitizerVersion, SANITIZER_VERSION),
          ),
          cursor ? gt(articles.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(articles.id))
      .limit(BATCH);

    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;
      processed++;
      try {
        const base = row.url ?? row.siteUrl ?? null;
        const clean = sanitizeArticleHtml(row.contentHtml as string, base);
        await db
          .update(articles)
          .set({
            contentHtml: clean,
            sanitizedAt: new Date(),
            sanitizerVersion: SANITIZER_VERSION,
          })
          .where(eq(articles.id, row.id));
        updated++;
      } catch (err) {
        failed++;
        console.error(
          `[resanitize] failed on ${row.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  console.log(`[resanitize] processed=${processed} updated=${updated} failed=${failed}`);
  await client.end({ timeout: 5 });
}

void main();
```

The keyset cursor advances by `id` and only ever moves forward, so rows updated
to the new version in an earlier batch are never revisited even though the
`sanitizerVersion` filter would otherwise re-match nothing. The base URL for
resolution mirrors ingestion (`articles.url`, then `feeds.siteUrl`).

## Acceptance criteria

- [ ] `apps/api/src/lib/sanitize.ts` exists and exports
      `sanitizeArticleHtml(html: string, baseUrl: string | null): string` and
      the `SANITIZER_VERSION` constant (initial value `1`), with no import of
      Fastify or Drizzle (pure function).
- [ ] `apps/api/src/worker/poll.ts` imports from `../lib/sanitize.js`, calls
      `sanitizeArticleHtml` for `contentHtml`, sets `sanitizedAt` and
      `sanitizerVersion` on every inserted row, and no longer contains the
      `// TODO: sanitize HTML` comment.
- [ ] `articles.sanitizedAt` (nullable `timestamptz`) and
      `articles.sanitizerVersion` (nullable `integer`) exist in
      `apps/api/src/db/schema.ts` and in a committed Drizzle migration under
      `apps/api/drizzle` generated by `pnpm db:generate`.
- [ ] `apps/api/src/scripts/resanitize.ts` exists, re-sanitizes rows whose
      `sanitizerVersion` is null or below `SANITIZER_VERSION`, updates
      `contentHtml`/`sanitizedAt`/`sanitizerVersion`, logs a processed/updated/
      failed count, and closes the DB pool.
- [ ] Each of these inputs is neutralized (no executable path remains) after
      passing through `sanitizeArticleHtml`:
  - [ ] `<script>alert(1)</script>` -> no `<script>` tag and no `alert(1)`
        text remain.
  - [ ] `<img src=x onerror="alert(1)">` -> the `onerror` attribute is gone.
  - [ ] `<a href="javascript:alert(1)">click</a>` -> no `javascript:` scheme
        remains on the anchor (also covers `JavaScript:` and tab/newline
        obfuscated variants).
  - [ ] `<svg onload="alert(1)"></svg>` -> the `<svg>` element is removed.
  - [ ] `<div style="background:url(javascript:alert(1))">x</div>` -> no
        `style` attribute and no `javascript:` remain.
  - [ ] `<iframe src="https://evil.example.com/"></iframe>` -> the iframe is
        stripped (host not in `ALLOWED_IFRAME_HOSTNAMES`).
  - [ ] `<img src="data:text/html;base64,PHNjcmlwdD4=">` -> the `data:` src is
        dropped.
- [ ] A 1x1 tracking pixel `<img width="1" height="1" src="https://t.example/p">`
      is removed entirely.
- [ ] Benign content survives with text and safe attributes intact:
      paragraphs, headings, lists, tables, code/pre blocks, blockquotes, and
      `<img>`/`<a>` with legitimate `https://` URLs.
- [ ] Every retained `<a>` has `target="_blank"` and a `rel` containing
      `noopener`, `noreferrer`, and `nofollow` (merged with any pre-existing
      `rel` tokens, not overwritten).
- [ ] Every retained `<img>` has `loading="lazy"` and `decoding="async"`, and
      an `http://` image `src` is upgraded to `https://`.
- [ ] Relative `href`/`src` values resolve to absolute URLs using the article
      URL (`item.link`) or feed `siteUrl` as base; unresolvable ones are
      dropped, not left relative.

## Testing

Add `apps/api/src/lib/sanitize.test.ts` (Vitest, matching the existing
`apps/api/src/routes/health.test.ts` convention). Run with
`pnpm --filter @rss/api test` (the script is `vitest run --passWithNoTests`).
Cover:

- One test per XSS vector in the acceptance criteria, each asserting the
  dangerous token is absent from the output. Assert on structure, not exact
  string equality: e.g. `expect(out).not.toMatch(/onerror/i)`,
  `expect(out).not.toContain('javascript:')`, `expect(out).not.toContain('<script')`,
  `expect(out).not.toContain('<svg')`, `expect(out).not.toMatch(/\bstyle=/)`.
- A tracking-pixel test: a 1x1 `<img>` produces output with no `<img` tag.
- A benign-content test using a realistic fragment (an `<h2>`, two `<p>`s, a
  `<ul>`, a `<table>` with `<thead>`/`<tbody>`, a `<pre><code>` block, a
  `<blockquote>`, an `<img>` with an `https://` src, and an `<a>` with an
  `https://` href) asserting the visible text, allowed tags, and safe
  attributes all survive.
- An anchor-hardening test: an `<a rel="author">` yields
  `target="_blank"` and a `rel` string containing `author`, `noopener`,
  `noreferrer`, and `nofollow`.
- An image-hardening test: an `<img src="http://cdn.example/p.jpg">` gains
  `loading="lazy"` and `decoding="async"` and has its `src` upgraded to
  `https://cdn.example/p.jpg`.
- A relative-URL test: `sanitizeArticleHtml('<img src="/media/x.png">', 'https://blog.example/post/1')`
  resolves the src to `https://blog.example/media/x.png`, and a relative
  `<a href="../about">` resolves against the same base. Also assert that with a
  `null` base a relative `src`/`href` is dropped.
- An embed test: a `https://www.youtube.com/embed/abc` iframe is retained when
  `ALLOW_EMBEDS` is true, while an iframe from an arbitrary host is stripped.
- A malformed-HTML test: unclosed tags and a stray `<` do not throw and return
  a string.

No integration or manual testing is required beyond these unit tests. The
worker call site is exercised end to end when SPEC-004 wires rendering against
real stored content.

## Open questions

- `ALLOW_EMBEDS` defaults to on with a YouTube/Vimeo hostname allowlist. If
  self-hosters want iframes off by default, this could later move behind an
  env var or per-instance setting (SPEC-011 owns server-persisted settings);
  for now it is a module constant.
- `data:` image URLs are blocked. If inline base64 feed images turn out to be
  common in practice, revisit allowing `data:image/*` on `img` specifically
  (via `allowedSchemesByTag`) without opening `data:text/html`.
