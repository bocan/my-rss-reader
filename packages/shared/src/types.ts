/**
 * Cross-cutting types shared by the web client and the API.
 * Keep these framework-agnostic: no React, no Fastify, no Drizzle imports.
 */

/** How a list of articles is laid out. (Compact is a density now, not a view.) */
export const VIEW_MODES = ['cards', 'list', 'magazine'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Row/spacing density, applied across views (SPEC-016). */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** How a single article's body is presented. */
export const ARTICLE_VIEWS = ['simplified', 'readable', 'web'] as const;
export type ArticleView = (typeof ARTICLE_VIEWS)[number];

/** Sort order for an article list. */
export const SORT_ORDERS = ['newest', 'oldest'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export type UserRole = 'admin' | 'user';

/** Named color themes (SPEC-016). Each is inherently light or dark. */
export const THEME_IDS = [
  'daylight',
  'paper',
  'meadow',
  'beacon',
  'midnight',
  'ember',
  'pine',
  'void',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeMode = 'light' | 'dark';

/** A theme entry for the picker: id, label, mode, and representative swatches. */
export interface ThemeInfo {
  id: ThemeId;
  name: string;
  mode: ThemeMode;
  /** Approximate hexes for the picker tile (the real colors live in index.css). */
  swatch: { bg: string; fg: string; accent: string };
}

export const THEMES: ThemeInfo[] = [
  { id: 'daylight', name: 'Daylight', mode: 'light', swatch: { bg: '#fbfcfe', fg: '#20242e', accent: '#2f6fd0' } },
  { id: 'paper', name: 'Paper', mode: 'light', swatch: { bg: '#f7f2e9', fg: '#40372c', accent: '#b06a3f' } },
  { id: 'meadow', name: 'Meadow', mode: 'light', swatch: { bg: '#f4f8f2', fg: '#233026', accent: '#3f8f5e' } },
  { id: 'beacon', name: 'Beacon', mode: 'light', swatch: { bg: '#ffffff', fg: '#101114', accent: '#1a44e0' } },
  { id: 'midnight', name: 'Midnight', mode: 'dark', swatch: { bg: '#12151c', fg: '#eef1f6', accent: '#69a8ef' } },
  { id: 'ember', name: 'Ember', mode: 'dark', swatch: { bg: '#1a1712', fg: '#f2ede3', accent: '#e0a24a' } },
  { id: 'pine', name: 'Pine', mode: 'dark', swatch: { bg: '#101917', fg: '#e6efeb', accent: '#3fb6a0' } },
  { id: 'void', name: 'Void', mode: 'dark', swatch: { bg: '#000000', fg: '#ffffff', accent: '#f2c14e' } },
];

/** The theme setting persisted for a user: a named theme or 'auto' (follow OS). */
export const THEME_SETTINGS = ['auto', ...THEME_IDS] as const;
export type ThemeSetting = (typeof THEME_SETTINGS)[number];

/** Auto resolves to these two, chosen by the OS light/dark preference. */
export const DEFAULT_LIGHT_THEME: ThemeId = 'daylight';
export const DEFAULT_DARK_THEME: ThemeId = 'midnight';

/** Resolve a persisted theme setting to a concrete theme id and its mode. */
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ThemeInfo {
  const id = setting === 'auto' ? (prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME) : setting;
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** Visibility of a user's shared items (SPEC-019). */
export const SHARE_VISIBILITIES = ['off', 'instance', 'public'] as const;
export type ShareVisibility = (typeof SHARE_VISIBILITIES)[number];

/** How new accounts may be created for the instance (SPEC-012). */
export const REGISTRATION_MODES = ['open', 'invite', 'closed'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/** Public user shape (never includes password hash). */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

/** A user as seen by an admin: public fields plus the disabled flag (SPEC-012). */
export interface AdminUser extends PublicUser {
  disabledAt: string | null;
}

/** A registration invite as returned by the admin API (SPEC-012). */
export interface InviteDto {
  id: string;
  token: string;
  email: string | null;
  role: UserRole;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
  createdAt: string;
  /** Relative path a new user opens to redeem this invite. */
  link: string;
}

/** Instance-wide settings visible to admins (SPEC-012, SPEC-018). */
export interface AppSettingsDto {
  registrationMode: RegistrationMode;
  defaultPollIntervalSec: number;
}

/** A cursor-paginated response envelope. */
export interface Paginated<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
}

/** Standard API error body. */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/** Unread counts for the sidebar, in one round trip. */
export interface UnreadCounts {
  feeds: { feedId: string; unreadCount: number }[];
  folders: { folderId: string; unreadCount: number }[];
  total: number;
}
