import { DEFAULT_SETTINGS, updateSettingsSchema, type Settings } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { folders, subscriptions, userSettings } from '../db/schema.js';

/** Shape the caller's settings row, falling back to defaults when none exists. */
async function loadSettings(userId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    // theme/density/defaultViewMode/defaultArticleView are text columns;
    // values are written only through the Zod schema, so the cast is safe.
    theme: row.theme as Settings['theme'],
    density: row.density as Settings['density'],
    defaultViewMode: row.defaultViewMode as Settings['defaultViewMode'],
    defaultArticleView: row.defaultArticleView as Settings['defaultArticleView'],
    markReadOnScroll: row.markReadOnScroll,
    markReadOnOpen: row.markReadOnOpen,
    showUnreadOnly: row.showUnreadOnly,
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.requireAuth };

  // Always the caller's own settings; no settings id in any path.
  app.get('/settings', auth, async (request) => loadSettings(request.user!.id));

  // Upsert only the sent fields; returns the full merged settings. The row is
  // created lazily here, so signup never has to write one.
  app.put('/settings', auth, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const userId = request.user!.id;

    if (Object.keys(input).length > 0) {
      // Stamp updatedAt from the app clock on both the insert and the update so
      // the timestamp never depends on mixing the Postgres and Node clocks.
      const now = new Date();
      await db
        .insert(userSettings)
        .values({ userId, ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { ...input, updatedAt: now },
        });
    }

    return loadSettings(userId);
  });

  // Clear every saved list layout (per feed and per folder), so all of them
  // follow the user default again. Only the caller's own rows.
  app.post('/settings/reset-views', auth, async (request, reply) => {
    const userId = request.user!.id;
    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set({ viewMode: null }).where(eq(subscriptions.userId, userId));
      await tx.update(folders).set({ viewMode: null }).where(eq(folders.userId, userId));
    });
    return reply.code(204).send();
  });
}
