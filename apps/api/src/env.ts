import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Best-effort load of a local .env file (dev only). In containers the
 * environment is injected directly, so a missing file is not an error.
 * Checks the current working dir and the repo root.
 */
for (const candidate of ['.env', resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(16),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  FEED_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(900),
  FEED_POLL_CONCURRENCY: z.coerce.number().int().positive().default(8),

  // Largest OPML document accepted by POST /opml/import (SPEC-009).
  OPML_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
