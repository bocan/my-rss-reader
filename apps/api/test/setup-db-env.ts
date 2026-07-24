import { readFileSync } from 'node:fs';

// Runs in the worker before any test file imports the app. Sets DATABASE_URL to
// the container URL published by global-setup, so the app's env-driven db
// singleton (apps/api/src/db/index.ts) connects to the test database. env.ts's
// loadEnvFile does not override an already-set var, so this wins over a dev .env.
const URL_FILE = new URL('../.test-db-url', import.meta.url);
process.env.DATABASE_URL = readFileSync(URL_FILE, 'utf8').trim();
