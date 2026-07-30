import { relations, sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
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

// How new accounts may be created (SPEC-012). Kept in lockstep with
// @rss/shared's REGISTRATION_MODES.
export const registrationMode = pgEnum('registration_mode', ['open', 'invite', 'closed']);

// Preference enums (SPEC-011). articleView stays a pgEnum (a stable set); a unit
// test asserts it matches @rss/shared. `theme`, `density`, and the view-mode
// columns are free-form text (SPEC-016) since their vocabularies changed.
export const articleViewEnum = pgEnum('article_view', ['simplified', 'readable', 'web']);

// --- Identity ------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  username: text().notNull(),
  displayName: text().notNull(),
  passwordHash: text().notNull(),
  role: userRole().notNull().default('user'),
  // Non-null means the account is disabled (SPEC-012): it cannot log in and its
  // sessions stop resolving.
  disabledAt: timestamp({ withTimezone: true }),
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

// Server-persisted preferences (SPEC-011). One row per user, created lazily on
// first PUT; a missing row reads back as DEFAULT_SETTINGS. Column defaults must
// equal @rss/shared's DEFAULT_SETTINGS.
export const userSettings = pgTable('user_settings', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text().notNull().default('auto'),
  density: text().notNull().default('comfortable'),
  defaultViewMode: text().notNull().default('cards'),
  defaultArticleView: articleViewEnum().notNull().default('simplified'),
  markReadOnScroll: boolean().notNull().default(false),
  showUnreadOnly: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// --- Administration (SPEC-012) -------------------------------------------

// Instance-wide settings as a single pinned row (id = 1). getSettings() upserts
// the seed row on first read so a fresh DB never 500s.
export const appSettings = pgTable('app_settings', {
  id: integer().primaryKey(),
  registrationMode: registrationMode().notNull().default('open'),
  // App-wide default feed poll interval; feeds inherit it unless they override
  // their own fetchIntervalSec (SPEC-018).
  defaultPollIntervalSec: integer().notNull().default(900),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('app_settings_singleton', sql`${t.id} = 1`)]);

// Redeemable registration invites. Single-use: redemption stamps
// redeemedByUserId/redeemedAt inside the same transaction as the user insert.
export const invites = pgTable('invites', {
  id: uuid().primaryKey().defaultRandom(),
  token: text().notNull(),
  // Optional pin to a single address; null = usable by anyone with the link.
  email: text(),
  role: userRole().notNull().default('user'),
  createdByUserId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  redeemedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  redeemedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('invites_token_key').on(t.token),
  index('invites_created_by_idx').on(t.createdByUserId),
]);

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
  // Poll interval override for this global feed (SPEC-018). null = inherit the
  // app-wide default (app_settings.defaultPollIntervalSec).
  fetchIntervalSec: integer(),
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
  // Per-feed list-view override (SPEC-011). null = inherit the user default.
  viewMode: text(),
  // Per-feed article-view override (SPEC-018). null = inherit the user default.
  articleView: text(),
  // Exclude this feed from the All-items list and its unread total (SPEC-018).
  hideFromAll: boolean().notNull().default(false),
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
  // Playable podcast/video enclosure from the feed item: absolute http(s)
  // URL plus its declared audio/* or video/* MIME type. Image enclosures
  // feed imageUrl instead; other types are dropped at ingestion.
  enclosureUrl: text(),
  enclosureType: text(),
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
  // Shared items (SPEC-019): shown on the user's public page / feeds when
  // their profile visibility allows. Un-sharing clears the note.
  shared: boolean().notNull().default(false),
  readAt: timestamp({ withTimezone: true }),
  starredAt: timestamp({ withTimezone: true }),
  sharedAt: timestamp({ withTimezone: true }),
  shareNote: text(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.articleId] }),
  index('article_states_starred_idx').on(t.userId, t.starred),
  // Backs the public share page / feeds and the Shared sidebar node.
  index('article_states_shared_idx')
    .on(t.userId, t.sharedAt)
    .where(sql`${t.shared} = true`),
]);

// --- Public sharing profile (SPEC-019) ------------------------------------

// One row per user, created lazily the first time they configure sharing.
// visibility: 'off' (private), 'instance' (other signed-in users see shares
// in the Community view), 'public' (Community + the /u/<slug> page and its
// feeds). SPEC-020 adds blogroll columns here.
export const profiles = pgTable('profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Lowercase, url-safe handle for /u/<slug>. Unique across the instance.
  slug: text().notNull(),
  // Page title; null renders as "<displayName>'s shared items".
  title: text(),
  bio: text(),
  visibility: text().notNull().default('off'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('profiles_slug_key').on(t.slug)]);

// --- Relations -----------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  folders: many(folders),
  subscriptions: many(subscriptions),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  createdBy: one(users, {
    fields: [invites.createdByUserId],
    references: [users.id],
    relationName: 'invitesCreated',
  }),
  redeemedBy: one(users, {
    fields: [invites.redeemedByUserId],
    references: [users.id],
    relationName: 'invitesRedeemed',
  }),
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
export type AppSettings = typeof appSettings.$inferSelect;
export type Invite = typeof invites.$inferSelect;
