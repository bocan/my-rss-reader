import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PublicUser } from '@rss/shared';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { env } from '../env.js';

export const SESSION_COOKIE = 'rss_session';

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function expiryDate(): Date {
  return new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = expiryDate();
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

/** Resolve a session token to its user, or null if missing/expired. */
export async function resolveSession(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;

  const row = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  const record = row[0];
  if (!record) return null;

  if (record.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }

  return {
    id: record.id,
    email: record.email,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}
