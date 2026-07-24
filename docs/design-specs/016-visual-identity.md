# SPEC-016: Visual identity — themes, typography, and density

- **Status:** Done — Phase 1 (theme engine), Phase 2 (typography), Phase 3
  (density + compact retirement) all shipped
- **Phase:** 3
- **Depends on:** SPEC-011 (server-persisted settings), SPEC-010/014 (views/layout)
- **Estimated size:** L (multi-day; built in phases)

## Context

The app is visually clean but "templated": the design is the stock shadcn/oklch
token set (`apps/web/src/index.css`, ~18 CSS variables), neutrals are dead-gray
`oklch(L 0 0)`, the type is the default system sans, and theming is a single
light/dark/system toggle (`lib/theme.ts`, SPEC-011). The owner wants real
identity: a set of hover-previewable themes, distinctive typography, and a
density control that also resolves the "compact view is too close to list"
problem flagged after SPEC-010/014.

Because the entire UI is driven by those ~18 tokens, multi-theming is cheap
mechanically; the work is curation. This spec adds a theme engine + 8 curated
themes, self-hosted typography, and a density axis, unified by a small motion
language.

## Goal

Clicking the theme control opens a palette of 8 named themes plus Auto; hovering
a tile recolors the whole app live, clicking persists it. The app has a
distinctive, self-hosted typographic voice (UI sans + on-screen reading serif),
and a density control (Comfortable / Compact) that replaces the redundant
"compact" list view. Everything honors `prefers-reduced-motion` and keeps the
no-flash first paint.

## Non-goals

- User-authored / custom themes (only the 8 curated ones + Auto).
- Per-feed or per-article theme overrides (theme is a single account setting).
- A full type-ramp redesign of every component; we set the faces, scale, and
  reading measure, not bespoke styling per screen.
- Right-to-left or localization typography.

## Decisions taken

- **Auto** follows the OS, using **Daylight** in light and **Midnight** in dark;
  choosing any named theme pins it (per owner).
- **Compact becomes a density, not a view.** `VIEW_MODES` drops to
  `cards | list | magazine`; a new `density` axis (`comfortable | compact`)
  applies across views. This removes the list/compact redundancy.
- **Type pairing (proposed, swappable):** UI sans **Hanken Grotesk**, reading
  serif **Newsreader** (built for on-screen reading), mono **JetBrains Mono** —
  all OFL-licensed so self-hosting is clean. Owner may veto any face.

## The 8 themes

Half light, half dark; two high-contrast. Each has a distinct neutral
temperature and accent (not hue-rotations of one theme). Neutrals are tinted a
hair toward the accent hue rather than pure gray.

| id | name | mode | mood | accent |
| --- | --- | --- | --- | --- |
| `daylight` | Daylight | light | cool clean white *(default light)* | azure |
| `paper` | Paper | light | warm ivory/sepia, ink-brown text | clay |
| `meadow` | Meadow | light | soft light, botanical | green |
| `beacon` | Beacon | light | **high-contrast** white/near-black, bold rings | vivid blue |
| `midnight` | Midnight | dark | cool slate near-black *(default dark)* | azure |
| `ember` | Ember | dark | warm charcoal, cozy | amber |
| `pine` | Pine | dark | deep green-black | teal |
| `void` | Void | dark | **high-contrast** true black (OLED), pure white | high-vis |

## Data model changes

`apps/api/src/db/schema.ts`, then generate + commit the migration:

- `user_settings.theme`: change from the `theme_pref` enum to `text` holding a
  theme id or `'auto'` (default `'auto'`). Map existing values on migrate
  (`light -> daylight`, `dark -> midnight`, `system -> auto`). Drop `theme_pref`.
- `user_settings.density`: new `text`/enum `density_pref('comfortable','compact')`,
  default `'comfortable'`.
