import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { invites, sessions, users } from '../db/schema.js';
import { loginAs, resetDb, seedAdmin, seedInvite, seedUser } from '../../test/helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
});

const call = (method: InjectOptions['method'], url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) });

// --- Authorization matrix ------------------------------------------------

describe('every /api/admin route enforces requireAdmin', () => {
  const routes: [InjectOptions['method'], string][] = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/invites'],
    ['POST', '/api/admin/invites'],
    ['GET', '/api/admin/settings'],
    ['PATCH', '/api/admin/settings'],
  ];

  test('anonymous callers get 401', async () => {
    for (const [method, url] of routes) {
      expect((await call(method, url)).statusCode).toBe(401);
    }
  });

  test('non-admin callers get 403', async () => {
    const cookie = await loginAs(await seedUser({ role: 'user' }));
    for (const [method, url] of routes) {
      expect((await call(method, url, cookie)).statusCode).toBe(403);
    }
  });

  test('admins pass the guard', async () => {
    const cookie = await loginAs(await seedAdmin());
    expect((await call('GET', '/api/admin/users', cookie)).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/settings', cookie)).statusCode).toBe(200);
  });
});

// --- Users ---------------------------------------------------------------

test('GET /admin/users lists users without leaking password hashes', async () => {
  await seedAdmin();
  await seedUser({ role: 'user' });
  const cookie = await loginAs(await seedAdmin());

  const res = await call('GET', '/api/admin/users', cookie);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.length).toBe(3);
  for (const u of body) {
    expect(u).not.toHaveProperty('passwordHash');
    expect(u).toHaveProperty('disabledAt');
  }
});

test('PATCH /admin/users/:id changes role', async () => {
  const cookie = await loginAs(await seedAdmin());
  const target = await seedUser({ role: 'user' });

  const res = await call('PATCH', `/api/admin/users/${target.id}`, cookie, { role: 'admin' });
  expect(res.statusCode).toBe(200);
  expect(res.json().role).toBe('admin');
});

test('PATCH disabling a user clears their sessions', async () => {
  const cookie = await loginAs(await seedAdmin());
  const target = await seedUser({ role: 'user' });
  await loginAs(target); // give them a live session

  const res = await call('PATCH', `/api/admin/users/${target.id}`, cookie, { disabled: true });
  expect(res.statusCode).toBe(200);
  expect(res.json().disabledAt).not.toBeNull();

  const left = await db.select().from(sessions).where(eq(sessions.userId, target.id));
  expect(left).toHaveLength(0);
});

test('PATCH re-enabling a user clears disabledAt', async () => {
  const cookie = await loginAs(await seedAdmin());
  const target = await seedUser({ role: 'user', disabledAt: new Date() });
  const res = await call('PATCH', `/api/admin/users/${target.id}`, cookie, { disabled: false });
  expect(res.json().disabledAt).toBeNull();
});

test('PATCH with no fields is a 400', async () => {
  const cookie = await loginAs(await seedAdmin());
  const target = await seedUser({ role: 'user' });
  expect((await call('PATCH', `/api/admin/users/${target.id}`, cookie, {})).statusCode).toBe(400);
});

test('PATCH a missing user is a 404', async () => {
  const cookie = await loginAs(await seedAdmin());
  const res = await call('PATCH', '/api/admin/users/00000000-0000-0000-0000-000000000000', cookie, {
    role: 'user',
  });
  expect(res.statusCode).toBe(404);
});

test('DELETE /admin/users/:id removes the user (204)', async () => {
  const cookie = await loginAs(await seedAdmin());
  const target = await seedUser({ role: 'user' });
  const res = await call('DELETE', `/api/admin/users/${target.id}`, cookie);
  expect(res.statusCode).toBe(204);
  const left = await db.select().from(users).where(eq(users.id, target.id));
  expect(left).toHaveLength(0);
});

// --- Last-admin protection ----------------------------------------------

