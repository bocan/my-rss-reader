import { z } from 'zod';
import { SORT_ORDERS } from '../types.js';

export const articleQuerySchema = z.object({
  /** Restrict to a single feed subscription. */
  feedId: z.uuid().optional(),
  /** Restrict to a folder (and its feeds). */
  folderId: z.uuid().optional(),
  /** Only unread when true, only read when false, all when omitted. */
  unread: z.stringbool().optional(),
  /** Only starred items. */
  starred: z.stringbool().optional(),
  /** Full-text search across title + content. */
  q: z.string().min(1).max(200).optional(),
  sort: z.enum(SORT_ORDERS).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ArticleQuery = z.infer<typeof articleQuerySchema>;

export const updateArticleStateSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
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
});
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

/** Query for GET /articles/:id/readable. */
export const readableQuerySchema = z.object({
  refresh: z.stringbool().optional(),
});
export type ReadableQuery = z.infer<typeof readableQuerySchema>;

/** Bulk mark-as-read (e.g. "mark all read in this folder"). */
export const markReadSchema = z.object({
  feedId: z.uuid().optional(),
  folderId: z.uuid().optional(),
  /** Only mark items older than this ISO timestamp. */
  before: z.iso.datetime().optional(),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;
