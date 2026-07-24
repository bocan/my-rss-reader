import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker/index.ts',
    migrate: 'src/db/migrate.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package; keep node_modules external.
  noExternal: ['@rss/shared'],
  splitting: false,
  minify: false,
});
