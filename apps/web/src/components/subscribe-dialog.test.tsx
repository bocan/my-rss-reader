import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SubscribeDialog } from './subscribe-dialog';

// SPEC-023: a handle in the box sends the same request as the profile URL.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      ({ ok: true, status: 201, json: async () => ({ subscription: {}, feed: { id: 'f1' } }) }) as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: [] });
  const onSubscribed = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SubscribeDialog open onOpenChange={vi.fn()} onSubscribed={onSubscribed} />
    </QueryClientProvider>,
  );
  return onSubscribed;
}
const input = () => screen.getByRole('textbox', { name: 'Site, feed, or profile URL' });
const add = (value: string) => {
  fireEvent.change(input(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};
const posted = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init.body)).url);

test.each(['@someone@hachyderm.io', 'someone@hachyderm.io', 'https://hachyderm.io/@someone'])(
  '%s subscribes to https://hachyderm.io/@someone',
  async (value) => {
    const onSubscribed = renderDialog();
    add(value);
    await waitFor(() => expect(onSubscribed).toHaveBeenCalledWith('f1'));
    expect(posted()).toEqual(['https://hachyderm.io/@someone']);
  },
);

test('a bare domain gets https://', async () => {
  renderDialog();
  add('example.com');
  await waitFor(() => expect(posted()).toEqual(['https://example.com']));
});

test('text that is no address says so, and sends nothing', () => {
  renderDialog();
  add('not an address');
  expect(screen.getByText(/Enter a web address, a feed address, or a handle/)).toBeInTheDocument();
  expect(posted()).toEqual([]);
});

test('the box says what it accepts', () => {
  renderDialog();
  expect(input()).toHaveAttribute('placeholder', 'Site, feed, or profile URL');
  expect(input()).toHaveAccessibleDescription(
    'Works with blogs, podcasts, YouTube channels, Mastodon and Bluesky profiles (@user@instance works too).',
  );
});
