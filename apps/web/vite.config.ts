import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // We drive our own update prompt (see lib/pwa.ts); the SW waits to activate.
      registerType: 'prompt',
      strategies: 'generateSW',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Reader',
        short_name: 'Reader',
        description: 'A calm, elegant, self-hosted RSS reader.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        // The manifest cannot read the oklch tokens in src/index.css, so these
        // are static hex approximations of the light --background / --primary.
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the built shell; any route falls back to index.html offline,
        // except /api which must always hit the network / runtime cache.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Prompt-driven activation: never take over without the user's reload.
        skipWaiting: false,
        clientsClaim: false,
        runtimeCaching: [
          {
            // Same-origin API GETs: serve cached, revalidate in the background.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/') && request.method === 'GET',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // The SW only runs on a built app; test offline against `vite preview`.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxy API calls to the Fastify server during development so the browser
    // stays same-origin and session cookies work.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
