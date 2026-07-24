import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { PwaToasts } from './components/pwa/PwaToasts';
// Self-hosted variable fonts (SPEC-016 Phase 2). Bundled by Vite and precached
// by the service worker, so they render offline with no external request.
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/hanken-grotesk/wght-italic.css';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { registerMutationDefaults } from './lib/articles';
import { persister, PERSIST_BUSTER, shouldDehydrateQuery } from './lib/persister';
import { queryClient } from './lib/queryClient';
import { initTheme } from './lib/theme';

initTheme();

// Register the read/star mutation logic before the persister can resume any
// mutation that was queued while offline in a previous session.
registerMutationDefaults(queryClient);

// Replay queued offline mutations the moment the network returns.
window.addEventListener('online', () => {
  void queryClient.resumePausedMutations();
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
      onSuccess={() => {
        // Defaults are registered above, so paused mutations know how to run.
        void queryClient.resumePausedMutations();
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <PwaToasts />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  </StrictMode>,
);
