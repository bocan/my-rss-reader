import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { SubscriptionRow } from '@/lib/folders';
import { FeedProblemsDialog } from './FeedProblemsDialog';

// #29: the list of feeds with problems.

const sub = (id: string, title: string, lastError: string | null) =>
  ({
    subscriptionId: id,
    feedId: `f-${id}`,
    title,
    customTitle: null,
    feedUrl: `https://${id}.example/rss`,
    lastError,
    lastFetchedAt: null,
    lastSuccessAt: null,
  }) as SubscriptionRow;

function renderWith(items: SubscriptionRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['feeds'], { items });
  render(
    <QueryClientProvider client={qc}>
      <FeedProblemsDialog onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

test('lists only failing feeds, by name, each with its plain-words reason', () => {
  renderWith([
    sub('z', 'Zed', 'HTTP 404'),
    sub('ok', 'Fine Feed', null),
    sub('a', 'Alpha', 'read ECONNRESET'),
  ]);
  const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(names).toEqual(['Alpha', 'Zed']);
  expect(screen.getByText('The connection dropped.')).toBeInTheDocument();
  expect(screen.getByText('The feed is not at this address any more.')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Retry now' })).toHaveLength(2);
});

test('says so when nothing is failing', () => {
  renderWith([sub('ok', 'Fine Feed', null)]);
  expect(screen.getByText('All your feeds are working.')).toBeInTheDocument();
});
