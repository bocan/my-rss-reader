# SPEC-019: Sharing, shared items, and the public linkblog

- **Status:** Done
- **Phase:** 4
- **Depends on:** SPEC-005 (Done), SPEC-011 (Done), SPEC-017 (Done)
- **Estimated size:** L

## Context

The reader has no share affordance of any kind. The reading pane header
(`apps/web/src/components/reading-pane/ReadingPane.tsx`) holds an article-view
segmented control, a Star button, and an "Open original" link; the only
clipboard writes in the app are `CopyButton` in `FeedSettingsDialog.tsx` and
the invite-link copy in `AdminPage.tsx`. `navigator.share` appears nowhere.

The bigger opportunity is the feature people still mourn from Google Reader:
**shared items with notes**. You marked an item as shared, optionally wrote a
line about why, and friends subscribed to your shares. This spec builds that
in the most old-web way possible: every user can get a public page of their
shared items that is itself a real feed (Atom + JSON Feed), plus an
instance-local "Community" view so households/teams sharing one deployment see
each other's picks without leaving the app.

Existing machinery this builds on:

- Per-user article state lives in `article_states`
  (`apps/api/src/db/schema.ts`), upserted by `PATCH /api/articles/:id/state`
  (`apps/api/src/routes/articles.ts`), with optimistic client mutations in
  `apps/web/src/lib/articles.ts` (`registerMutationDefaults`,
  `useToggleArticleState`, `patchArticle`). Shared state is exactly one more
  flag on this row: articles stay global and deduplicated, per the data-model
  rule in `CLAUDE.md`.
- The article list route already filters by `starred`
  (`coalesce(article_states.starred, false) = true`); `shared` composes the
  same way, giving the sidebar a "Shared" node for free.
- There are **no unauthenticated routes today**: everything is under the
  `/api` prefix behind `requireAuth`, and the SPA (`apps/web/src/App.tsx`)
  redirects anonymous users to `/login`. Public pages are therefore
  **server-rendered by Fastify at the root scope**, not SPA routes: static,
  crawlable, zero-JS HTML in the oldest and best tradition. Fastify's router
  matches the explicit `/u/:slug` routes ahead of `@fastify/static`'s
  wildcard and the SPA fallback in `app.ts`, so no route collisions arise.

## Goal

A user can (1) share any article to the OS share sheet or clipboard, (2) mark
articles as "shared" with an optional note, visible in a "Shared" sidebar
node, (3) opt in to a public page at `/u/<slug>` listing their shared items
with notes, offered as HTML, Atom, and JSON Feed, and (4) browse what other
users of the instance have shared. Nothing is public unless explicitly turned
on.

## Non-goals

- The public blogroll page (SPEC-020; it extends the `profiles` table and
  route family created here).
- Webmentions, comments, likes, avatars, or any interaction on the public
  page. It is a page and a feed, full stop.
- Following external people. Their linkblogs are feeds; subscribe normally.
- Per-item visibility (an item is on the public page iff shared and the page
  is public).
- Advertising a WebSub hub on the share feeds (see SPEC-021 open questions).
- Pagination of the public page beyond the latest 100 items (open question).

## Data model changes

### 1. `article_states`: the shared flag

Three columns after `starredAt`, following the exact `starred`/`starredAt`
pattern:

```ts
shared: boolean().notNull().default(false),
sharedAt: timestamp({ withTimezone: true }),
shareNote: text(),
```

Plus a partial index for the public page / Shared node query:

```ts
index('article_states_shared_idx')
  .on(t.userId, t.sharedAt)
  .where(sql`${t.shared} = true`),
```

### 2. `profiles`: the public face of a user

New table (one row per user, created lazily when they first touch sharing
settings, like `user_settings`):

```ts
// Public sharing profile (SPEC-019). Row exists only once the user has
// configured sharing; visibility 'off' keeps the slug reserved but nothing
// exposed. SPEC-020 adds blogroll columns here.
export const profiles = pgTable('profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Lowercase, url-safe handle for /u/<slug>. Unique across the instance.
  slug: text().notNull(),
  // Page title; null renders as "<displayName>'s shared items".
  title: text(),
  bio: text(),
  // 'off' | 'instance' | 'public' - see SHARE_VISIBILITIES in @rss/shared.
  visibility: text().notNull().default('instance'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('profiles_slug_key').on(t.slug)]);
```

