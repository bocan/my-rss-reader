import { relations, sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// tsvector is not a first-class Drizzle column type; declare it once (SPEC-006).
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * Design note: feeds and articles are stored ONCE globally and deduplicated by
 * URL / guid. Per-user data lives in `subscriptions` (which feeds a user follows)
 * and `articleStates` (read / starred). This keeps storage flat as users grow and
 * means the worker fetches each feed a single time regardless of subscriber count.
 */

export const userRole = pgEnum('user_role', ['admin', 'user']);

// --- Identity ------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  username: text().notNull(),
  displayName: text().notNull(),
  passwordHash: text().notNull(),
  role: userRole().notNull().default('user'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_key').on(t.email),
  uniqueIndex('users_username_key').on(t.username),
]);

export const sessions = pgTable('sessions', {
  // Opaque random token, generated in the app layer.
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('sessions_user_id_idx').on(t.userId)]);

// --- Organization --------------------------------------------------------

export const folders = pgTable('folders', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  parentId: uuid().references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
  position: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('folders_user_id_idx').on(t.userId)]);

// --- Feeds (global) ------------------------------------------------------

export const feeds = pgTable('feeds', {
  id: uuid().primaryKey().defaultRandom(),
  feedUrl: text().notNull(),
  title: text(),
  siteUrl: text(),
  description: text(),
  faviconUrl: text(),
  // Conditional-GET caching hints from the last successful fetch.
  etag: text(),
  lastModified: text(),
  lastFetchedAt: timestamp({ withTimezone: true }),
  lastError: text(),
  failureCount: integer().notNull().default(0),
  fetchIntervalSec: integer().notNull().default(900),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('feeds_feed_url_key').on(t.feedUrl)]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  feedId: uuid()
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  folderId: uuid().references(() => folders.id, { onDelete: 'set null' }),
  customTitle: text(),
  position: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('subscriptions_user_feed_key').on(t.userId, t.feedId),
  index('subscriptions_user_id_idx').on(t.userId),
]);

// --- Articles (global) ---------------------------------------------------

export const articles = pgTable('articles', {
  id: uuid().primaryKey().defaultRandom(),
  feedId: uuid()
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  // Stable per-feed identity: the entry's <guid>/<id>, falling back to its URL.
  guid: text().notNull(),
  url: text(),
  title: text(),
  author: text(),
  contentHtml: text(),
  summary: text(),
  publishedAt: timestamp({ withTimezone: true }),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // Set by the sanitizer at ingestion (SPEC-001). contentHtml above always
  // holds sanitized HTML; these record which policy version produced it.
  sanitizedAt: timestamp({ withTimezone: true }),
  sanitizerVersion: integer(),
  // Simplified-view cache (SPEC-004). readableHtml is sanitized, Readability-
  // extracted HTML shared across subscribers; readableFetchedAt stamps every
  // attempt (null html + set timestamp means "tried and failed").
  readableHtml: text(),
  readableFetchedAt: timestamp({ withTimezone: true }),
  // Tag-stripped body text for search (SPEC-006), derived from contentHtml at
  // ingestion, falling back to the summary for summary-only feeds.
  contentText: text(),
  // Thumbnail for the card/magazine list views (SPEC-010). Absolute http(s)
  // URL resolved at ingestion, or null when the entry has no usable image.
  imageUrl: text(),
  // Generated STORED search vector; never written by app code. Weights:
  // title A (strongest), body B, author C.
  searchVector: tsvector('search_vector').generatedAlwaysAs(
    (): SQL =>
      sql`setweight(to_tsvector('english', coalesce(${articles.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${articles.contentText}, '')), 'B') || setweight(to_tsvector('english', coalesce(${articles.author}, '')), 'C')`,
  ),
}, (t) => [
  uniqueIndex('articles_feed_guid_key').on(t.feedId, t.guid),
  index('articles_feed_published_idx').on(t.feedId, t.publishedAt),
  // Backs the cross-feed keyset order: coalesce(publishedAt, fetchedAt) then id.
  index('articles_sort_key_idx').on(
    sql`coalesce(${t.publishedAt}, ${t.fetchedAt}) desc`,
    t.id.desc(),
  ),
  index('articles_search_vector_idx').using('gin', t.searchVector),
]);

export const articleStates = pgTable('article_states', {
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  articleId: uuid()
    .notNull()
    .references(() => articles.id, { onDelete: 'cascade' }),
  read: boolean().notNull().default(false),
  starred: boolean().notNull().default(false),
  readAt: timestamp({ withTimezone: true }),
  starredAt: timestamp({ withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.articleId] }),
  index('article_states_starred_idx').on(t.userId, t.starred),
]);

// --- Relations -----------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  folders: many(folders),
  subscriptions: many(subscriptions),
}));

export const feedsRelations = relations(feeds, ({ many }) => ({
  subscriptions: many(subscriptions),
  articles: many(articles),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  feed: one(feeds, { fields: [subscriptions.feedId], references: [feeds.id] }),
  folder: one(folders, { fields: [subscriptions.folderId], references: [folders.id] }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  feed: one(feeds, { fields: [articles.feedId], references: [feeds.id] }),
  states: many(articleStates),
}));

export const articleStatesRelations = relations(articleStates, ({ one }) => ({
  user: one(users, { fields: [articleStates.userId], references: [users.id] }),
  article: one(articles, { fields: [articleStates.articleId], references: [articles.id] }),
}));

// Convenience row types inferred from the schema.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Feed = typeof feeds.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
