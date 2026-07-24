// Test stub for the vite-plugin-pwa virtual module, which only exists when the
// plugin runs during a real build. Aliased in vitest.config.ts.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async () => {},
  };
}