Semantics of `visibility`:

- `off` - nothing visible anywhere; shared items remain a private list.
- `instance` - shares appear in the in-app Community view for other
  signed-in users; no public page.
- `public` - Community view **and** the public `/u/<slug>` page + feeds.

Migration: `pnpm db:generate` from `apps/api` (next free prefix after the
currently committed `0010_*`), inspect, commit. All additive.

## API changes

### Shared types and schemas (`packages/shared`)

`types.ts`:

```ts
/** Visibility of a user's shared items (SPEC-019). */
export const SHARE_VISIBILITIES = ['off', 'instance', 'public'] as const;
export type ShareVisibility = (typeof SHARE_VISIBILITIES)[number];
```

`schemas/article.ts`:

- `updateArticleStateSchema` gains
  `shared: z.boolean().optional()` and
  `shareNote: z.string().max(2000).nullable().optional()`.
- `articleQuerySchema` gains `shared: z.stringbool().optional()`.
- `articleDetailSchema` gains `shared: z.boolean()` and
  `shareNote: z.string().nullable()`.

New `schemas/profile.ts` (export from `schemas/index.ts`):

```ts
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/; // 3-32 chars

export const updateProfileSchema = z.object({
  slug: z.string().regex(SLUG_RE, 'Lowercase letters, numbers, and dashes').optional(),
  title: z.string().min(1).max(80).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  visibility: z.enum(SHARE_VISIBILITIES).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const profileSchema = z.object({
  slug: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  visibility: z.enum(SHARE_VISIBILITIES),
  /** Absolute URL of the public page, when visibility is 'public'. */
  shareUrl: z.string().nullable(),
});
export type ProfileDto = z.infer<typeof profileSchema>;
```

### Env (`apps/api/src/env.ts`)

Add `PUBLIC_URL: z.url().optional()` (shared with SPEC-021; whichever lands
first adds it, with a `.env.example` line). Public routes fall back to
`${request.protocol}://${request.host}` when unset (fine behind the
`trustProxy: true` already configured in `app.ts`), but PUBLIC_URL gives
stable absolute URLs for feed ids, so recommend setting it.

### `PATCH /api/articles/:id/state` (`routes/articles.ts`)

Extend the existing upsert exactly as `starred` is handled:

- insert values: `shared: input.shared ?? false`,
  `sharedAt: input.shared ? now : null`, `shareNote: input.shareNote ?? null`.
- conflict set: when `input.shared !== undefined`, set
  `shared` and `sharedAt: input.shared ? now : null`, and when un-sharing
  (`shared: false`) also `shareNote: null` (a re-share starts clean); when
  `input.shareNote !== undefined`, set `shareNote: input.shareNote`.

`loadArticleDetail` adds
`shared: sql<boolean>`coalesce(${articleStates.shared}, false)`` and
`shareNote: articleStates.shareNote` to its select and return shape.

### `GET /api/articles` shared filter

Mirror `starred`:

```ts
if (query.shared) {
  filters.push(sql`coalesce(${articleStates.shared}, false) = true`);
}
```

and widen the All-items escape hatch:
`const isAllItems = !query.feedId && !query.folderId && !query.starred && !query.shared && !isSearch;`

### Profile management (new `routes/profile.ts`, registered in `routes/index.ts`)

- `GET /api/profile` (auth): the caller's `ProfileDto`. When no row exists,
  return a suggestion without creating one:
  `{ slug: <username lowercased, filtered to slug charset, padded to 3+>,
  title: null, bio: null, visibility: 'off', shareUrl: null }`.
- `PUT /api/profile` (auth): parse `updateProfileSchema`, upsert the row
  (first PUT must include a valid slug or the suggestion is used). On slug
  unique violation return
  `409 { error: 'slug_taken', message: 'That address is taken', statusCode: 409 }`.
  Returns the merged `ProfileDto`. `shareUrl` is
  `${base}/u/${slug}` when `visibility === 'public'`, else null.

