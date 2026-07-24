# SPEC-009: OPML import / export

- **Status:** Done
- **Phase:** 2
- **Depends on:** SPEC-002, SPEC-007
- **Estimated size:** M

## Context

OPML is the lingua franca for moving a subscription list between readers.
`packages/shared/src/schemas/feed.ts` already exports `importOpmlSchema`
(`{ opml: z.string().min(1) }`) but nothing consumes it - there is no import or
export route, and no UI. SPEC-002 built the pieces this spec reuses:
`discoverFeedCandidates`, `fetchAndParseFeed`, and `fetchAndStoreFeed` in
`apps/api/src/lib/feed-fetch.ts`, plus the dedup behavior in `POST /feeds`
(existing `feeds` row -> reuse, no re-fetch). SPEC-007 built the folder model
end to end (`PATCH`/`DELETE /folders`, one-level nesting, `position`
renormalize). This spec wires those into a batch importer that walks a nested
`<outline>` tree, and an exporter that writes the same tree back out.

## Goal

A user opens Settings, picks an OPML file exported from another reader, and
their folders and subscriptions appear in the sidebar with nesting preserved,
skipping anything they already follow and reporting anything that failed
without aborting the rest. They can also download an OPML file of their current
folders and feeds that another reader (or this one) can re-import cleanly.

## Non-goals

- Round-tripping per-user reading state, tags, or non-standard vendor
  attributes - only folders, feed title, `xmlUrl`, `htmlUrl`.
- Nesting deeper than one level. OPML may nest arbitrarily; on import we flatten
  outlines deeper than one level up to the nearest importable folder (see
  Implementation notes), matching the SPEC-007 one-level constraint.
- Background/async import jobs or upload resumption - import runs inside the
  request (bounded by the size limit below).
- Scheduled or automatic re-import / sync with an external service.

## Data model changes

None. Import writes through the existing `folders`, `feeds`, and
`subscriptions` tables using the SPEC-002/007 code paths.

## API changes

Both routes require auth (`{ preHandler: app.requireAuth }`), live in a new
`apps/api/src/routes/opml.ts` registered under an `/opml` prefix, and are scoped
to `request.user!.id`.

**`POST /opml/import`** (new) - body is `importOpmlSchema` (`{ opml: string }`),
the raw OPML XML as a JSON string field. Body-string is chosen over
`@fastify/multipart`: the payload is small, it keeps one Zod-validated JSON body
consistent with every other route, needs no multipart plugin or streaming, and
the client already has the file contents in memory after `File.text()`. Enforce
a size limit (config `OPML_MAX_BYTES`, default 5 MB) - reject larger bodies
`413 { error: 'opml_too_large' }` before parsing; the route body limit and the
Zod `.max()` both guard it.

- Parse the XML (fast-xml-parser). On malformed XML or a missing `<opml>`/`<body>`
  root, return `400 { error: 'invalid_opml', message }` - never throw a 500.
- Walk `body > outline` recursively. An outline **with** `xmlUrl` is a
  subscription; an outline **without** `xmlUrl` (but with children or a
  `title`/`text`) is a folder. Preserve parent -> child nesting one level deep.
- For each folder outline: find-or-create a `folders` row for this user by
  `name` under the resolved parent (case-insensitive match to avoid duplicate
  folders on re-import); reuse SPEC-007's `position` renormalize for ordering.
- For each subscription outline: run the SPEC-002 subscribe path
  (`discoverFeedCandidates` is skipped when `xmlUrl` already resolves to an
  existing `feeds` row; otherwise `fetchAndParseFeed` + `fetchAndStoreFeed`),
  then upsert the `subscriptions` row with `folderId` set to the enclosing
  folder and `customTitle` from the outline `title`/`text` when present.
- **Resilience:** each outline is processed independently inside its own
  try/catch (and its own short transaction for the folder/subscription write).
  One feed that 404s, times out, or is ambiguous is recorded in `failed[]` and
  does not abort the batch. Process feeds with a small concurrency cap
  (e.g. `p-limit`, 5) so a few hundred feeds do not open hundreds of sockets.
- Dedup: an `xmlUrl` the user already subscribes to counts as `skipped`, not
  `failed`; a folder that already exists is reused, not recreated.
- Response `200`:
  ```ts
  {
    foldersCreated: number,
    feedsAdded: number,
    skipped: number,            // already-subscribed feeds
    failed: { title: string | null, xmlUrl: string | null, reason: string }[]
  }
  ```

**`GET /opml/export`** (new) - builds an OPML 2.0 document (fast-xml-parser
builder) from the user's folders (nested, ordered by `position`) and their
feeds. Each feed outline carries `type="rss"`, `text`/`title`, `xmlUrl`
(`feeds.feedUrl`), and `htmlUrl` (`feeds.siteUrl`, omitted when null). Root-level
feeds (no folder) are top-level outlines. Set
`Content-Type: text/x-opml; charset=utf-8` and
`Content-Disposition: attachment; filename="reader-subscriptions.opml"`. All
attribute values are XML-escaped by the builder; free text uses CDATA only where
a value could contain markup.

**`packages/shared/src/schemas/feed.ts`** addition (import response type, so web
and api share it):

```ts
export const importOpmlResultSchema = z.object({
  foldersCreated: z.number().int(),
  feedsAdded: z.number().int(),
  skipped: z.number().int(),
  failed: z.array(z.object({
    title: z.string().nullable(),
    xmlUrl: z.string().nullable(),
    reason: z.string(),
  })),
});
export type ImportOpmlResult = z.infer<typeof importOpmlResultSchema>;
```

## Web / UI changes

