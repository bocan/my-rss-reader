# SPEC-025: Saved searches (virtual feeds) + filter rules

- **Status:** Todo
- **Phase:** 4
- **Depends on:** SPEC-006 (Done), SPEC-015 (Done); coordinates with SPEC-021 if landed (shared ingestion hook)
- **Estimated size:** L

## Context

Full-text search (SPEC-006) works but is ephemeral: `ReaderPage.tsx` holds
`searchInput` local state, debounces it into `ArticleFilters.q`, and the
query dies with the session (search results are even excluded from offline
persistence in `lib/persister.ts` by design). Two power features fall out of
making queries durable:

1. **Saved searches** - a named query + scope pinned to the sidebar,
   behaving like a virtual feed ("postgres", "wasm", "anything by mcilroy").
2. **Filter rules** - standing instructions applied to new articles at
   ingestion: "title contains 'sponsored' -> mark read",
   "author is 'Simon Willison' -> star". This is the useful 80% of
   NewsBlur's training with zero ML and zero mystery.

Ingestion happens in exactly one place today, which makes rules cheap:
`fetchAndStoreFeed()` (`apps/api/src/lib/feed-fetch.ts`) inserts mapped rows
via `feedArticleRows()` with `onConflictDoNothing` on `(feedId, guid)`.
Per-user write fan-out at ingestion is already the established pattern for
state (`article_states` rows are per-user by design), so a rule that marks
an article read for one user simply writes that user's state row.

Sidebar structure (`ReaderPage.tsx` `sidebarInner`: All items / Starred /
Feeds + `FolderTree`), the `RowMenu`/`InlineInput` interaction patterns
(`folder-tree.tsx`), and the `Segmented`/section-card patterns
(`SettingsPage.tsx`) are the UI vocabulary to reuse.

## Goal

A user saves the search they just ran as a named sidebar entry that
re-runs it on click, scope and all. Separately, they define rules that
auto-mark-read or auto-star matching articles the moment the worker ingests
them, with a bounded retroactive apply for existing articles.

## Non-goals

- Regex or query-language rules. Rules match a **case-insensitive phrase**
  against one field. (Saved searches get full `websearch_to_tsquery` power
  because they are just `q`; rules stay dumb and predictable, and no user
  input ever becomes a regex - no ReDoS class at all.)
- Unread counts or badges on saved-search nodes (each would cost a
  relevance query per sidebar refresh; revisit on demand).
- Rule actions beyond `markRead` and `star` (no delete, no notify, no
  move).
- OR-composition or multi-condition rules (two rules = two rows).
- Offline persistence of saved-search results (unchanged from SPEC-006).
- Sharing saved searches between users.

## Data model changes

Two tables in `apps/api/src/db/schema.ts`:

```ts
// A named, scoped search pinned to the sidebar (SPEC-025).
export const savedSearches = pgTable('saved_searches', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  q: text().notNull(),
  // Optional scope captured at save time. feedId cascades (a vanished feed
  // must not silently widen the search); folderId nulls out (folder
  // deletion already promotes its contents, and the search then covers
  // all feeds, matching what the user sees elsewhere).
  feedId: uuid().references(() => feeds.id, { onDelete: 'cascade' }),
  folderId: uuid().references(() => folders.id, { onDelete: 'set null' }),
  starred: boolean().notNull().default(false),
  unread: boolean(), // null = both, matching the tri-state filter
  position: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('saved_searches_user_id_idx').on(t.userId)]);

// A standing ingestion rule (SPEC-025): when <field> contains <phrase>
// (case-insensitive) in <feed | all subscribed feeds>, do <action>.
export const filterRules = pgTable('filter_rules', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  // null = every feed the user is subscribed to at match time.
  feedId: uuid().references(() => feeds.id, { onDelete: 'cascade' }),
  field: text().notNull(),   // 'title' | 'author' | 'content'
  phrase: text().notNull(),
  action: text().notNull(),  // 'markRead' | 'star'
  enabled: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('filter_rules_user_feed_idx').on(t.userId, t.feedId)]);
```

