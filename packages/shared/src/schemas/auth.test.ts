import { describe, expect, test } from 'vitest';
import { changePasswordSchema, updateAccountSchema } from './auth.js';

describe('updateAccountSchema', () => {
  test('accepts a display-name-only update', () => {
    expect(updateAccountSchema.safeParse({ displayName: 'New Name' }).success).toBe(true);
  });

  test('accepts an email-only update', () => {
    expect(updateAccountSchema.safeParse({ email: 'new@example.com' }).success).toBe(true);
  });

  test('rejects an empty object (nothing to change)', () => {
    expect(updateAccountSchema.safeParse({}).success).toBe(false);
  });

  test('rejects a malformed email', () => {
    expect(updateAccountSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  test('accepts a valid pair', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'longenough1' }).success,
    ).toBe(true);
  });

  test('rejects a too-short new password', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
  });

  test('requires the current password', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'longenough1' }).success,
    ).toBe(false);
  });
});
