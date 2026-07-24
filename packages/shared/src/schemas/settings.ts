import { z } from 'zod';
import { ARTICLE_VIEWS, THEME_SETTINGS, VIEW_MODES } from '../types.js';

export const settingsSchema = z.object({
  theme: z.enum(THEME_SETTINGS),
  defaultViewMode: z.enum(VIEW_MODES),
  defaultArticleView: z.enum(ARTICLE_VIEWS),
  markReadOnScroll: z.boolean(),
  showUnreadOnly: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** PUT /settings accepts only the changed fields. */
export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * The single source of truth for defaults. Must equal the DB column defaults on
 * user_settings and what GET /settings returns when no row exists.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  defaultViewMode: 'cards',
  defaultArticleView: 'simplified',
  markReadOnScroll: false,
  showUnreadOnly: false,
};
