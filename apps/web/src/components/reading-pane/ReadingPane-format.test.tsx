import { DEFAULT_SETTINGS, type ArticleDetail, type ArticleView, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ReadingPane } from './ReadingPane';

// #41: the body sits in a centered column of limited width, and the text
// size and width settings apply to the Feed and Extracted views.

const api = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock('@/lib/api', () => ({ api, ApiRequestError: class ApiRequestError extends Error {} }));

const article = {
  id: 'a1',
  title: 'Post',
  author: null,
  url: 'https://example.com/post',
  contentHtml: '<p>Feed body</p>',
  summary: null,
  publishedAt: null,
  readableHtml: '<p>Extracted body</p>',
  readableFetchedAt: '2026-09-26T00:00:00.000Z',
  enclosureUrl: null,
  enclosureType: null,
  feed: { id: 'f1', title: 'Feed', siteUrl: null, faviconUrl: null },
  read: true,
  starred: false,
  shared: false,
  shareNote: null,
} as ArticleDetail;

function renderPane(articleView: ArticleView, settings: Partial<Settings> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(['article', 'a1'], article);
  qc.setQueryData(['feeds'], { items: [{ feedId: 'f1', articleView }] });
  qc.setQueryData(['settings'], { ...DEFAULT_SETTINGS, ...settings });
  render(
    <QueryClientProvider client={qc}>
      <ReadingPane articleId="a1" />
    </QueryClientProvider>,
  );
}

const prose = (text: string) => screen.getByText(text).closest('.prose')!;

test('by default the body is a centered 70ch column at the medium size', () => {
  renderPane('readable');
  const column = screen.getByTestId('reading-column');
  expect(column).toHaveClass('mx-auto', 'max-w-[70ch]', 'text-base');
  expect(prose('Feed body')).toHaveClass('prose-base');
  // The title uses the same column, so it lines up with the body.
  expect(screen.getByRole('heading', { name: 'Post' }).parentElement).toHaveClass('max-w-[70ch]');
});

test('size and width apply to the Feed view', () => {
  renderPane('readable', { readingSize: 'large', readingWidth: 'narrow' });
  expect(screen.getByTestId('reading-column')).toHaveClass('max-w-[60ch]', 'text-lg');
  expect(prose('Feed body')).toHaveClass('prose-lg');
});

test('size and width apply to the Extracted view', () => {
  renderPane('simplified', { readingSize: 'small', readingWidth: 'wide' });
  expect(screen.getByTestId('reading-column')).toHaveClass('max-w-[90ch]', 'text-sm');
  expect(prose('Extracted body')).toHaveClass('prose-sm');
});

test('the Web view is not put in the column', () => {
  renderPane('web');
  expect(screen.queryByTestId('reading-column')).toBeNull();
});
