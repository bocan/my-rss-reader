import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-db-env.ts'],
    // Integration tests share one database, so never run files in parallel.
    fileParallelism: false,
    globals: true,
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'integration-test-secret-0000000000',
      // DATABASE_URL is injected by setup-db-env.ts at runtime (dynamic port).
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
