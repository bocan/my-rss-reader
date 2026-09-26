import { z } from 'zod';
import { ATTENTION_TIERS, SORT_ORDERS } from '../types.js';

export const articleQuerySchema = z.object({
  /** Restrict to a single feed subscription. */
  feedId: z.uuid().optional(),
  /** Restrict to a folder (and its feeds). */
  folderId: z.uuid().optional(),
  /** Only unread when true, only read when false, all when omitted. */
  unread: z.stringbool().optional(),
  /** Only starred items. */
  starred: z.stringbool().optional(),
  /** Only the caller's shared items (SPEC-019). */
  shared: z.stringbool().optional(),
  /** Restrict to subscriptions of one attention tier (SPEC-022). */
  attention: z.enum(ATTENTION_TIERS).optional(),
  /** Full-text search across title + content. */
  q: z.string().min(1).max(200).optional(),
  sort: z.enum(SORT_ORDERS).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ArticleQuery = z.infer<typeof articleQuerySchema>;

/**
 * How many articles joined a list scope after `since` (the list's `asOf`), for
 * the "N new articles" bar (#30). Search has no such bar.
 */
export const newArticleCountQuerySchema = articleQuerySchema
  .pick({ feedId: true, folderId: true, unread: true, starred: true, shared: true, attention: true })
  .extend({ since: z.iso.datetime({ offset: true }) });
export type NewArticleCountQuery = z.infer<typeof newArticleCountQuerySchema>;

export const updateArticleStateSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  /** Add to / remove from the caller's shared items (SPEC-019). */
  shared: z.boolean().optional(),
  /** Optional note shown with a shared item; null clears it. */
  shareNote: z.string().max(2000).nullable().optional(),
});
export type UpdateArticleStateInput = z.infer<typeof updateArticleStateSchema>;

export const articleFeedSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  siteUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
});

/** Full article payload for the reading pane (GET /articles/:id). */
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
  /** Playable podcast/video enclosure (audio/* or video/* only). */
  enclosureUrl: z.string().nullable(),
  enclosureType: z.string().nullable(),
  feed: articleFeedSchema,
  read: z.boolean(),
  starred: z.boolean(),
  shared: z.boolean(),
  shareNote: z.string().nullable(),
});
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

/** Query for GET /articles/:id/readable. */
export const readableQuerySchema = z.object({
  refresh: z.stringbool().optional(),
});
export type ReadableQuery = z.infer<typeof readableQuerySchema>;

/**
 * Bulk mark-as-read (e.g. "mark all read in this folder"). With neither
 * feedId nor folderId it covers All items, which (like the list) leaves out
 * feeds hidden from All items.
 */
export const markReadSchema = z.object({
  feedId: z.uuid().optional(),
  folderId: z.uuid().optional(),
  /** Only mark items published (or, if undated, fetched) before this time. */
  before: z.iso.datetime().optional(),
  /** Only mark items the server had stored by this time (a list's `asOf`). */
  fetchedBefore: z.iso.datetime().optional(),
  /**
   * Only these articles (mark read on scroll, #17). Hidden feeds are not
   * left out here: the ids came from a list that showed them.
   */
  articleIds: z.array(z.uuid()).min(1).max(200).optional(),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

/**
 * POST /articles/mark-read answer: exactly the articles this call turned from
 * unread to read (already-read ones are left out), for Undo (#26).
 */
export interface MarkReadResult {
  markedIds: string[];
}

/** Undo a mark-read (#26): set these articles back to unread. */
export const markUnreadSchema = z.object({
  articleIds: z.array(z.uuid()).min(1).max(20_000),
});
export type MarkUnreadInput = z.infer<typeof markUnreadSchema>;