`packages/shared/src/types.ts`:

```ts
export const RULE_FIELDS = ['title', 'author', 'content'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_ACTIONS = ['markRead', 'star'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];
```

Migration: additive; generate, inspect, commit.

## API changes

### Shared schemas (new `packages/shared/src/schemas/search-rules.ts`, exported from the index)

```ts
export const createSavedSearchSchema = z.object({
  name: z.string().min(1).max(60),
  q: z.string().min(1).max(200),
  feedId: z.uuid().nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  starred: z.boolean().default(false),
  unread: z.boolean().nullable().optional(),
});
export const updateSavedSearchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  position: z.number().int().nonnegative().optional(),
});

export const createRuleSchema = z.object({
  feedId: z.uuid().nullable().optional(),
  field: z.enum(RULE_FIELDS),
  phrase: z.string().min(2).max(120),
  action: z.enum(RULE_ACTIONS),
});
export const updateRuleSchema = z.object({
  enabled: z.boolean().optional(),
  phrase: z.string().min(2).max(120).optional(),
  field: z.enum(RULE_FIELDS).optional(),
  action: z.enum(RULE_ACTIONS).optional(),
  feedId: z.uuid().nullable().optional(),
});
```

DTO types for both rows follow the established pattern.

### Saved-search routes (new `routes/searches.ts`, registered in `routes/index.ts`, all `requireAuth`)

- `GET /api/searches` -> `{ items }` ordered `position asc, createdAt asc`.
- `POST /api/searches` -> 201. Validate ownership of scope: `folderId`
  must be the caller's folder, `feedId` one of their subscriptions (400
  `invalid_scope` otherwise). Cap at 50 per user (400 `too_many_searches`).
  `position` = current max + 1.
- `PATCH /api/searches/:id` -> rename / reorder (positions renormalized in
  the style of `lib/ordering.ts`; a plain swap-free append ordering is
  acceptable for v1, note it in code).
- `DELETE /api/searches/:id` -> 204, scoped `where userId`.

Executing a saved search is **not** a new endpoint: the client feeds the
stored fields straight into the existing `GET /api/articles`
(`q`/`feedId`/`folderId`/`starred`/`unread`), inheriting SPEC-006 relevance
ordering, its cursor, and its cap.

### Rule routes (new `routes/rules.ts`, all `requireAuth`)

- `GET /api/rules` -> `{ items }` ordered `createdAt asc`.
- `POST /api/rules` -> 201, same feed-ownership validation, cap 100.
- `PATCH /api/rules/:id`, `DELETE /api/rules/:id` -> standard.
- `POST /api/rules/:id/apply` -> retroactive run over **existing**
  articles: newest 5000 (by the standard sort key) from the rule's scope
  intersected with the caller's subscriptions, matched with a set-based
  statement (below), returns `{ matched: number }`. This bounds the cost
  and covers the "I just created this rule, clean up my backlog" case.

Retroactive matching is pure SQL using `ILIKE` with escaped input
(helper in the new `apps/api/src/lib/rules.ts`):

```ts
/** Escape %, _ and \ so a phrase is a literal ILIKE substring match. */
export function likePattern(phrase: string): string {
  return `%${phrase.replace(/[\\%_]/g, '\\$&')}%`;
}
```

Field mapping: `title -> a.title`, `author -> a.author`,
`content -> coalesce(a.content_text, a.summary)`. The apply statement is an
`insert into article_states ... select ... on conflict do update` in the
exact shape of the mark-read route (`routes/articles.ts`), with the action
column deciding whether `read/read_at` or `starred/starred_at` is set, and
the conflict update using OR-semantics so it never un-reads or un-stars:

```sql
on conflict (user_id, article_id) do update
  set read    = article_states.read    or excluded.read,
      starred = article_states.starred or excluded.starred,
      read_at    = coalesce(article_states.read_at, excluded.read_at),
      starred_at = coalesce(article_states.starred_at, excluded.starred_at)
```

