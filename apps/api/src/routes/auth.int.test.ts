import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { loginAs, resetDb, seedUser } from '../../test/helpers.js';

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
