import { describe, expect, test } from 'vitest';
import { inviteRedeemable, isLastAdminRemoval, newInviteToken } from './admin.js';

const now = new Date('2026-07-24T12:00:00Z');
const future = new Date('2026-07-31T12:00:00Z');
const past = new Date('2026-07-20T12:00:00Z');

describe('newInviteToken', () => {
  test('is url-safe and unique', () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });
});

describe('inviteRedeemable', () => {
  test('accepts an unredeemed, unexpired, unpinned invite', () => {
    expect(
      inviteRedeemable({ redeemedAt: null, expiresAt: future, email: null }, 'x@example.com', now),
    ).toBe(true);
  });

  test('rejects an already-redeemed invite', () => {
    expect(
      inviteRedeemable({ redeemedAt: past, expiresAt: future, email: null }, 'x@example.com', now),
    ).toBe(false);
  });

  test('rejects an expired invite', () => {
    expect(
      inviteRedeemable({ redeemedAt: null, expiresAt: past, email: null }, 'x@example.com', now),
    ).toBe(false);
  });

  test('an email-pinned invite matches case-insensitively', () => {
    const invite = { redeemedAt: null, expiresAt: future, email: 'Pinned@Example.com' };
    expect(inviteRedeemable(invite, 'pinned@example.com', now)).toBe(true);
    expect(inviteRedeemable(invite, 'someone@else.com', now)).toBe(false);
  });
});

describe('isLastAdminRemoval', () => {
  test('blocks stripping the sole active admin', () => {
    expect(isLastAdminRemoval(1, true)).toBe(true);
  });
  test('allows it when another active admin remains', () => {
    expect(isLastAdminRemoval(2, true)).toBe(false);
  });
  test('never blocks when the target is not an active admin', () => {
    expect(isLastAdminRemoval(1, false)).toBe(false);
  });
});
