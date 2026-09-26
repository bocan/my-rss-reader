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

function renderPane(
  settings: Partial<Settings> = {},
  articleView: string | null = null,
  article: Partial<ArticleDetail> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(['article', 'a1'], { ...changelogItem, ...article });
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
  // #48: the same name as in Settings and the feed dialog.
  expect(screen.getByRole('group', { name: 'Article view' })).toBeInTheDocument();
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

// #47: a summary is the article as the feed sends it, not a grey notice.
test('a summary-only item reads as body text, and offers Extracted and the original', () => {
  renderPane({ defaultArticleView: 'readable' }, null, {
    contentHtml: null,
    summary: 'The whole point of the post.',
    url: 'https://ex.com/post',
  });
  const body = screen.getByTestId('feed-summary');
  expect(body).toHaveClass('prose');
  expect(body).toHaveTextContent('The whole point of the post.');
  expect(screen.getByText('This feed sends only a summary.')).toBeInTheDocument();
  // One in the header, and one under the summary, where the reader ends up.
  const originals = screen.getAllByRole('link', { name: 'Open original' });
  expect(originals).toHaveLength(2);
  expect(originals[1]).toHaveAttribute('href', 'https://ex.com/post');
  expect(originals[1]).toHaveAttribute('target', '_blank');

  // Two "Extracted" buttons now: the switcher and the one under the summary.
  const extracted = screen.getAllByRole('button', { name: 'Extracted' });
  fireEvent.click(extracted[extracted.length - 1]!);
  expect(pressed()).toEqual(['Extracted']);
});

// #49: the article takes focus, so Space scrolls it at once.
test('the article body has focus once it opens, and shows the key hint', () => {
  renderPane({ defaultArticleView: 'readable' });
  const column = screen.getByTestId('reading-column');
  expect(document.activeElement).toBe(column.parentElement);
  expect(column.parentElement).toHaveAttribute('tabindex', '-1');
  expect(screen.getByTestId('key-hint')).toHaveTextContent('v open original');
});

test('the article does not take focus from a field the user is typing in', () => {
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  renderPane();
  expect(document.activeElement).toBe(field);
  field.remove();
});

test('a feed override beats an auto default', () => {
  renderPane({ defaultArticleView: 'auto' }, 'web');
  expect(pressed()).toEqual(['Web']);
  expect(screen.queryByText('Auto')).not.toBeInTheDocument();
});
