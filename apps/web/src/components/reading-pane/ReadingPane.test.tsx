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

// SPEC-024: the Wayback Machine is one click away, and a star keeps a copy.
const WAYBACK = 'https://web.archive.org/web/https://code.claude.com/docs/en/changelog#2-1-281';

test('the header links to the Wayback Machine in a new tab', () => {
  renderPane({ defaultArticleView: 'readable' });
  const link = screen.getByRole('link', { name: 'Wayback' });
  expect(link).toHaveAttribute('href', WAYBACK);
  expect(link).toHaveAttribute('title', 'Find on the Wayback Machine');
  expect(link).toHaveAttribute('target', '_blank');
});

test('no Wayback link for an item with no URL', () => {
  renderPane({ defaultArticleView: 'readable' }, null, { url: null });
  expect(screen.queryByRole('link', { name: 'Wayback' })).toBeNull();
});

test('a failed extraction points at the Wayback Machine', () => {
  renderPane({ defaultArticleView: 'simplified' }, null, {
    readableHtml: null,
    readableFetchedAt: '2026-09-01T00:00:00Z',
  });
  expect(screen.getByText('Could not extract a clean version of this article.')).toBeInTheDocument();
  expect(screen.getByText(/The original may have moved or died/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Try the Wayback Machine.' })).toHaveAttribute('href', WAYBACK);
});

test('an empty Feed view points at the Wayback Machine', () => {
  renderPane({ defaultArticleView: 'readable' }, null, { contentHtml: null, summary: null });
  expect(screen.getByText('No content in this item. Try the Web view.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Try the Wayback Machine.' })).toBeInTheDocument();
});

test('a stored copy shows in Extracted even offline, with no fetch', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  renderPane({ defaultArticleView: 'simplified' }, null, {
    starred: true,
    readableHtml: '<p>Kept while the site was alive.</p>',
    readableFetchedAt: '2026-01-01T00:00:00Z',
  });
  expect(screen.getByText('Kept while the site was alive.')).toBeInTheDocument();
  vi.restoreAllMocks();
});

test('the star says it keeps a readable copy', () => {
  renderPane();
  expect(screen.getByRole('button', { name: 'Star' })).toHaveAttribute(
    'title',
    'Star (keeps a readable copy) (s)',
  );
});

test('a feed override beats an auto default', () => {
  renderPane({ defaultArticleView: 'auto' }, 'web');
  expect(pressed()).toEqual(['Web']);
  expect(screen.queryByText('Auto')).not.toBeInTheDocument();
});