### Ingestion hook (`lib/feed-fetch.ts` + new `lib/rules.ts`)

Make the insert return what it inserted, and funnel both ingestion paths
through one function so SPEC-021 (WebSub pushes) inherits rules for free:

```ts
// lib/feed-fetch.ts
export async function storeNewArticles(
  feedId: string,
  rows: NewArticleInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const inserted = await db.insert(articles).values(rows)
    .onConflictDoNothing({ target: [articles.feedId, articles.guid] })
    .returning({
      id: articles.id, title: articles.title, author: articles.author,
      contentText: articles.contentText, summary: articles.summary,
    });
  if (inserted.length > 0) await applyFilterRules(feedId, inserted);
}
```

`fetchAndStoreFeed` switches its insert block to `storeNewArticles`; if
SPEC-021 is already landed, its callback processing switches too (one-line
change there).

`applyFilterRules(feedId, articles)` in `lib/rules.ts`:

1. One query: enabled rules whose owner is subscribed to `feedId` and
   whose `feedId` is null or equals it
   (`filter_rules join subscriptions using (user_id)` with
   `subscriptions.feed_id = $feedId`).
2. Match in JS (the batch is at most one feed's new items):
   case-insensitive `String.prototype.includes` on the mapped field, no
   regex ever. Collect `(userId, articleId) -> { read, starred }` merged
   across rules.
3. One bulk `insert ... values ... onConflictDoUpdate` with the OR-shaped
   conflict clause above. Never throws upward: catch, log, continue (a
   rule bug must not poison the poll loop; same contract as
   `fetchAndStoreFeed`).

Articles auto-read by a rule are born read: they never inflate unread
counts and never flash in an unread list. That is the entire point.

## Web / UI changes

### Saved searches in the sidebar (`ReaderPage.tsx`)

- New hooks file `apps/web/src/lib/searches.ts`: `useSavedSearches()`
  (`['saved-searches']` -> `GET /searches`), `useCreateSavedSearch`,
  `useUpdateSavedSearch`, `useDeleteSavedSearch` (invalidate the list key).
- In `sidebarInner`, between the Starred/virtual nodes and the "Feeds"
  header: a "Saved searches" group (rendered only when non-empty). Each
  node: `Search` icon + name; selecting it sets
  `filters = { q, feedId?, folderId?, starred?, unread?, sort: 'newest' }`
  **and** sets `searchInput` to `q` so the top-bar search box shows the
  live query (editing the box then behaves exactly like an ad-hoc search;
  the node deselects when the query diverges).
- Node menu (kebab on hover/focus, mirroring `RowMenu` in
  `folder-tree.tsx`): Rename (inline, `InlineInput` pattern) and Delete.
- No counts, no drag-reorder in v1 (PATCH `position` exists for a later
  polish pass).

### Save affordance (top bar)

When `debouncedQ` is non-empty, show a `BookmarkPlus` icon button ("Save
this search") beside the search input. It opens a small popover: name
input prefilled with the query text, a one-line summary of the captured
scope ("in folder Tech, unread only"), Save -> `POST /api/searches` ->
`announce('Search saved')`.

### Rules management (`SettingsPage.tsx`)

New "Rules" section card after Preferences:

- Each rule renders as a sentence:
  "When **title** contains "**sponsored**" in **All feeds** -> **mark
  read**", with an enabled `Toggle`, a "Run on existing articles" button
  (`POST /api/rules/:id/apply`, announce "Matched N articles"), and
  Delete.
- An add-rule row of four controls (field select, phrase input, feed
  select fed by `useSubscriptions()` with an "All feeds" default, action
  select) and an Add button.
- Hooks in `apps/web/src/lib/rules.ts` following the `folders.ts` shape.

No `PERSISTED_ROOTS` changes (`lib/persister.ts`): both features are
online-first, matching search itself.

## Implementation notes

Order: schema + shared schemas -> `storeNewArticles` refactor (existing
worker tests must stay green) -> `lib/rules.ts` + ingestion hook ->
rule routes + apply -> saved-search routes -> sidebar section + save
popover -> settings card.

- **Ownership scoping everywhere**: every rule/search query filters by
  `userId`; the apply endpoint additionally intersects with current
  subscriptions so a rule scoped "all feeds" can never touch articles
  from feeds the user left.
- The ingestion matcher deliberately reads `contentText ?? summary`
  (both already plain text at ingestion, SPEC-006) so rules never parse
  HTML.
- Phrase minimum of 2 chars plus substring semantics keeps accidental
  match-everything rules unlikely; the settings sentence rendering makes
  what a rule does legible at a glance.
- `POST /rules/:id/apply` reuses `likePattern` + `ESCAPE '\'` and binds
  the pattern as a parameter; no string concatenation into SQL.
- Deleting a subscription intentionally leaves rules in place (they
  simply stop matching, since the rules query joins through
  `subscriptions`); a rule row scoped to a deleted **feed** cascades away.

## Acceptance criteria

- [ ] Both tables exist via committed migration; no regenerate drift.
- [ ] Saved search CRUD works with ownership checks, the 50 cap, and
      scope validation (foreign folder/feed -> 400).
- [ ] Clicking a saved search reproduces the exact list the equivalent
      manual search yields (same request shape), populates the search
      box, and highlights the node; editing the query deselects the node.
- [ ] The save button appears only while a query is active and captures
      the live scope (feed/folder/starred/unread) faithfully.
- [ ] A rule created for feed X marks matching **new** articles at the
      next poll: matching-title article arrives read (or starred),
      non-matching arrives untouched, for the rule's owner only; other
      subscribers of the same feed see pristine state.
- [ ] `content` rules match against body text and summary-only feeds;
      `author` rules match `dc:creator`-style authors; matching is
      case-insensitive and non-regex (`.` matches only a literal dot).
- [ ] A disabled rule matches nothing; re-enabling affects only future
      ingestion until "Run on existing articles" is pressed.
- [ ] `POST /api/rules/:id/apply` touches at most 5000 newest in-scope
      articles, returns an accurate `matched`, never un-reads or
      un-stars, and is idempotent.
- [ ] Rules never throw into the poll loop (a crafted phrase like
      `100%_\` ingests fine), and `%`/`_` in phrases match literally in
      the apply path.
- [ ] With SPEC-021 landed, a WebSub-pushed article passes through the
      same rules (single `storeNewArticles` entry point verified by
      test or by construction).

## Testing

- **Unit.** `likePattern` escaping table; JS matcher field mapping,
  case-insensitivity, merge of two rules hitting one article (read +
  star both set); rules query scoping (rule owner not subscribed ->
  excluded).
- **Integration (SPEC-015 harness).** End-to-end poll with a fixture
  feed: seed two users, one rule each, assert per-user state rows after
  `fetchAndStoreFeed`. Apply endpoint: cap, idempotency, OR-conflict
  semantics against pre-existing read/starred rows, ILIKE literalness.
  Saved searches: CRUD matrix, scope validation, cascade on feed delete,
  null-out on folder delete.
- **Manual.** Save a real search, restart the browser, click the node.
  Create a "sponsored -> mark read" rule on a noisy feed and watch the
  next poll. Run apply on a backlog and check the announcement count.

## Open questions

- A quick-create entry point in `FeedSettingsDialog` ("Add a rule for
  this feed") deep-linking to the settings card; skipped to keep the
  dialog lean, revisit after real usage.
- Rule hit counters ("matched 214 articles so far") would make rules
  feel trustworthy; needs a counter column and an increment in the bulk
  upsert. Cheap, but deferred.
- Saved-search drag-reorder alongside feeds/folders once someone
  accumulates enough of them to care.
