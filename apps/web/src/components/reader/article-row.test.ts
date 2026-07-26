import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatWhen } from './article-row';

describe('formatWhen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Midday, so local-timezone conversion cannot move the date across a
    // day or year boundary and make assertions flaky.
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty string for null or unparseable input', () => {
    expect(formatWhen(null)).toBe('');
    expect(formatWhen('not a date')).toBe('');
  });

  it('formats items from the last day as relative time', () => {
    expect(formatWhen('2026-07-27T11:55:00Z')).toMatch(/minute/);
    expect(formatWhen('2026-07-27T09:00:00Z')).toMatch(/hour/);
  });

  it('omits the year for older items from the current year', () => {
    expect(formatWhen('2026-03-03T12:00:00Z')).not.toContain('2026');
  });

  it('includes the year for items from any other year', () => {
    expect(formatWhen('2023-07-12T12:00:00Z')).toContain('2023');
    expect(formatWhen('2019-12-31T12:00:00Z')).toContain('2019');
  });
});
