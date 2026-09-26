import { FIREHOSE_EXPIRY_DAYS, type AttentionTier } from '@rss/shared';

/**
 * Plain names for the attention tiers (#36). The stored values stay
 * firehose / normal / precious; only what the user reads changed.
 */
export const ATTENTION_LABELS: Record<AttentionTier, string> = {
  firehose: 'Skim',
  normal: 'Normal',
  precious: 'Must read',
};

/** What each tier does, in one line, including the expiry rule. */
export const ATTENTION_EFFECTS: Record<AttentionTier, string> = {
  firehose: `No unread count, and left out of the All items and folder totals. Unread articles older than ${FIREHOSE_EXPIRY_DAYS} days count as read.`,
  normal: 'Unread counts as usual.',
  precious: 'Highlighted, and listed under "Must read" in the sidebar.',
};