- New route `apps/web/src/routes/SettingsPage.tsx` (or an "Import / Export"
  section if a settings shell already exists), reachable from a sidebar/menu
  link. SPEC-011 owns broader settings; this spec adds only the OPML panel.
- **Import:** a file `<input type="file" accept=".opml,.xml,text/xml,text/x-opml">`;
  on select, read via `await file.text()`, then `POST /opml/import` through a
  TanStack Query `useMutation`. While pending, show an indeterminate progress
  indicator (the request is synchronous server-side, so progress is "importing
  N feeds..." spinner state, not a percentage). On success, invalidate the
  `['feeds']` and `['folders']` queries so the sidebar reflects new items, and
  render the summary: counts for created / added / skipped plus a collapsible
  list of `failed[]` rows (`title` - `xmlUrl` - `reason`).
- **Export:** a "Download OPML" button that fetches `GET /opml/export` and
  triggers a browser download (blob + object URL, or a plain `<a download>`
  pointing at the endpoint since it is a GET with a `Content-Disposition`).
- Client-side guard: reject files over `OPML_MAX_BYTES` before uploading with a
  clear inline message, mirroring the server limit.
- Follow existing shadcn/ui usage (Button, Card, and Progress/Spinner if
  present); tokens from `src/index.css`.

## Implementation notes

- Add `fast-xml-parser` to `apps/api` (used for both parse and build - one
  dependency, no separate serializer). Configure the parser with
  `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, and
  `processEntities: true`; the builder with `format: true`, `suppressEmptyNode:
  true`, and `cdataPropName` for CDATA text. Keep both configs in a small
  `apps/api/src/lib/opml.ts` module (`parseOpml(xml) -> tree`,
  `buildOpml(folders, feeds) -> xml`) so the routes stay thin and the parse/build
  logic is unit-testable without HTTP.
- fast-xml-parser returns a single object vs an array depending on outline
  count; normalize `outline` to an array before walking (a common footgun).
- Flatten depth: when an outline nests more than one level, attach the deeper
  subscriptions to their nearest already-created folder (the grandparent folder)
  rather than dropping them, so no feed is lost - note this lossy behavior in the
  summary is not needed, but do not error on it.
- Order of operations per outline: create/reuse the folder first, then its child
  subscriptions, so a subscription always has its `folderId` available.
- Reuse SPEC-002 error semantics: a subscribe that fails to fetch still records
  the feed as added (worker retries) unless discovery itself fails - decide once
  and keep import consistent with `POST /feeds`. Ambiguous multi-candidate feeds
  from a bare `htmlUrl` with no `xmlUrl` go to `failed[]` (import cannot prompt).
- Security: import fetches arbitrary user-supplied feed URLs - same SSRF surface
  as SPEC-002, no new exposure. The size limit and concurrency cap bound
  resource use from a hostile or huge OPML file. XML parsing must have entity
  expansion disabled/bounded (fast-xml-parser does not resolve external entities,
  so billion-laughs / XXE is not reachable) - assert this in a test.

## Acceptance criteria

- [ ] `GET /opml/export` returns valid OPML 2.0 with `text/x-opml` content type,
      nested folders as nested `<outline>` elements, and feed outlines carrying
      `title`, `xmlUrl`, and `htmlUrl`.
- [ ] Round trip: exporting a user's set then importing that same file into a
      fresh user reproduces the identical folder tree and subscriptions.
- [ ] Importing preserves one level of folder nesting; feeds land in the right
      folders.
- [ ] Importing a file whose feeds the user already follows reports them as
      `skipped` and creates no duplicate `feeds` or `subscriptions` rows; an
      existing folder of the same name is reused, not duplicated.
- [ ] A single unreachable / malformed feed in the file lands in `failed[]` with
      a reason and does not abort the rest of the import.
- [ ] Malformed OPML (bad XML, wrong root) returns `400 invalid_opml` with a
      clear message, never a 500 or crash.
- [ ] A body over `OPML_MAX_BYTES` is rejected `413` before parsing.
- [ ] A file with several hundred feeds completes and returns an accurate
      summary; concurrency is capped.
- [ ] The Settings screen imports a picked file, shows progress, then the
      summary; the export button downloads a `.opml` file.

## Testing

- Unit (`opml.ts`): `parseOpml` on nested outlines, single vs multiple outlines
  (array normalization), folder vs subscription discrimination by `xmlUrl`
  presence, and a malformed-XML input (expect a thrown/typed parse error the
  route maps to 400). `buildOpml` produces well-formed XML with correctly
  escaped attribute values (ampersands, quotes, `<`/`>` in titles) and CDATA
  where used.
- Unit: an OPML containing an external-entity / billion-laughs payload parses
  without expansion (no hang, no file read).
- Integration (`POST /opml/import`): a nested file creates folders and feeds
  with correct `folderId`s; a file with an already-subscribed `xmlUrl` returns
  `skipped >= 1` and no duplicate rows (mocked `fetchAndParseFeed`, assert call
  count for dedup); a file mixing one good and one failing feed returns both
  `feedsAdded` and a populated `failed[]`; malformed XML returns 400; oversize
  body returns 413.
- Integration round-trip: seed folders + feeds, `GET /opml/export`, feed the
  response body straight back into `POST /opml/import` for a second user, and
  assert the resulting tree matches the first user's.
- Manual: export from a real other reader (e.g. an existing OPML file), import
  it, confirm the sidebar tree and favicons match and the summary is accurate.

## Open questions

- Should a bare `htmlUrl`-only outline (no `xmlUrl`) attempt discovery, or go
  straight to `failed[]`? Default: `failed[]` to keep import non-interactive and
  fast; revisit if real-world files commonly omit `xmlUrl`.
