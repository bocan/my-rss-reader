import {
  createInviteSchema,
  updateAppSettingsSchema,
  updateUserSchema,
  type AdminUser,
  type AppSettingsDto,
  type InviteDto,
} from '@rss/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { appSettings, invites, sessions, users } from '../db/schema.js';
import { isLastAdminRemoval, newInviteToken } from '../lib/admin.js';
import { getAppSettings } from '../lib/app-settings.js';

// Sentinel errors thrown inside transactions and mapped to HTTP responses.
class NotFoundError extends Error {}
class LastAdminError extends Error {}

function toAdminUser(row: typeof users.$inferSelect): AdminUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
  };
}

function toInviteDto(row: typeof invites.$inferSelect): InviteDto {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null,
    redeemedByUserId: row.redeemedByUserId,
    createdAt: row.createdAt.toISOString(),
    link: `/register?invite=${row.token}`,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Active admins = role 'admin' and not disabled. Used for last-admin guards. */
async function countActiveAdmins(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)));
  return row?.value ?? 0;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // --- Users -------------------------------------------------------------

  app.get('/admin/users', admin, async () => {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return rows.map(toAdminUser);
  });

  app.patch<{ Params: { id: string } }>('/admin/users/:id', admin, async (request, reply) => {
    const input = updateUserSchema.parse(request.body);
    const { id } = request.params;

    try {
      const updated = await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        if (!target) throw new NotFoundError();

        const nextRole = input.role ?? target.role;
        const nextDisabled =
          input.disabled === undefined ? target.disabledAt !== null : input.disabled;

        // If this strips the target's active-admin status, guard the last admin.
        const wasActiveAdmin = target.role === 'admin' && target.disabledAt === null;
        const willBeActiveAdmin = nextRole === 'admin' && !nextDisabled;
        if (wasActiveAdmin && !willBeActiveAdmin) {
          if (isLastAdminRemoval(await countActiveAdmins(tx), true)) throw new LastAdminError();
        }

        let disabledAt = target.disabledAt;
        if (input.disabled === true) disabledAt = target.disabledAt ?? new Date();
        else if (input.disabled === false) disabledAt = null;

        const [row] = await tx
          .update(users)
          .set({ role: nextRole, disabledAt, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();

        // A disabled account's existing sessions must stop working immediately.
        if (row!.disabledAt !== null) {
          await tx.delete(sessions).where(eq(sessions.userId, id));
        }
        return row!;
      });
      return toAdminUser(updated);
    } catch (err) {
      return mapAdminError(err, reply);
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/users/:id', admin, async (request, reply) => {
    const { id } = request.params;
    try {
      await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        if (!target) throw new NotFoundError();

        if (target.role === 'admin' && target.disabledAt === null) {
          if (isLastAdminRemoval(await countActiveAdmins(tx), true)) throw new LastAdminError();
        }
        // Cascades subscriptions, article_states, sessions, invites created.
        await tx.delete(users).where(eq(users.id, id));
      });
      return reply.code(204).send();
    } catch (err) {
      return mapAdminError(err, reply);
    }
  });

  // --- Invites -----------------------------------------------------------

  app.get('/admin/invites', admin, async () => {
    const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
    return rows.map(toInviteDto);
  });

  app.post('/admin/invites', admin, async (request, reply) => {
    const input = createInviteSchema.parse(request.body);
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const [row] = await db
      .insert(invites)
      .values({
        token: newInviteToken(),
        email: input.email ?? null,
        role: input.role,
        createdByUserId: request.user!.id,
        expiresAt,
      })
      .returning();
    return reply.code(201).send(toInviteDto(row!));
  });

  app.delete<{ Params: { id: string } }>('/admin/invites/:id', admin, async (request, reply) => {
    const { id } = request.params;
    // Only unredeemed invites can be revoked; a redeemed one has done its job.
    const deleted = await db
      .delete(invites)
      .where(and(eq(invites.id, id), isNull(invites.redeemedAt)))
      .returning({ id: invites.id });
    if (deleted.length === 0) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'No revocable invite with that id',
        statusCode: 404,
      });
    }
    return reply.code(204).send();
  });

  // --- Instance settings -------------------------------------------------

  app.get('/admin/settings', admin, async (): Promise<AppSettingsDto> => {
    const { registrationMode } = await getAppSettings();
    return { registrationMode };
  });

  app.patch('/admin/settings', admin, async (request): Promise<AppSettingsDto> => {
    const input = updateAppSettingsSchema.parse(request.body);
    await getAppSettings(); // ensure the singleton row exists
    await db
      .update(appSettings)
      .set({ registrationMode: input.registrationMode, updatedAt: new Date() })
      .where(eq(appSettings.id, 1));
    return { registrationMode: input.registrationMode };
  });
}

function mapAdminError(err: unknown, reply: FastifyReply) {
  if (err instanceof NotFoundError) {
    return reply.code(404).send({ error: 'Not Found', message: 'User not found', statusCode: 404 });
  }
  if (err instanceof LastAdminError) {
    return reply
      .code(409)
      .send({ error: 'Conflict', message: 'Cannot remove the last admin', statusCode: 409 });
  }
  throw err;
}
