import { DEFAULT_SETTINGS, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useSettings } from './settings';

const CACHE_KEY = 'rss-settings';

const SERVER: Settings = {
  theme: 'dark',
  defaultViewMode: 'magazine',
  defaultArticleView: 'readable',
  markReadOnScroll: true,
  showUnreadOnly: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makeClient(): QueryClient {
  // No retries so error paths resolve immediately in tests.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Renders the hook and mirrors its output into the DOM for assertions. */
function Probe() {
  const { settings, update } = useSettings();
  return (
    <div>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="view">{settings.defaultViewMode}</span>
      <button onClick={() => update({ theme: 'light' })}>set-light</button>
    </div>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSettings', () => {
  test('seeds synchronously from the localStorage mirror before the query resolves', () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER));
    // Never resolves: proves the first paint comes from the cache, not the server.
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<Probe />, { wrapper: wrapper(makeClient()) });

    // First synchronous render already shows the cached values.
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('view').textContent).toBe('magazine');
  });

  test('falls back to defaults when the cache is empty', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<Probe />, { wrapper: wrapper(makeClient()) });
    expect(screen.getByTestId('theme').textContent).toBe(DEFAULT_SETTINGS.theme);
    expect(screen.getByTestId('view').textContent).toBe(DEFAULT_SETTINGS.defaultViewMode);
  });

  test('reconciles a stale cache to the server value on mount', async () => {
    // Cache disagrees with the server; the server must win after the refetch.
    const stale: Settings = { ...SERVER, theme: 'light', defaultViewMode: 'cards' };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(stale));
    fetchMock.mockResolvedValue(jsonResponse(SERVER));

    render(<Probe />, { wrapper: wrapper(makeClient()) });

    // Seeds from the stale cache first...
    expect(screen.getByTestId('theme').textContent).toBe('light');
    // ...then reconciles to the server value (initialDataUpdatedAt: 0 forces refetch).
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
    expect(screen.getByTestId('view').textContent).toBe('magazine');
    expect(JSON.parse(window.localStorage.getItem(CACHE_KEY)!)).toEqual(SERVER);
  });

  test('optimistically applies an update and rolls back on error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SERVER)); // initial GET
    render(<Probe />, { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));

    // Hold the PUT pending so the optimistic state is observable, then fail it.
    let rejectPut!: (reason: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((_, reject) => (rejectPut = reject)));
    screen.getByText('set-light').click();

    // Optimistic write is visible while the request is in flight.
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));

    // Rolls back to the pre-mutation snapshot after the failure.
    rejectPut(new Error('network'));
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
    expect(JSON.parse(window.localStorage.getItem(CACHE_KEY)!).theme).toBe('dark');
  });

  test('a successful update persists the server response to the cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SERVER)); // initial GET
    render(<Probe />, { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));

    const updated: Settings = { ...SERVER, theme: 'light' };
    fetchMock.mockResolvedValueOnce(jsonResponse(updated)); // PUT echoes the merged row
    screen.getByText('set-light').click();

    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));
    expect(JSON.parse(window.localStorage.getItem(CACHE_KEY)!).theme).toBe('light');
  });
});
