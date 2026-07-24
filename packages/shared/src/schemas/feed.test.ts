import { describe, expect, test } from 'vitest';
import { updateAppSettingsSchema } from './admin.js';
import { updateSubscriptionSchema } from './feed.js';

describe('updateSubscriptionSchema (SPEC-018)', () => {
  test('accepts the new per-feed fields', () => {
    expect(
      updateSubscriptionSchema.safeParse({
        articleView: 'web',
        hideFromAll: true,
        fetchIntervalSec: 1800,
      }).success,
    ).toBe(true);
  });

  test('null clears the article-view override and the interval', () => {
    expect(updateSubscriptionSchema.safeParse({ articleView: null }).success).toBe(true);
    expect(updateSubscriptionSchema.safeParse({ fetchIntervalSec: null }).success).toBe(true);
  });

  test('rejects an out-of-range interval and a bad article view', () => {
    expect(updateSubscriptionSchema.safeParse({ fetchIntervalSec: 10 }).success).toBe(false); // < 60s
    expect(updateSubscriptionSchema.safeParse({ fetchIntervalSec: 999999 }).success).toBe(false);
    expect(updateSubscriptionSchema.safeParse({ articleView: 'pdf' }).success).toBe(false);
  });
});

describe('updateAppSettingsSchema (SPEC-018)', () => {
  test('accepts a default poll interval within bounds', () => {
    expect(updateAppSettingsSchema.safeParse({ defaultPollIntervalSec: 900 }).success).toBe(true);
  });

  test('requires at least one field and bounds the interval', () => {
    expect(updateAppSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateAppSettingsSchema.safeParse({ defaultPollIntervalSec: 30 }).success).toBe(false);
  });
});
