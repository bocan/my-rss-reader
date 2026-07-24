/**
 * Cross-cutting types shared by the web client and the API.
 * Keep these framework-agnostic: no React, no Fastify, no Drizzle imports.
 */

/** How a list of articles is rendered in the reading pane. */
export const VIEW_MODES = ['cards', 'list', 'magazine', 'compact'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** How a single article's body is presented. */
export const ARTICLE_VIEWS = ['simplified', 'readable', 'web'] as const;
export type ArticleView = (typeof ARTICLE_VIEWS)[number];

/** Sort order for an article list. */
export const SORT_ORDERS = ['newest', 'oldest'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export type UserRole = 'admin' | 'user';

/** Public user shape (never includes password hash). */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
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
