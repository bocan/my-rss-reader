import type { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.js';
import { articleRoutes } from './articles.js';
import { authRoutes } from './auth.js';
import { countsRoutes } from './counts.js';
import { feedRoutes } from './feeds.js';
import { healthRoutes } from './health.js';
import { opmlRoutes } from './opml.js';
import { profileRoutes } from './profile.js';
import { settingsRoutes } from './settings.js';

/** Registers every API route under the given instance (mounted at /api). */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(feedRoutes);
  await app.register(articleRoutes);
  await app.register(countsRoutes);
  await app.register(opmlRoutes);
  await app.register(settingsRoutes);
  await app.register(profileRoutes);
}