- `view_mode` enum + `subscriptions.viewMode`: remove `compact` from the offered
  set. Postgres enums can't drop a value in place, so introduce a new enum
  `view_mode` value set `('cards','list','magazine')` via a create-swap-drop
  migration (or a `text` column with an app-level check). Existing `compact`
  rows migrate to `list` (and the account gets `density='compact'` is **not**
  auto-applied; compact rows simply become list).

## API / shared changes

- `packages/shared`:
  - Replace the `THEMES`/`ThemePref` model with a theme registry:
    `THEMES: { id: ThemeId; name: string; mode: 'light'|'dark' }[]` plus the
    literal `'auto'`; export `ThemeSetting = ThemeId | 'auto'`. Keep swatch
    colors (a few representative hexes per theme) for the picker tiles.
  - `DENSITIES = ['comfortable','compact']`, `Density` type.
  - `VIEW_MODES` becomes `['cards','list','magazine']`.
  - `settingsSchema` / `updateSettingsSchema`: `theme` becomes the theme-setting
    enum, add `density`. `DEFAULT_SETTINGS` gains `density: 'comfortable'` and
    `theme: 'auto'`; must equal the new DB defaults (enum drift test updated).
- `apps/api`: settings route already upserts partial settings; just widens with
  the new fields. The enum drift test (`db/enums.test.ts`) updates to the new
  view-mode set and the density enum.

## Web / UI changes

### Theme engine (`lib/theme.ts`, `index.css`)

- In `index.css`, define every theme as `:root[data-theme="<id>"] { …tokens… }`
  overriding the ~18 variables (background/foreground/card/primary/muted/accent/
  border/ring/destructive + tinted neutrals). Keep base `:root` = Daylight and
  `.dark` in sync so existing `dark:` utilities and the `@custom-variant dark`
  keep working: applying a theme sets `data-theme` **and** toggles `.dark` when
  the theme's mode is dark.
- Add a `--font-sans`, `--font-serif`, `--font-mono`, and motion tokens
  (`--ease-standard`, `--dur-fast/base`) to the theme layer.
- `resolveTheme(setting, prefersDark)` -> `{ id, mode }`: `'auto'` maps to
  `daylight`/`midnight` by `prefersDark`; a named id maps to itself.
- `initTheme()` keeps the synchronous pre-mount paint: read `'rss-theme'`
  (now a theme setting), resolve, set `data-theme` + `.dark` before React mounts.
- `useTheme()` (wraps `useSettings`): applies the resolved theme on change,
  mirrors to `localStorage`, keeps the `matchMedia` listener for `'auto'`, and
  exposes `setTheme(setting)`, the theme list, and a **preview(setting|null)**
  that applies a theme to the DOM without persisting (for hover).
- Crossfade: a short root color transition on theme change, wrapped in
  `@media (prefers-reduced-motion: no-preference)`.

### Theme picker

- Replace the cycle button in `AppShell` with a popover trigger opening a grid of
  swatch tiles (8 + Auto). Each tile: `onPointerEnter` -> `preview(id)`,
  `onPointerLeave` -> `preview(null)` (revert to persisted), `onClick` ->
  `setTheme(id)`. Keyboard: roving tabindex, arrows move focus (and preview),
  Enter selects, Escape closes and reverts. `aria-pressed` on the active tile.
- Mirror the same grid in `SettingsPage` (replacing the theme segmented control),
  plus a Density segmented control (Comfortable / Compact).

### Typography

- Self-host the three variable fonts as woff2 under `apps/web/src/assets/fonts/`
  (bundled by Vite, so the PWA precache covers them offline; no external CDN,
  CSP-safe). `@font-face` with `font-display: swap` and explicit `unicode-range`
  if trimming.
- Wire `--font-sans` (Hanken Grotesk) as the UI face on `body`; `--font-mono`
  (JetBrains Mono) for `code`/`pre`. Apply `--font-serif` (Newsreader) to the
  reading pane `.prose` body so long-form reads as a proper article, with tuned
  `line-height`, `max-width` (~66ch measure), and heading rhythm.
