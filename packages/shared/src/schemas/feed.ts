import { z } from 'zod';
import { ARTICLE_VIEWS, ATTENTION_TIERS, VIEW_MODES } from '../types.js';

export const subscribeSchema = z.object({
  url: z.url(),
  folderId: z.uuid().nullable().optional(),
  /** Override the feed's own title for this user. */
  title: z.string().min(1).max(200).optional(),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;

export const updateSubscriptionSchema = z.object({
  folderId: z.uuid().nullable().optional(),
  title: z.string().min(1).max(200).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  /** Per-feed list-view override (SPEC-011). null clears it (inherit default). */
  viewMode: z.enum(VIEW_MODES).nullable().optional(),
  /** Per-feed article-view override (SPEC-018). null clears it. */
  articleView: z.enum(ARTICLE_VIEWS).nullable().optional(),
  /** Exclude this feed from the All-items list and its unread total (SPEC-018). */
  hideFromAll: z.boolean().optional(),
  /** Include this subscription in the owner's public blogroll (SPEC-020). */
  inBlogroll: z.boolean().optional(),
  /** Attention tier (SPEC-022). */
  attention: z.enum(ATTENTION_TIERS).optional(),
  /**
   * Poll interval for the shared feed, in seconds (SPEC-018). null inherits the
   * app default. This targets the global feed, so it affects all subscribers.
   */
  fetchIntervalSec: z.number().int().min(60).max(86400).nullable().optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

/** Re-point a subscription at a feed living at a new URL (SPEC-018). */
export const changeFeedUrlSchema = z.object({
  feedUrl: z.url(),
});
export type ChangeFeedUrlInput = z.infer<typeof changeFeedUrlSchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.uuid().nullable().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

/** Rename / reparent / reorder a folder. position is a desired 0-based index. */
export const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

/** OPML import payload (raw XML string). */
export const importOpmlSchema = z.object({
  opml: z.string().min(1),
});
export type ImportOpmlInput = z.infer<typeof importOpmlSchema>;

/** Summary returned by POST /opml/import. */
export const importOpmlResultSchema = z.object({
  foldersCreated: z.number().int(),
  feedsAdded: z.number().int(),
  skipped: z.number().int(),
  failed: z.array(
    z.object({
      title: z.string().nullable(),
      xmlUrl: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});
export type ImportOpmlResult = z.infer<typeof importOpmlResultSchema>;

/** Query for GET /feeds/discover. */
export const discoverFeedsQuerySchema = z.object({ url: z.url() });
export type DiscoverFeedsQuery = z.infer<typeof discoverFeedsQuerySchema>;

/** One discoverable feed, returned by discovery and echoed in a 409 body. */
export const feedCandidateSchema = z.object({
  feedUrl: z.url(),
  title: z.string().nullable(),
});
export type FeedCandidate = z.infer<typeof feedCandidateSchema>;

/** Response body for GET /feeds/discover. */
export const discoverFeedsResponseSchema = z.object({
  candidates: z.array(feedCandidateSchema),
});
export type DiscoverFeedsResponse = z.infer<typeof discoverFeedsResponseSchema>;

/**
 * 409 body from POST /feeds when a homepage exposes multiple feeds. A superset
 * of ApiError so it flows through the client's typed error wrapper.
 */
export const ambiguousFeedErrorSchema = z.object({
  error: z.literal('ambiguous_feed'),
  message: z.string(),
  statusCode: z.literal(409),
  candidates: z.array(feedCandidateSchema),
});
export type AmbiguousFeedError = z.infer<typeof ambiguousFeedErrorSchema>;
