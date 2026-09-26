import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SubscriptionRow } from '@/lib/folders';
import { FeedSettingsDialog } from './FeedSettingsDialog';

// #36: the attention levels say what they do, and "Show in All items" is
// explained as a separate choice.

const sub: SubscriptionRow = {
  subscriptionId: 's1',
  feedId: 'f1',
  title: 'Dave Rupert',
  customTitle: null,
  feedUrl: 'https://daverupert.com/rss',
  siteUrl: null,
  faviconUrl: null,
  folderId: null,
  position: 0,
  viewMode: null,
  sortOrder: null,
  articleView: null,
  hideFromAll: false,
  inBlogroll: false,
  attention: 'normal',
  websubState: 'inactive',
  websubLeaseExpiresAt: null,
  fetchIntervalSec: null,
  lastFetchedAt: null,
  lastError: null,
  lastSuccessAt: null,
  unreadCount: 0,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => sub }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog(row = sub) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['feeds'], { items: [row] });
  qc.setQueryData(['profile'], { blogrollEnabled: false });
  render(
    <QueryClientProvider client={qc}>
      <FeedSettingsDialog sub={row} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

test('each level has a plain name and says what it does, with the 14-day rule', () => {
  renderDialog();
  expect(screen.getByRole('group', { name: 'How much attention' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /^Skim/ })).toHaveAccessibleName(
    expect.stringContaining('Unread articles older than 14 days count as read.'),
  );
  expect(screen.getByRole('radio', { name: /^Normal/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Must read/ })).toHaveAccessibleName(
    expect.stringContaining('listed under "Must read" in the sidebar'),
  );
  expect(screen.queryByText(/Firehose|Precious/)).toBeNull();
});

test('"Show in All items" explains how it differs from Skim', () => {
  renderDialog();
  const box = screen.getByRole('checkbox', { name: /Show in All items/ });
  expect(box).toBeChecked();
  expect(box).toHaveAccessibleName(expect.stringContaining('not the same as Skim'));
});

test('Skim and "Show in All items" off save as firehose and hideFromAll', async () => {
  renderDialog();
  fireEvent.click(screen.getByRole('radio', { name: /^Skim/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Show in All items/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toContain('/feeds/s1');
  expect(JSON.parse(init.body)).toMatchObject({ attention: 'firehose', hideFromAll: true });
});

test('a feed hidden from All items shows the box unticked', () => {
  renderDialog({ ...sub, hideFromAll: true, attention: 'precious' });
  expect(screen.getByRole('checkbox', { name: /Show in All items/ })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: /^Must read/ })).toBeChecked();
});