- A small type scale for UI (title / section / body / meta) applied to the app
  chrome so headings feel intentional.

### Density

- `density` (from settings) sets a `data-density` attribute on the app root.
  List rows, cards, the reading-pane header, and nav items read it via CSS
  (`[data-density="compact"]`) to tighten padding, row height, and meta size.
- Remove `compact` from the view switcher (`ViewSwitcher`) and any view-mode
  maps; the three remaining views each respond to density.

## Implementation notes / phases

Build and verify in phases (each independently shippable and gated):

1. **Theme engine + 8 themes + picker** — schema (theme text + migration),
   shared registry, `index.css` theme blocks with tinted neutrals + accent
   system + motion tokens, `theme.ts`/`useTheme` rework, the picker, Settings
   grid. This is the headline; do it first.
2. **Typography** — self-host fonts, wire faces, type scale, prose tuning.
3. **Density + compact retirement** — `density` setting + `data-density` CSS,
   drop `compact` view (migration), density control in Settings.

Notes:
- The no-flash contract (SPEC-011) must survive: `initTheme` resolves and applies
  before paint; the `localStorage` mirror now stores a theme setting.
- Keep the accent system honest: unread dot, star, active nav, selected row,
  focus ring, and links all derive from `--primary` / `--ring` so every theme
  recolors them for free.
- Accessibility: Beacon and Void must clear WCAG AA (aim AAA for body text);
  verify contrast for each theme's foreground-on-background and
  primary-foreground-on-primary. Focus rings must be visible on every theme.
- Fonts must be OFL and self-hosted; no runtime font fetch (offline + CSP).

## Acceptance criteria

- [ ] The theme control opens a grid of 8 themes + Auto; hovering a tile recolors
      the whole app live and leaving reverts to the saved theme; clicking
      persists it (server-backed) and survives reload with no flash.
- [ ] Auto follows the OS (Daylight/Midnight); a named theme pins regardless of
      OS; `prefers-reduced-motion` disables the crossfade.
- [ ] All 8 themes apply cohesively (chrome, list, reading pane, prose, focus
      rings, unread/star/selected states) with tinted neutrals; Beacon and Void
      meet high-contrast targets.
- [ ] The UI uses the self-hosted UI sans and the reading pane uses the serif;
      fonts load offline from the precache with no external request.
- [ ] A Density control (Comfortable / Compact) changes row/card/reading density
      across views; the `compact` view mode is gone and existing compact
      subscriptions render as list.
- [ ] `DEFAULT_SETTINGS` equals the DB defaults (`theme: 'auto'`,
      `density: 'comfortable'`); the enum drift test passes for the new sets.

## Testing

- Unit (shared): theme registry integrity (every `THEMES` id has a mode;
  `resolveTheme('auto', true/false)` maps to midnight/daylight); settings schema
  accepts the new theme ids + density and rejects junk; `DEFAULT_SETTINGS`
  matches.
- Unit (web): `useTheme` applies `data-theme` + `.dark` for a named theme and for
  Auto under mocked `matchMedia`; `preview(id)` changes the DOM without writing
  the settings cache; `preview(null)` reverts.
- Unit (api): enum drift guard for the new `view_mode` set and `density` enum.
- Integration (api): settings round-trip persists `theme` (a named id and
  `auto`) and `density`; a removed `compact` value is rejected as an out-of-set
  view mode.
- Manual / live: hover every tile and confirm the live recolor + revert; reload
  on a pinned dark theme and confirm no light flash; toggle OS appearance under
  Auto; verify contrast on Beacon/Void; go offline and confirm fonts still
  render; switch density and see rows tighten.

## Open questions

- Font pairing is a taste call — Hanken Grotesk / Newsreader / JetBrains Mono is
  the proposal; swap any before Phase 2.
- Should Auto's light/dark pair become user-selectable later (deferred here per
  the "pair the defaults" decision)?
