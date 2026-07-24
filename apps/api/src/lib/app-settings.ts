import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appSettings, type AppSettings } from '../db/schema.js';

/**
 * The instance settings row (id = 1), seeded on first read so a fresh DB never
 * 500s. The singleton CHECK constraint keeps this the only row.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (existing) return existing;

  // Concurrent first reads race here; onConflictDoNothing makes the loser a
  // no-op and the re-select below returns the winner's row.
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [seeded] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  return seeded!;
}
