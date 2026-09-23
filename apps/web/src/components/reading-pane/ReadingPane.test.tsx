import { DEFAULT_SETTINGS, type ArticleDetail, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ReadingPane } from './ReadingPane';

// Everything the pane needs is seeded into the cache; no request ever settles.
vi.mock('@/lib/api', () => ({
  api: vi.fn(() => new Promise(() => {})),
  ApiRequestError: class ApiRequestError extends Error {},
}));

const changelogItem = {
  id: 'a1',
  title: '2.1.281',
  author: null,
  url: 'https://code.claude.com/docs/en/changelog#2-1-281',
  contentHtml: '<ul><li>Fixed a bug</li></ul>',
  summary: null,
  publishedAt: null,
  readableHtml: null,
  readableFetchedAt: null,
  enclosureUrl: null,
  enclosureType: null,
  feed: { id: 'f1', title: 'Claude Code', siteUrl: null, faviconUrl: null },
  read: true,
  starred: false,
  shared: false,
  shareNote: null,
} as ArticleDetail;

function renderPane(settings: Partial<Settings> = {}, articleView: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(['article', 'a1'], changelogItem);
  qc.setQueryData(['feeds'], { items: [{ feedId: 'f1', articleView }] });
  qc.setQueryData(['settings'], { ...DEFAULT_SETTINGS, ...settings });
  render(
    <QueryClientProvider client={qc}>
      <ReadingPane articleId="a1" />
    </QueryClientProvider>,
  );
}

const pressed = () =>
  screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent);

test('orders the switcher Feed, Extracted, Web', () => {
  renderPane();
  const names = screen
    .getAllByRole('button')
    .map((b) => b.textContent)
    .filter((t) => ['Feed', 'Extracted', 'Web'].includes(t ?? ''));
  expect(names).toEqual(['Feed', 'Extracted', 'Web']);
});

test('auto picks Feed for a #fragment item and says it chose', () => {
  renderPane({ defaultArticleView: 'auto' });
  expect(pressed()).toEqual(['Feed']);
  expect(screen.getByText('Auto')).toBeInTheDocument();
  expect(screen.getByText('Fixed a bug')).toBeInTheDocument();
});

test('a manual switch overrides auto and drops the note', () => {
  renderPane({ defaultArticleView: 'auto' });
  fireEvent.click(screen.getByRole('button', { name: 'Web' }));
  expect(pressed()).toEqual(['Web']);
  expect(screen.queryByText('Auto')).not.toBeInTheDocument();
});

test('a fixed default or a feed override shows no Auto note', () => {
  renderPane({ defaultArticleView: 'simplified' });
  expect(pressed()).toEqual(['Extracted']);
  expect(screen.queryByText('Auto')).not.toBeInTheDocument();
});

test('a feed override beats an auto default', () => {
  renderPane({ defaultArticleView: 'auto' }, 'web');
  expect(pressed()).toEqual(['Web']);
  expect(screen.queryByText('Auto')).not.toBeInTheDocument();
});