### Community view (in `routes/profile.ts` or its own module)

`GET /api/shares/community` (auth): recent shares from every user whose
profile visibility is `instance` or `public`, **excluding the caller** (their
own live in the Shared node). Keyset-paginated with the existing
chronological cursor helpers (`encodeCursor` / `decodeCursor` from
`lib/cursor.ts`, `t` = `sharedAt`), `limit` 1-100 default 50, ordered
`sharedAt desc, articleId desc`:

```
select st.share_note, st.shared_at,
       u.display_name, p.slug, p.visibility,
       a.id, a.title, a.url, a.summary, a.published_at,
       f.id as feed_id, f.title as feed_title, f.feed_url, f.favicon_url
from article_states st
join users u on u.id = st.user_id and u.disabled_at is null
join profiles p on p.user_id = st.user_id and p.visibility in ('instance','public')
join articles a on a.id = st.article_id
join feeds f on f.id = a.feed_id
where st.shared = true and st.user_id <> $callerId
order by st.shared_at desc, a.id desc
```

Response items:
`{ sharedAt, note, user: { displayName, slug }, article: { id, title, url,
summary, publishedAt }, feed: { id, title, feedUrl, faviconUrl },
subscribed: boolean }` where `subscribed` is computed against the caller's
subscriptions in one extra query (a `Set` of feed ids). The envelope is the
standard `Paginated<T>`.

### Public routes (new `routes/public.ts`, registered at ROOT scope)

In `app.ts`, after `await app.register(registerRoutes, { prefix: '/api' })`:

```ts
await app.register(publicRoutes); // no prefix: serves /u/:slug and friends
```

All three routes 404 unless a profile with that slug exists **and**
`visibility === 'public'`. All send `cache-control: public, max-age=300`.
Shared items are loaded newest-first, capped at 100, via the partial index
(join `articles` + `feeds` for title/url/source metadata).

