import type { FilterRuleDto } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import type { SubscriptionRow } from '@/lib/folders';
import { RulesSection } from './RulesSection';

// SPEC-025: filter rules on the Settings page.

const rule = (over: Partial<FilterRuleDto> = {}): FilterRuleDto => ({
  id: 'r1',
  feedId: null,
  field: 'title',
  phrase: 'sponsored',
  action: 'markRead',
  enabled: true,
  createdAt: '',
  ...over,
});
const sub = { feedId: 'f1', subscriptionId: 's1', title: 'CSS Tricks', customTitle: null, feedUrl: 'https://x/rss' } as SubscriptionRow;

// A tiny rules server: the list reloads after each change, as in the app.
let server: FilterRuleDto[];
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (status: number, body: unknown) => ({ ok: true, status, json: async () => body }) as Response;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const id = String(url).split('/')[3];
    if (String(url).endsWith('/apply')) return ok(200, { matched: 3 });
    if (method === 'GET') return ok(200, { items: server });
    if (method === 'POST') {
      const created = rule({ id: 'r9', ...body });
      server = [...server, created];
      return ok(201, created);
    }
    if (method === 'PATCH') {
      server = server.map((r) => (r.id === id ? { ...r, ...body } : r));
      return ok(200, server.find((r) => r.id === id));
    }
    server = server.filter((r) => r.id !== id);
    return ok(204, undefined);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

function renderSection(rules: FilterRuleDto[]) {
  server = rules;
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['rules'], { items: rules });
  qc.setQueryData(['feeds'], { items: [sub] });
  render(
    <QueryClientProvider client={qc}>
      <Toaster />
      <RulesSection />
    </QueryClientProvider>,
  );
}
const calls = (method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }));

test('each rule reads as a sentence', () => {
  renderSection([
    rule(),
    rule({ id: 'r2', field: 'author', phrase: 'Simon', action: 'star', feedId: 'f1' }),
    rule({ id: 'r3', feedId: 'gone', field: 'content', phrase: 'giveaway' }),
  ]);
  expect(screen.getByText('When the title contains "sponsored", in all feeds, mark it read.')).toBeInTheDocument();
  expect(screen.getByText('When the author contains "Simon", in CSS Tricks, star it.')).toBeInTheDocument();
  expect(
    screen.getByText('When the text contains "giveaway", in a feed you no longer follow, mark it read.'),
  ).toBeInTheDocument();
});

test('the switch turns a rule off', async () => {
  renderSection([rule()]);
  const on = screen.getByRole('checkbox', { name: 'Rule on' });
  expect(on).toBeChecked();
  fireEvent.click(on);
  await waitFor(() => expect(calls('PATCH')).toEqual([{ url: '/api/rules/r1', body: { enabled: false } }]));
  expect(on).not.toBeChecked();
});

test('"Run on existing articles" says how many matched', async () => {
  renderSection([rule()]);
  fireEvent.click(screen.getByRole('button', { name: 'Run on existing articles' }));
  expect(await screen.findByText('Matched 3 articles.')).toBeInTheDocument();
  expect(calls('POST')).toEqual([{ url: '/api/rules/r1/apply', body: undefined }]);
});

test('Delete asks first', async () => {
  const confirmMock = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmMock);
  renderSection([rule()]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
  expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('When the title contains "sponsored"'));
  await waitFor(() => expect(calls('DELETE')).toEqual([{ url: '/api/rules/r1', body: undefined }]));
});

test('the add form sends the four choices, trimmed', async () => {
  renderSection([]);
  fireEvent.change(screen.getByRole('combobox', { name: 'Field' }), { target: { value: 'author' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Phrase' }), { target: { value: ' Simon ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Feed' }), { target: { value: 'f1' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Action' }), { target: { value: 'star' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  await waitFor(() =>
    expect(calls('POST')).toEqual([
      { url: '/api/rules', body: { field: 'author', phrase: 'Simon', action: 'star', feedId: 'f1' } },
    ]),
  );
  expect(await screen.findByText('When the author contains "Simon", in CSS Tricks, star it.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Phrase' })).toHaveValue('');
});

test('a refused rule shows the reason by the form', async () => {
  fetchMock.mockImplementation(
    async () =>
      ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'too_many_rules', message: 'You can have up to 100 rules', statusCode: 400 }),
      }) as Response,
  );
  renderSection([]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Phrase' }), { target: { value: 'ad' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  // Also while the list reload after the failure is still retrying: the
  // reason must not wait for it.
  expect(await screen.findByRole('alert')).toHaveTextContent('You can have up to 100 rules');
});
