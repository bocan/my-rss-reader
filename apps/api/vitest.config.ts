import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests (*.int.test.ts) run under vitest.integration.config.ts.
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
    globals: true,
    // Enough env for the module graph to import without a real .env.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://rss:rss@localhost:5432/rss_test',
      SESSION_SECRET: 'test-secret-please-change-000000',
    },
  },
});