1. **`GET /u/:slug`** - server-rendered HTML, no JavaScript. Structure:
   - `<title>` and `<h1>`: profile title or `"<displayName>'s shared items"`;
     bio underneath; a discreet "powered by Reader" footer.
   - `<link rel="alternate" type="application/atom+xml" href="/u/<slug>/feed.xml">`
     and `type="application/feed+json" href="/u/<slug>/feed.json"` in
     `<head>` so feed readers (including this one) can discover it.
   - Items marked up as an
     [h-feed of h-entry](https://microformats.org/wiki/h-feed) elements: the
     note (`p-content`, the human voice, rendered first and prominently, in
     the serif), the article title as `u-url` link to the original, source
     feed title linking to the feed's `siteUrl`, and `dt-published` =
     sharedAt.
   - Styling: one inline `<style>` block, system font stack, readable
     measure, `prefers-color-scheme: dark` support. No external requests. A
     small shared layout helper `apps/api/src/lib/public-html.ts` exports
     `esc(s: string)` (HTML-entity escaping; every interpolated value goes
     through it) and `layout({ title, head, body }): string`; SPEC-020 reuses
     both.
2. **`GET /u/:slug/feed.xml`** - Atom, built by hand with `esc()` in a new
   `apps/api/src/lib/share-feeds.ts` (no new dependency; the document is ~20
   lines of template). Feed `id`/`link[rel=self]` from the absolute base;
   `updated` = newest sharedAt; one `entry` per item: `id` =
   `urn:reader:share:<userId>:<articleId>` (stable, opaque), `title` =
   article title or "Untitled", `link` = original article URL (fall back to
   the feed's siteUrl), `updated` = sharedAt, `content type="html"` = the
   escaped note with newlines as `<br>`, followed by an
   `<hr>`-free citation line "Shared from <feed title>". No note: use the
   article summary (already plain text from ingestion).
3. **`GET /u/:slug/feed.json`** - [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/):
   `version`, `title`, `home_page_url` (the HTML page), `feed_url`,
   `authors: [{ name: displayName }]`, items
   `{ id: articleId, url: article.url, title, content_text: note ?? summary
   ?? '', date_published: sharedAt }`.

Security: every interpolation into HTML/XML goes through `esc()`; notes and
titles are attacker-ish input (feed titles come from remote feeds). The pages
expose exactly: display name, slug, chosen title/bio, and shared items with
notes. Nothing else (no email, no username, no read history).

## Web / UI changes

### Share popover (reading pane)

New `apps/web/src/components/reading-pane/SharePopover.tsx`, opened from a
`Share2`-icon button in the `ReadingPane.tsx` header, placed next to the Star
button (both stay visible on phones; the header already wraps). Contents:

- **Copy link** - `navigator.clipboard.writeText(article.url)` +
  `announce('Link copied')` (`@/lib/announce`), same pattern as
  `FeedSettingsDialog`'s `CopyButton`. Disabled when `article.url` is null.
- **Share via device** - shown only when `'share' in navigator`;
  `navigator.share({ title: article.title ?? undefined, url: article.url })`,
  ignoring `AbortError` (user dismissed the sheet).
- Divider, then **"On my shared items"** toggle bound to `article.shared`
  via the extended state mutation, with a note `<textarea>` (visible when
  shared; saved on blur or an explicit small Save button, `PATCH` with
  `{ shareNote }`). When the caller's profile visibility is `public`, show
  the live page URL; when `off`, a quiet hint linking to
  `/settings#sharing` ("Only you can see these until you turn on sharing").

Client mutation plumbing: extend the `ToggleStatePatch` handling in
`apps/web/src/lib/articles.ts` (`registerMutationDefaults`, `patchArticle`,
`currentState`) to carry `shared?: boolean` and `shareNote?: string | null`
optimistically, exactly as `read`/`starred` flow today, and extend
`useToggleArticleState`. `ArticleListItem` (`use-articles.ts`) does **not**
grow a shared field; list rows do not render shared state in this spec.

### Keyboard

`apps/web/src/lib/shortcuts/registry.ts`: add
`{ keys: ['S'], contexts: ['global'], group: 'Article', label: 'Toggle shared',
run: (a) => a.toggleShared() }` (capital S is what `event.key` yields for
shift+s, so no matcher changes are needed), add `toggleShared(): void` to
`ShortcutActions`, and wire it in `ReaderPage.tsx`'s single `useShortcuts`
call: toggle `shared` on the open/focused article and
`announce('Added to shared items' / 'Removed from shared items')`.

### Sidebar

In `ReaderPage.tsx`'s `sidebarInner`, add a **"Shared"** node (icon
`Share2`) directly under "Starred", selecting
`filters = { shared: true, sort: 'newest' }` (add `shared?: boolean` to
`ArticleFilters` in `use-articles.ts` and to `buildQuery`). No count badge,
matching Starred.

Below it, a **"Community"** node (icon `Users`) that renders a new
`CommunityPane` in the content region instead of the article surfaces: a
simple reverse-chronological list (new
`apps/web/src/components/community/CommunityPane.tsx`, plain
`useInfiniteQuery` on `['community']` -> `GET /shares/community`). Each row:
display name + relative time (`formatWhen` from
`components/reader/article-row.ts`), the note in the serif face, the article
title as an external link, and the source feed line with a **Subscribe**
button when `subscribed` is false (fires the existing `POST /feeds` flow via
a small mutation; on success it flips to a quiet "Subscribed" state and
invalidates `['feeds']`). Hide the Community node entirely when the first
page comes back empty and the caller's own visibility is `off` (a solo
instance stays uncluttered). Do not add `'community'` to `PERSISTED_ROOTS`
in `lib/persister.ts`; it is not an offline surface.

### Settings

New **"Sharing"** section card in `SettingsPage.tsx` (after Account), with
`id="sharing"` so the popover hint can deep-link:

- Visibility as the existing in-file `Segmented` control: Off / This
  instance / Public web, with one sentence under each state explaining
  exactly who can see what.
