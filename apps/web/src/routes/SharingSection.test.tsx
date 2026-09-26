import type { ProfileDto } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SharingSection } from './SettingsPage';

// #44: the switches in Sharing save at once, as in Preferences. The text
// fields wait for their own Save button.

const profile: ProfileDto = {
  slug: 'chris',
  title: null,
  bio: null,
  visibility: 'off',
  shareUrl: null,
  blogrollEnabled: false,
  blogrollUrl: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ ...profile, ...JSON.parse(String(init?.body ?? '{}')) }),
  }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['profile'], profile);
  render(
    <QueryClientProvider client={qc}>
      <SharingSection />
    </QueryClientProvider>,
  );
}
const puts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init.body)));

test('a visibility change saves at once, with only that field', async () => {
  renderSection();
  fireEvent.click(screen.getByRole('button', { name: 'This instance' }));
  await waitFor(() => expect(puts()).toEqual([{ visibility: 'instance' }]));
  expect(screen.getByRole('button', { name: 'This instance' })).toHaveAttribute('aria-pressed', 'true');
});

test('the blogroll switch saves at once', async () => {
  renderSection();
  fireEvent.click(screen.getByRole('checkbox', { name: /Public blogroll/ }));
  await waitFor(() => expect(puts()).toEqual([{ blogrollEnabled: true }]));
});

test('a failed save puts the old visibility back and says why', async () => {
  fetchMock.mockImplementation(async () =>
    ({ ok: false, status: 500, json: async () => ({ error: 'boom', message: 'Server down' }) }) as Response,
  );
  renderSection();
  fireEvent.click(screen.getByRole('button', { name: 'Public web' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'),
  );
  expect(screen.getByText(/Server down|Could not save sharing settings/)).toBeInTheDocument();
});

test('the text fields wait for "Save page details", which sends only them', async () => {
  renderSection();
  fireEvent.change(screen.getByPlaceholderText(/A line about you/), { target: { value: 'Hi' } });
  expect(puts()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Save page details' }));
  await waitFor(() => expect(puts()).toEqual([{ slug: 'chris', title: null, bio: 'Hi' }]));
});
