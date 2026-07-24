import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateAccountSchema,
  type PublicUser,
} from '@rss/shared';
import { and, count, eq, isNull, ne, or } from 'drizzle-orm';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { invites, sessions, users } from '../db/schema.js';
import { isProd } from '../env.js';
import { inviteRedeemable } from '../lib/admin.js';
import { getAppSettings } from '../lib/app-settings.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createSession, destroySession, resolveSession, SESSION_COOKIE } from '../lib/session.js';

// Thrown when two registrations race for the same single-use invite; the loser's
// transaction rolls back and the request is rejected like any invalid invite.
class InviteRaceError extends Error {}

function cookieOptions(expiresAt?: Date): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

async function issueSession(reply: FastifyReply, userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body);

    const clash = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, input.email), eq(users.username, input.username)))
      .limit(1);
    if (clash.length > 0) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Email or username already in use',
        statusCode: 409,
      });
    }

    const counted = await db.select({ value: count() }).from(users);
    const isFirstUser = (counted[0]?.value ?? 0) === 0;

    // Decide the role and which invite (if any) this registration redeems.
    let role: 'admin' | 'user' = 'user';
    let inviteToRedeem: { id: string } | null = null;

    if (isFirstUser) {
      // Bootstrap: the very first account is always the admin, regardless of
      // registration mode, and does not consume an invite.
      role = 'admin';
    } else {
      const { registrationMode } = await getAppSettings();
      if (registrationMode === 'closed') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Registration is closed',
          statusCode: 403,
        });
      }
      if (registrationMode === 'invite') {
        const denied = () =>
          reply.code(403).send({
            error: 'Forbidden',
            message: 'A valid invite is required',
            statusCode: 403,
          });
        if (!input.inviteToken) return denied();
        const [invite] = await db
          .select()
          .from(invites)
          .where(eq(invites.token, input.inviteToken))
          .limit(1);
        if (!invite || !inviteRedeemable(invite, input.email, new Date())) return denied();
        role = invite.role;
        inviteToRedeem = { id: invite.id };
      }
    }

    const passwordHash = await hashPassword(input.password);

    // Insert the user and redeem the invite atomically. The invite UPDATE
    // re-checks redeemedAt IS NULL so two concurrent redemptions cannot both win.
    let created: typeof users.$inferSelect;
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: input.email,
            username: input.username,
            displayName: input.displayName,
            passwordHash,
            role,
          })
          .returning();
        if (inviteToRedeem) {
          const redeemed = await tx
            .update(invites)
            .set({ redeemedByUserId: row!.id, redeemedAt: new Date() })
            .where(and(eq(invites.id, inviteToRedeem.id), isNull(invites.redeemedAt)))
            .returning({ id: invites.id });
          if (redeemed.length !== 1) throw new InviteRaceError();
        }
        return row!;
      });
    } catch (err) {
      if (err instanceof InviteRaceError) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'A valid invite is required',
          statusCode: 403,
        });
      }
      throw err;
    }

    await issueSession(reply, created.id);
    return reply.code(201).send(toPublicUser(created));
  });

  app.post('/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);

    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, input.identifier), eq(users.username, input.identifier)))
      .limit(1);

    // Verify even when the user is missing to blunt timing-based enumeration.
    const digest = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$notarealhash$notarealhash';
    const ok = await verifyPassword(digest, input.password);

    // Reject disabled accounts identically to bad credentials (no oracle).
    if (!user || !ok || user.disabledAt !== null) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid credentials',
        statusCode: 401,
      });
    }

    await issueSession(reply, user.id);
    return toPublicUser(user);
  });

  // Unauthenticated: lets the register page adapt to the instance's mode.
  app.get('/auth/registration-mode', async () => {
    const { registrationMode } = await getAppSettings();
    return { mode: registrationMode };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  });

  app.get('/auth/me', async (request, reply) => {
    // request.user is set by the auth hook, but re-resolve defensively.
    const user = request.user ?? (await resolveSession(request.cookies[SESSION_COOKIE]));
    if (!user) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Not signed in',
        statusCode: 401,
      });
    }
    return user;
  });

  // Update the caller's own display name and/or email (SPEC-017). Scoped to
  // request.user; there is no user id in the path.
  app.patch('/auth/me', { preHandler: app.requireAuth }, async (request, reply) => {
    const input = updateAccountSchema.parse(request.body);
    const userId = request.user!.id;

    if (input.email !== undefined) {
      // Uniqueness excludes the caller, so re-saving your own email is a no-op.
      const [clash] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, input.email), ne(users.id, userId)))
        .limit(1);
      if (clash) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Email already in use',
          statusCode: 409,
        });
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return toPublicUser(updated!);
  });

  // Change the caller's password after confirming the current one. Other
  // sessions are invalidated; the current session stays valid (SPEC-017).
  app.post('/auth/change-password', { preHandler: app.requireAuth }, async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    const userId = request.user!.id;

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const ok = row ? await verifyPassword(row.passwordHash, input.currentPassword) : false;
    if (!ok) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Current password is incorrect',
        statusCode: 400,
      });
    }

    const passwordHash = await hashPassword(input.newPassword);
    const currentToken = request.cookies[SESSION_COOKIE];
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
      // Sign out every other device; keep the caller's current session working.
      await tx
        .delete(sessions)
        .where(
          and(eq(sessions.userId, userId), currentToken ? ne(sessions.id, currentToken) : undefined),
        );
    });

    return reply.code(204).send();
  });
}
