import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { appSettings, invites, users } from '../db/schema.js';
import {
  loginAs,
  resetDb,
  seedAdmin,
  seedInvite,
  seedUser,
} from '../../test/helpers.js';
import type { RegistrationMode } from '@rss/shared';

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

const register = (over: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'a@example.com', username: 'alice', displayName: 'Alice', password: 'supersecret1', ...over },
  });

async function setMode(mode: RegistrationMode): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: 1, registrationMode: mode })
    .onConflictDoUpdate({ target: appSettings.id, set: { registrationMode: mode } });
}

test('first registration becomes admin, the next becomes user', async () => {
  const r1 = await register();
  expect(r1.statusCode).toBe(201);
  expect(r1.json().role).toBe('admin');

  const r2 = await register({ email: 'b@example.com', username: 'bob' });
  expect(r2.statusCode).toBe(201);
  expect(r2.json().role).toBe('user');
});

test('duplicate email or username returns 409', async () => {
  await register();
  const dup = await register({ username: 'alice2' }); // same email
  expect(dup.statusCode).toBe(409);
});

test('login by email and by username, then /auth/me reflects the session', async () => {
  await register();
  for (const identifier of ['a@example.com', 'alice']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier, password: 'supersecret1' },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'rss_session');
    expect(cookie?.value).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `rss_session=${cookie!.value}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('alice');
  }
});

test('/auth/me is 401 without a session', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
  expect(res.statusCode).toBe(401);
});

test('bad credentials return 401', async () => {
  await register();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier: 'alice', password: 'wrongpassword' },
  });
  expect(res.statusCode).toBe(401);
});

test('loginAs helper yields a working session cookie', async () => {
  const user = await seedUser({ username: 'carol' });
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: await loginAs(user) } });
  expect(me.statusCode).toBe(200);
  expect(me.json().id).toBe(user.id);
});

// --- Registration modes (SPEC-012) --------------------------------------

test('GET /auth/registration-mode reports the configured mode', async () => {
  await setMode('invite');
  const res = await app.inject({ method: 'GET', url: '/api/auth/registration-mode' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ mode: 'invite' });
});

test('the first user becomes admin even when the mode is closed', async () => {
  await setMode('closed');
  const r = await register();
  expect(r.statusCode).toBe(201);
  expect(r.json().role).toBe('admin');
});

test('closed mode rejects registration once an admin exists', async () => {
  await seedAdmin();
  await setMode('closed');
  const r = await register();
  expect(r.statusCode).toBe(403);
});

test('open mode lets anyone register as a user', async () => {
  await seedAdmin();
  await setMode('open');
  const r = await register();
  expect(r.statusCode).toBe(201);
  expect(r.json().role).toBe('user');
});

test('invite mode without a token is rejected', async () => {
  await seedAdmin();
  await setMode('invite');
  const r = await register();
  expect(r.statusCode).toBe(403);
});

test('invite mode redeems a valid token, granting the invite role', async () => {
  const admin = await seedAdmin();
  await setMode('invite');
  const invite = await seedInvite(admin.id, { role: 'admin' });

  const r = await register({ inviteToken: invite.token });
  expect(r.statusCode).toBe(201);
  expect(r.json().role).toBe('admin');

  const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
  expect(row!.redeemedAt).not.toBeNull();
  expect(row!.redeemedByUserId).toBe(r.json().id);
});

test('an expired token is rejected', async () => {
  const admin = await seedAdmin();
  await setMode('invite');
  const invite = await seedInvite(admin.id, { expiresAt: new Date(Date.now() - 1000) });
  const r = await register({ inviteToken: invite.token });
  expect(r.statusCode).toBe(403);
});

test('a redeemed token cannot be reused', async () => {
  const admin = await seedAdmin();
  await setMode('invite');
  const invite = await seedInvite(admin.id);

  expect((await register({ inviteToken: invite.token })).statusCode).toBe(201);
  const second = await register({
    email: 'b@example.com',
    username: 'bob',
    inviteToken: invite.token,
  });
  expect(second.statusCode).toBe(403);
});

test('an email-pinned invite only accepts the matching address', async () => {
  const admin = await seedAdmin();
  await setMode('invite');
  const invite = await seedInvite(admin.id, { email: 'pinned@example.com' });

  const wrong = await register({ email: 'other@example.com', inviteToken: invite.token });
  expect(wrong.statusCode).toBe(403);

  const right = await register({ email: 'pinned@example.com', inviteToken: invite.token });
  expect(right.statusCode).toBe(201);
});

test('two concurrent redemptions of one token yield exactly one success', async () => {
  const admin = await seedAdmin();
  await setMode('invite');
  const invite = await seedInvite(admin.id);

  const [a, b] = await Promise.all([
    register({ email: 'racer1@example.com', username: 'racer1', inviteToken: invite.token }),
    register({ email: 'racer2@example.com', username: 'racer2', inviteToken: invite.token }),
  ]);
  const codes = [a.statusCode, b.statusCode].sort();
  expect(codes).toEqual([201, 403]);
});

// --- Disabled accounts (SPEC-012) ---------------------------------------

test('a disabled user cannot log in and their session stops resolving', async () => {
  const user = await seedUser({ username: 'dave', passwordHash: 'x' });
  const cookie = await loginAs(user);
  // Session works before disabling.
  expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);

  await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));

  // Existing cookie no longer resolves.
  expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
});

// --- Account settings (SPEC-017) ----------------------------------------

/** Register alice through HTTP (real password hash) and capture her cookie. */
async function registerAlice() {
  const res = await register();
  const value = res.cookies.find((c) => c.name === 'rss_session')!.value;
  return { user: res.json() as { id: string }, cookie: `rss_session=${value}` };
}

const me = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
const patchMe = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: body });
const changePassword = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { cookie }, payload: body });
const login = (identifier: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier, password } });

test('PATCH /auth/me updates display name and email', async () => {
  const { cookie } = await registerAlice();
  const res = await patchMe(cookie, { displayName: 'Alice B', email: 'alice.b@example.com' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ displayName: 'Alice B', email: 'alice.b@example.com' });
  const after = await me(cookie);
  expect(after.json()).toMatchObject({ displayName: 'Alice B', email: 'alice.b@example.com' });
});

test('PATCH /auth/me rejects an email another user already holds (409)', async () => {
  await register({ email: 'taken@example.com', username: 'bob' });
  const { cookie } = await registerAlice();
  expect((await patchMe(cookie, { email: 'taken@example.com' })).statusCode).toBe(409);
});

test('PATCH /auth/me re-saving your own email succeeds', async () => {
  const { cookie } = await registerAlice();
  expect((await patchMe(cookie, { email: 'a@example.com' })).statusCode).toBe(200);
});

test('PATCH /auth/me with an empty body is 400, and anonymous is 401', async () => {
  const { cookie } = await registerAlice();
  expect((await patchMe(cookie, {})).statusCode).toBe(400);
  expect((await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { displayName: 'X' } })).statusCode).toBe(401);
});

test('change-password: wrong current is 400 and leaves the old password working', async () => {
  const { cookie } = await registerAlice();
  const res = await changePassword(cookie, { currentPassword: 'wrongpass', newPassword: 'brandnewpass9' });
  expect(res.statusCode).toBe(400);
  expect((await login('alice', 'supersecret1')).statusCode).toBe(200);
});

test('change-password: correct current swaps the password', async () => {
  const { cookie } = await registerAlice();
  const res = await changePassword(cookie, {
    currentPassword: 'supersecret1',
    newPassword: 'brandnewpass9',
  });
  expect(res.statusCode).toBe(204);
  expect((await login('alice', 'brandnewpass9')).statusCode).toBe(200);
  expect((await login('alice', 'supersecret1')).statusCode).toBe(401);
});

test('change-password invalidates other sessions but keeps the current one', async () => {
  const { user, cookie } = await registerAlice();
  const otherCookie = await loginAs(user); // a second device
  expect((await me(otherCookie)).statusCode).toBe(200);

  const res = await changePassword(cookie, {
    currentPassword: 'supersecret1',
    newPassword: 'brandnewpass9',
  });
  expect(res.statusCode).toBe(204);

  expect((await me(cookie)).statusCode).toBe(200); // current device still in
  expect((await me(otherCookie)).statusCode).toBe(401); // other device signed out
});

test('change-password requires auth', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/change-password',
    payload: { currentPassword: 'x', newPassword: 'brandnewpass9' },
  });
  expect(res.statusCode).toBe(401);
});
