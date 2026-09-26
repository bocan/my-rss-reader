import { DEFAULT_SETTINGS, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useSettings } from './settings';
import { LEGACY_UNREAD_ONLY_KEY, useUnreadOnly } from './unread-only';

// #18: the toolbar and Settings share one synced value.

let server: Settings;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  window.localStorage.clear();
  server = { ...DEFAULT_SETTINGS };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') server = { ...server, ...JSON.parse(init.body as string) };
    return json(server);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** A toolbar button and the Settings value, side by side in one tree. */
function Probe() {
  const [unreadOnly, setUnreadOnly] = useUnreadOnly();
  const { settings } = useSettings();
  return (
    <div>
      <button onClick={() => setUnreadOnly(!unreadOnly)}>toolbar:{String(unreadOnly)}</button>
      <span data-testid="settings">{String(settings.showUnreadOnly)}</span>
    </div>
  );
}

const renderProbe = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Probe />
    </QueryClientProvider>,
  );
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');

test('the toolbar writes settings.showUnreadOnly to the server', async () => {
  renderProbe();
  await screen.findByText('toolbar:false');

  fireEvent.click(screen.getByText('toolbar:false'));
  expect(await screen.findByText('toolbar:true')).toBeInTheDocument();
  expect(screen.getByTestId('settings')).toHaveTextContent('true');
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(puts()[0]![1].body)).toEqual({ showUnreadOnly: true });
});

test('a value set elsewhere (Settings, another device) shows on the toolbar', async () => {
  server = { ...server, showUnreadOnly: true };
  renderProbe();
  expect(await screen.findByText('toolbar:true')).toBeInTheDocument();
});

test('the old local key is handed to the server once, then deleted', async () => {
  window.localStorage.setItem(LEGACY_UNREAD_ONLY_KEY, 'true');
  renderProbe();
  // The local value shows before the server answers: no flash.
  expect(screen.getByText('toolbar:true')).toBeInTheDocument();

  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(puts()[0]![1].body)).toEqual({ showUnreadOnly: true });
  expect(window.localStorage.getItem(LEGACY_UNREAD_ONLY_KEY)).toBeNull();
  expect(screen.getByText('toolbar:true')).toBeInTheDocument();
});

test('an old local false never overrides the server, and is still deleted', async () => {
  window.localStorage.setItem(LEGACY_UNREAD_ONLY_KEY, 'false');
  server = { ...server, showUnreadOnly: true };
  renderProbe();

  await screen.findByText('toolbar:true');
  await act(async () => {});
  expect(puts()).toHaveLength(0);
  expect(window.localStorage.getItem(LEGACY_UNREAD_ONLY_KEY)).toBeNull();
});
