import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  articles,
  articleStates,
  feeds,
  folders,
  invites,
  profiles,
  sessions,
  subscriptions,
  users,
} from '../src/db/schema.js';
import { SESSION_COOKIE } from '../src/lib/session.js';

type UserInsert = typeof users.$inferInsert;
type FeedInsert = typeof feeds.$inferInsert;
type FolderInsert = typeof folders.$inferInsert;
type SubscriptionInsert = typeof subscriptions.$inferInsert;
type InviteInsert = typeof invites.$inferInsert;
type ArticleInsert = typeof articles.$inferInsert;
type ArticleStateInsert = typeof articleStates.$inferInsert;

const rand = (bytes = 4) => randomBytes(bytes).toString('hex');

/** Truncate every app table. Call in beforeEach for a clean slate per test. */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`truncate users, sessions, folders, feeds, subscriptions, articles, article_states, invites, app_settings, profiles restart identity cascade`,
  );
}

export async function seedUser(overrides: Partial<UserInsert> = {}) {
  const n = rand();
  const [row] = await db
    .insert(users)
    .values({
      email: `u_${n}@example.com`,
      username: `u_${n}`,
      displayName: 'Test User',
      passwordHash: 'not-a-real-hash',
      ...overrides,
    })
    .returning();
  return row!;
}

/** Seed an admin user (role defaults to 'admin'). */
export async function seedAdmin(overrides: Partial<UserInsert> = {}) {
  return seedUser({ role: 'admin', ...overrides });
}

/** Seed a registration invite; expires in 7 days and is unredeemed by default. */
export async function seedInvite(
  createdByUserId: string,
  overrides: Partial<InviteInsert> = {},
) {
  const [row] = await db
    .insert(invites)
    .values({
      token: randomBytes(24).toString('base64url'),
      createdByUserId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedFeed(overrides: Partial<FeedInsert> = {}) {
  const [row] = await db
    .insert(feeds)
    .values({ feedUrl: `https://feed-${rand()}.example/rss`, ...overrides })
    .returning();
  return row!;
}

export async function seedFolder(userId: string, overrides: Partial<FolderInsert> = {}) {
  const [row] = await db
    .insert(folders)
    .values({ userId, name: `Folder ${rand(2)}`, ...overrides })
    .returning();
  return row!;
}

export async function seedSubscription(
  userId: string,
  feedId: string,
  overrides: Partial<SubscriptionInsert> = {},
) {
  const [row] = await db
    .insert(subscriptions)
    .values({ userId, feedId, ...overrides })
    .returning();
  return row!;
}

export async function seedArticle(feedId: string, overrides: Partial<ArticleInsert> = {}) {
  const [row] = await db
    .insert(articles)
    .values({ feedId, guid: rand(8), ...overrides })
    .returning();
  return row!;
}

export async function seedArticleState(
  userId: string,
  articleId: string,
  overrides: Partial<ArticleStateInsert> = {},
) {
  const [row] = await db
    .insert(articleStates)
    .values({ userId, articleId, ...overrides })
    .returning();
  return row!;
}

type ProfileInsert = typeof profiles.$inferInsert;

/** Seed a sharing profile (SPEC-019); visibility defaults to 'off'. */
export async function seedProfile(
  userId: string,
  overrides: Partial<ProfileInsert> = {},
) {
  const [row] = await db
    .insert(profiles)
    .values({ userId, slug: `slug-${rand()}`, ...overrides })
    .returning();
  return row!;
}

/** Create a session for the user and return the Cookie header value for inject. */
export async function loginAs(user: { id: string }): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt });
  return `${SESSION_COOKIE}=${token}`;
}
