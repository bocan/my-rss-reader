import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { client, db } from './index.js';

/**
 * Applies generated SQL migrations (from apps/api/drizzle) at runtime.
 * Runs as its own container command before the API/worker start, so no
 * drizzle-kit (a dev dependency) is needed in the production image.
 */
await migrate(db, { migrationsFolder: 'drizzle' });
await client.end();
console.log('[migrate] migrations applied');
