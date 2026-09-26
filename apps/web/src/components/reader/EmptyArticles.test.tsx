import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { EmptyReason } from '@/lib/empty-state';
import { EmptyArticles, type EmptyActions } from './EmptyArticles';

// #35: each empty case has its own message and next step.

function renderReason(reason: EmptyReason, extra: Partial<EmptyActions> = {}) {
  const actions: EmptyActions = {
    onAddFeed: vi.fn(),
    onImportOpml: vi.fn(),
    onSearchAll: vi.fn(),
    onShowRead: vi.fn(),
    ...extra,
  };
  render(<EmptyArticles reason={reason} actions={actions} />);
  return actions;
}

test('first run: add a feed or import OPML', () => {
  const a = renderReason({ kind: 'welcome' });
  expect(screen.getByText('Welcome to Reader')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add a feed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Import OPML' }));
  expect(a.onAddFeed).toHaveBeenCalled();
  expect(a.onImportOpml).toHaveBeenCalled();
});

test('no search hits: names the scope, and offers every feed', () => {
  const a = renderReason({
    kind: 'search',
    query: 'rust',
    scope: 'Kubernetes Blog',
    allFeeds: false,
    unreadOnly: true,
  });
  expect(screen.getByText('No results for "rust"')).toBeInTheDocument();
  expect(screen.getByText('Searched Kubernetes Blog, unread articles only.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Search all feeds' }));
  expect(a.onSearchAll).toHaveBeenCalled();
});

test('no search hits in every feed: nothing wider to offer', () => {
  renderReason({ kind: 'search', query: 'rust', scope: 'All items', allFeeds: true, unreadOnly: false });
  expect(screen.getByText('Searched all feeds.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Search all feeds' })).toBeNull();
});

test('all caught up: show read, or go to the next unread feed', () => {
  const onNextFeed = vi.fn();
  const a = renderReason({ kind: 'caught-up' }, { onNextFeed });
  expect(screen.getByText('All caught up')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show read articles' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next unread feed' }));
  expect(a.onShowRead).toHaveBeenCalled();
  expect(onNextFeed).toHaveBeenCalled();
});

test('all caught up everywhere: no next feed button', () => {
  renderReason({ kind: 'caught-up' });
  expect(screen.queryByRole('button', { name: 'Next unread feed' })).toBeNull();
});

test('an empty feed says when it was last fetched', () => {
  const at = new Date(Date.now() - 3 * 3600_000).toISOString();
  renderReason({ kind: 'feed', lastFetchedAt: at });
  expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  expect(screen.getByText('This feed has no articles. Last fetched 3h ago.')).toBeInTheDocument();
});

test('a feed never fetched says so', () => {
  renderReason({ kind: 'feed', lastFetchedAt: null });
  expect(screen.getByText('This feed has not been fetched yet.')).toBeInTheDocument();
});

test('Starred and Shared say how to fill them', () => {
  renderReason({ kind: 'starred' });
  expect(screen.getByText('No starred articles')).toBeInTheDocument();
  expect(screen.getByText(/Star an article to keep it here/)).toBeInTheDocument();
});

test('Shared says how to share', () => {
  renderReason({ kind: 'shared' });
  expect(screen.getByText('Nothing shared yet')).toBeInTheDocument();
});
