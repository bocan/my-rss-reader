import { z } from 'zod';

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
});
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

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
