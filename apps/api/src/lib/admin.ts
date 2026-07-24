import { randomBytes } from 'node:crypto';

/** Opaque, URL-safe invite token. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Whether an invite may be redeemed by `candidateEmail` at `now`. Expired and
 * already-redeemed invites are rejected identically (no oracle on the reason);
 * an email-pinned invite only accepts a matching address.
 */
export function inviteRedeemable(
  invite: { redeemedAt: Date | null; expiresAt: Date; email: string | null },
  candidateEmail: string,
  now: Date,
): boolean {
  if (invite.redeemedAt !== null) return false;
  if (invite.expiresAt.getTime() <= now.getTime()) return false;
  if (invite.email !== null && invite.email.toLowerCase() !== candidateEmail.toLowerCase()) {
    return false;
  }
  return true;
}

/**
 * Guard for last-admin protection. An operation that strips a user's active-admin
 * status (demote, disable, or delete) is blocked when they are the only active
 * admin left. `activeAdminCount` counts admins whose account is not disabled.
 */
export function isLastAdminRemoval(activeAdminCount: number, targetIsActiveAdmin: boolean): boolean {
  return targetIsActiveAdmin && activeAdminCount <= 1;
}
