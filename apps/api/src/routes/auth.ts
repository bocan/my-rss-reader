import { loginSchema, registerSchema, type PublicUser } from '@rss/shared';
import { count, eq, or } from 'drizzle-orm';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { isProd } from '../env.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createSession, destroySession, resolveSession, SESSION_COOKIE } from '../lib/session.js';

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

    // The very first account to register becomes the admin.
    const counted = await db.select({ value: count() }).from(users);
    const role = (counted[0]?.value ?? 0) === 0 ? 'admin' : 'user';

    const passwordHash = await hashPassword(input.password);
    const [created] = await db
      .insert(users)
      .values({
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        role,
      })
      .returning();

    await issueSession(reply, created!.id);
    return reply.code(201).send(toPublicUser(created!));
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

    if (!user || !ok) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid credentials',
        statusCode: 401,
      });
    }

    await issueSession(reply, user.id);
    return toPublicUser(user);
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
}