describe('the last active admin cannot be removed', () => {
  test('demote is rejected', async () => {
    const admin = await seedAdmin();
    const cookie = await loginAs(admin);
    const res = await call('PATCH', `/api/admin/users/${admin.id}`, cookie, { role: 'user' });
    expect(res.statusCode).toBe(409);
  });

  test('disable is rejected', async () => {
    const admin = await seedAdmin();
    const cookie = await loginAs(admin);
    const res = await call('PATCH', `/api/admin/users/${admin.id}`, cookie, { disabled: true });
    expect(res.statusCode).toBe(409);
  });

  test('delete is rejected', async () => {
    const admin = await seedAdmin();
    const cookie = await loginAs(admin);
    expect((await call('DELETE', `/api/admin/users/${admin.id}`, cookie)).statusCode).toBe(409);
  });

  test('with two admins the operation succeeds', async () => {
    const a1 = await seedAdmin();
    await seedAdmin();
    const cookie = await loginAs(a1);
    const res = await call('PATCH', `/api/admin/users/${a1.id}`, cookie, { role: 'user' });
    expect(res.statusCode).toBe(200);
  });

  test('a disabled admin does not count toward the quorum', async () => {
    const active = await seedAdmin();
    await seedAdmin({ disabledAt: new Date() }); // present but not active
    const cookie = await loginAs(active);
    // Only one ACTIVE admin remains, so demoting them is still blocked.
    const res = await call('PATCH', `/api/admin/users/${active.id}`, cookie, { role: 'user' });
    expect(res.statusCode).toBe(409);
  });
});

// --- Invites -------------------------------------------------------------

test('POST /admin/invites creates an invite with a redeemable link', async () => {
  const cookie = await loginAs(await seedAdmin());
  const res = await call('POST', '/api/admin/invites', cookie, { role: 'user', expiresInDays: 3 });
  expect(res.statusCode).toBe(201);
  const dto = res.json();
  expect(dto.token).toBeTruthy();
  expect(dto.link).toBe(`/register?invite=${dto.token}`);
  expect(dto.redeemedAt).toBeNull();
});

test('GET /admin/invites lists invites', async () => {
  const admin = await seedAdmin();
  await seedInvite(admin.id);
  const cookie = await loginAs(admin);
  const res = await call('GET', '/api/admin/invites', cookie);
  expect(res.json()).toHaveLength(1);
});

test('DELETE /admin/invites/:id revokes an unredeemed invite (204)', async () => {
  const admin = await seedAdmin();
  const invite = await seedInvite(admin.id);
  const cookie = await loginAs(admin);
  expect((await call('DELETE', `/api/admin/invites/${invite.id}`, cookie)).statusCode).toBe(204);
  expect(await db.select().from(invites).where(eq(invites.id, invite.id))).toHaveLength(0);
});

test('DELETE a redeemed invite is a 404 (cannot revoke)', async () => {
  const admin = await seedAdmin();
  const redeemer = await seedUser();
  const invite = await seedInvite(admin.id, {
    redeemedAt: new Date(),
    redeemedByUserId: redeemer.id,
  });
  const cookie = await loginAs(admin);
  expect((await call('DELETE', `/api/admin/invites/${invite.id}`, cookie)).statusCode).toBe(404);
});

// --- Settings ------------------------------------------------------------

test('GET/PATCH /admin/settings reads and writes the registration mode', async () => {
  const cookie = await loginAs(await seedAdmin());

  // Seeded lazily on first read; a fresh DB defaults to 'open'.
  expect((await call('GET', '/api/admin/settings', cookie)).json().registrationMode).toBe('open');

  const patched = await call('PATCH', '/api/admin/settings', cookie, { registrationMode: 'invite' });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().registrationMode).toBe('invite');

  expect((await call('GET', '/api/admin/settings', cookie)).json().registrationMode).toBe('invite');
});

test('PATCH /admin/settings rejects an invalid mode with 400', async () => {
  const cookie = await loginAs(await seedAdmin());
  const res = await call('PATCH', '/api/admin/settings', cookie, { registrationMode: 'public' });
  expect(res.statusCode).toBe(400);
});
