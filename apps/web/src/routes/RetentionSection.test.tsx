import type { AppSettingsDto } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RetentionSection } from './AdminPage';

// SPEC-024: the admin sets how long to keep articles. Blank is forever.

let fetchMock: ReturnType<typeof vi.fn>;
let confirmMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ registrationMode: 'open', defaultPollIntervalSec: 900, ...JSON.parse(String(init?.body ?? '{}')) }),
  }) as Response);
  vi.stubGlobal('fetch', fetchMock);
  confirmMock = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderSection(days: number | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData<AppSettingsDto>(['admin', 'settings'], {
    registrationMode: 'open',
    defaultPollIntervalSec: 900,
    articleRetentionDays: days,
  });
  render(
    <QueryClientProvider client={qc}>
      <RetentionSection />
    </QueryClientProvider>,
  );
}
const field = () => screen.getByRole('spinbutton', { name: /Keep articles for/ });
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init.body)));

test('forever shows as blank, and says so', () => {
  renderSection(null);
  expect(field()).toHaveValue(null);
  expect(screen.getByText('Currently kept forever')).toBeInTheDocument();
  expect(field()).toHaveAccessibleDescription(/Starred and shared articles, and each feed's newest 100 items/);
  expect(screen.queryByRole('button', { name: 'Keep forever' })).toBeNull();
});

test('setting a window asks first, then saves it', async () => {
  renderSection(null);
  fireEvent.change(field(), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('older than 90 days'));
  await waitFor(() => expect(patches()).toEqual([{ articleRetentionDays: 90 }]));
});

test('a No at the question saves nothing', () => {
  confirmMock.mockReturnValue(false);
  renderSection(null);
  fireEvent.change(field(), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(patches()).toEqual([]);
});

test('a longer window deletes nothing new, so it does not ask', async () => {
  renderSection(90);
  expect(field()).toHaveValue(90);
  fireEvent.change(field(), { target: { value: '365' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(patches()).toEqual([{ articleRetentionDays: 365 }]));
  expect(confirmMock).not.toHaveBeenCalled();
});

test('"Keep forever" sends null', async () => {
  renderSection(90);
  fireEvent.click(screen.getByRole('button', { name: 'Keep forever' }));
  await waitFor(() => expect(patches()).toEqual([{ articleRetentionDays: null }]));
});

test('a cleared field sends null', async () => {
  renderSection(90);
  fireEvent.change(field(), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(patches()).toEqual([{ articleRetentionDays: null }]));
});

test('the field has the schema bounds', () => {
  renderSection(null);
  expect(field()).toHaveAttribute('min', '30');
  expect(field()).toHaveAttribute('max', '3650');
});
