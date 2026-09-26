import { DEFAULT_SETTINGS } from '@rss/shared';
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

function renderDialog(row = sub, onOpenChange = vi.fn(), role: 'admin' | 'user' = 'user') {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['auth', 'me'], { id: 'u1', role });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['feeds'], { items: [row] });
  qc.setQueryData(['profile'], { blogrollEnabled: false });
  qc.setQueryData(['settings'], DEFAULT_SETTINGS);
  render(
    <QueryClientProvider client={qc}>
      <FeedSettingsDialog sub={row} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
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

// #37: one Save applies a changed URL and the other settings.

function bodiesByUrl() {
  return fetchMock.mock.calls.map(([u, init]) => ({
    url: String(u),
    method: init?.method,
    body: init?.body ? JSON.parse(init.body) : undefined,
  }));
}

test('Save with a changed URL changes the URL first, then saves the other settings', async () => {
  const onOpenChange = renderDialog();

  expect(screen.queryByRole('button', { name: 'Change URL' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Feed URL' }), {
    target: { value: 'https://daverupert.com/atom.xml' },
  });
  expect(screen.getByText(/Save checks the new URL first/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Dave' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  const calls = bodiesByUrl();
  expect(calls[0]).toMatchObject({
    url: expect.stringContaining('/feeds/s1/url'),
    method: 'PATCH',
    body: { feedUrl: 'https://daverupert.com/atom.xml' },
  });
  expect(calls[1]).toMatchObject({ method: 'PATCH', body: { title: 'Dave' } });
  expect(calls[1]!.url).toMatch(/\/feeds\/s1$/);
});

test('a refused URL keeps the dialog open with the error, and saves nothing else', async () => {
  fetchMock.mockImplementation(async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: 'Could not fetch a valid feed at that URL: 404' }),
  }));
  const onOpenChange = renderDialog();

  fireEvent.change(screen.getByRole('textbox', { name: 'Feed URL' }), {
    target: { value: 'https://example.com/gone' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Dave' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not fetch a valid feed at that URL: 404');
  expect(alert).toHaveTextContent('Your other changes are not saved yet.');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
  // The edits are still in the form, ready for another try.
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Dave');
  expect(screen.getByRole('textbox', { name: 'Feed URL' })).toHaveValue('https://example.com/gone');
});

test('Save with the URL unchanged does not call the change-URL endpoint', async () => {
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(bodiesByUrl().some((c) => c.url.endsWith('/url'))).toBe(false);
});

// #38: the poll interval is shared by every subscriber.

test('an admin sees the shared effect under the field, and a changed interval is sent', async () => {
  const onOpenChange = renderDialog({ ...sub, fetchIntervalSec: 1800 }, vi.fn(), 'admin');
  const field = screen.getByRole('spinbutton', { name: /Poll every/ });
  expect(field).toHaveAccessibleDescription('Applies to everyone subscribed to this feed.');
  expect(field).not.toHaveAttribute('readonly');

  fireEvent.change(field, { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ fetchIntervalSec: 3600 });
});

test('an admin who does not touch the interval does not send it', async () => {
  const onOpenChange = renderDialog({ ...sub, fetchIntervalSec: 1800 }, vi.fn(), 'admin');
  fireEvent.click(screen.getByRole('radio', { name: /^Skim/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('fetchIntervalSec');
});

test('a clear of the interval by an admin sends null, for the app default', async () => {
  const onOpenChange = renderDialog({ ...sub, fetchIntervalSec: 1800 }, vi.fn(), 'admin');
  fireEvent.change(screen.getByRole('spinbutton', { name: /Poll every/ }), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ fetchIntervalSec: null });
});

test('a non-admin sees the interval read-only, and Save never sends it', async () => {
  const onOpenChange = renderDialog({ ...sub, fetchIntervalSec: 1800 });
  const field = screen.getByRole('spinbutton', { name: /Poll every/ });
  expect(field).toHaveAttribute('readonly');
  expect(field).toHaveValue(30);
  expect(field).toHaveAccessibleDescription(
    'Set by an admin. It applies to everyone subscribed to this feed.',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('fetchIntervalSec');
});

// #48: one name, "Article view", and the empty choices name the default.
test('the view selects say which default they use', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['auth', 'me'], { id: 'u1', role: 'user' });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['profile'], { blogrollEnabled: false });
  qc.setQueryData(['settings'], { ...DEFAULT_SETTINGS, defaultArticleView: 'web', defaultViewMode: 'cards' });
  render(
    <QueryClientProvider client={qc}>
      <FeedSettingsDialog sub={sub} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  const articleView = screen.getByRole('combobox', { name: 'Article view' });
  expect(articleView).toHaveDisplayValue('Use default (Web)');
  expect(screen.getByRole('combobox', { name: 'List view' })).toHaveDisplayValue('Use default (Cards)');
  expect(screen.queryByText('Opens in')).toBeNull();
});

test('a feed hidden from All items shows the box unticked', () => {
  renderDialog({ ...sub, hideFromAll: true, attention: 'precious' });
  expect(screen.getByRole('checkbox', { name: /Show in All items/ })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: /^Must read/ })).toBeChecked();
});
