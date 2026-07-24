import { DEFAULT_SETTINGS, updateSettingsSchema, type Settings } from '@rss/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema.js';

/** Shape the caller's settings row, falling back to defaults when none exists. */
async function loadSettings(userId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    theme: row.theme,
    defaultViewMode: row.defaultViewMode,
    defaultArticleView: row.defaultArticleView,
    markReadOnScroll: row.markReadOnScroll,
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
      await db
        .insert(userSettings)
        .values({ userId, ...input })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { ...input, updatedAt: new Date() },
        });
    }

    return loadSettings(userId);
  });
}
