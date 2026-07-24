import { rmSync, writeFileSync } from 'node:fs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Where the container URL is stashed for the worker (see setup-db-env.ts). The
// worker runs in a separate process, so env from here does not reach it.
const URL_FILE = new URL('../.test-db-url', import.meta.url);

/**
 * Vitest globalSetup: start one ephemeral Postgres, migrate it with the real
 * Drizzle migrations, publish its URL, and stop it on teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();

  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  await client.end();

  writeFileSync(URL_FILE, url);

  return async () => {
    rmSync(URL_FILE, { force: true });
    await container.stop();
  };
}