- Slug input (prefixed visually with `/u/`), title, bio; save via
  `PUT /api/profile`; surface `slug_taken` inline.
- When public: the full URL with the `CopyButton` pattern and an "Open"
  link, plus a line noting the page is also an Atom/JSON feed.

## Implementation notes

Order: schema + migration -> shared schemas -> state route + articles filter
-> profile routes -> public routes (HTML, Atom, JSON) -> web mutations +
popover -> sidebar nodes + community pane -> settings card -> shortcut.

- The public HTML/Atom/JSON builders are pure functions of
  `(profile, user, items, baseUrl)`; keep them dependency-free and
  unit-test them as strings.
- `PUT /api/profile` with visibility `public` and no `PUBLIC_URL` still
  works (request-derived base); do not hard-require the env var.
- Rate limiting: the global `@fastify/rate-limit` (300/min/IP) already covers
  the public routes; no per-route change needed.
- The reading pane is the only share surface; cards/list rows stay clean.
- Watch the strict `settingsSchema`: sharing config deliberately does NOT go
  into `user_settings` / `Settings` (it has server-enforced uniqueness and
  its own resource shape).

## Acceptance criteria

- [ ] `article_states.shared/sharedAt/shareNote` and the partial index, plus
      the `profiles` table, exist via a committed migration; `pnpm
      db:generate` reports no drift.
- [ ] PATCHing `{ shared: true }` stamps `sharedAt`; `{ shared: false }`
      clears `sharedAt` and `shareNote`; `{ shareNote }` updates the note
      without touching read/starred; all reflected in `GET /articles/:id`.
- [ ] `GET /api/articles?shared=true` returns only the caller's shared
      items, composing with `unread`, `feedId`, `folderId`, and `q`.
- [ ] The Shared sidebar node lists shared items; `S` toggles shared on the
      focused article with a live-region announcement.
- [ ] The share popover copies a link, offers the OS sheet when available,
      and saves a note; the note round-trips.
- [ ] `PUT /api/profile` enforces the slug regex and returns 409
      `slug_taken` on collision; `GET /api/profile` suggests a slug derived
      from the username before any row exists.
- [ ] With visibility `off` or `instance`, `/u/<slug>` and both feed routes
      return 404. With `public`, the HTML page renders the latest 100 shared
      items with notes, valid h-entry markup, and feed discovery links; the
      Atom validates (W3C feed validator) and the JSON Feed parses.
- [ ] Notes and titles containing `<script>` or quotes render inert on the
      HTML page and in both feeds (escaping verified by test).
- [ ] `GET /api/shares/community` excludes the caller and users with
      visibility `off` or disabled accounts, paginates by cursor, and
      reports `subscribed` correctly; the Subscribe button subscribes.
- [ ] Anonymous requests to every `/api` sharing route still 401; the three
      public routes are the only unauthenticated surface.

## Testing

- **Unit.** Slug regex accept/reject table; HTML/Atom/JSON builders against
  a fixture profile with hostile strings (script tags, quotes, `]]>`);
  suggestion derivation from usernames like `Chris_F` -> `chris-f`.
- **Integration (SPEC-015 harness).** State route: share/unshare/note
  matrix, including note cleared on unshare. Articles filter: shared
  composing with unread/folder/search. Profile: create, update, slug
  collision 409, visibility transitions. Public routes: 404 matrix across
  visibilities, item cap, escaping, cache-control header, feed discovery
  links present. Community: exclusion rules (caller, `off`, disabled),
  cursor pagination disjointness, `subscribed` flag.
- **Manual.** Share sheet on a phone (PWA), popover flow end to end,
  subscribe-from-community, and pointing the reader itself at
  `http://localhost:3000/u/<slug>/feed.xml` (dogfood: your own shares are a
  subscribable feed).

## Open questions

- Public page pagination past 100 items (a `?before=` keyset would be easy;
  waiting to see if anyone shares that much).
- Should shared items also auto-star (Reader-style "share implies keep")?
  Leaning no; the flags stay orthogonal.
- An instance-wide opt-in public firehose page (`/everyone`)? Deferred until
  a real multi-user instance asks for it.
