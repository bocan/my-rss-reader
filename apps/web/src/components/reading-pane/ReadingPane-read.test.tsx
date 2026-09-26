import { DEFAULT_SETTINGS, type ArticleDetail, type Settings } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { registerMutationDefaults } from '@/lib/articles';
import { ReadingPane } from './ReadingPane';

// #24: the pane shows the read state, can mark unread, and can leave marking
// to the user. No request ever settles; the optimistic cache is the truth.

const api = vi.hoisted(() =>
  vi.fn((_path: string, _init?: { body?: { read?: boolean } }) => new Promise(() => {})),
);
vi.mock('@/lib/api', () => ({ api, ApiRequestError: class ApiRequestError extends Error {} }));

const item = (read: boolean) =>
  ({
    id: 'a1',
    title: 'Post',
    author: null,
    url: null,
    contentHtml: '<p>Body</p>',
    summary: null,
    publishedAt: null,
    readableHtml: null,
    readableFetchedAt: null,
    enclosureUrl: null,
    enclosureType: null,
    feed: { id: 'f1', title: 'Feed', siteUrl: null, faviconUrl: null },
    read,
    starred: false,
    shared: false,
    shareNote: null,
  }) as ArticleDetail;

let qc: QueryClient;
beforeEach(() => {
  api.mockClear();
});

function renderPane(read: boolean, settings: Partial<Settings> = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  registerMutationDefaults(qc);
  qc.setQueryData(['article', 'a1'], item(read));
  qc.setQueryData(['feeds'], { items: [{ feedId: 'f1', articleView: 'readable' }] });
  qc.setQueryData(['settings'], { ...DEFAULT_SETTINGS, ...settings });
  render(
    <QueryClientProvider client={qc}>
      <ReadingPane articleId="a1" />
    </QueryClientProvider>,
  );
}

const readBodies = () =>
  api.mock.calls
    .filter(([path]) => path.endsWith('/state'))
    .map(([, init]) => init?.body?.read);
const isRead = () => qc.getQueryData<ArticleDetail>(['article', 'a1'])!.read;
const flush = () => act(async () => {});

test('opening an unread article marks it read by default, and the pane says so', async () => {
  renderPane(false);
  expect(await screen.findByRole('button', { name: 'Mark unread' })).toBeInTheDocument();
  expect(readBodies()).toEqual([true]);
});

test('with "Mark read when opened" off, opening changes nothing', async () => {
  renderPane(false, { markReadOnOpen: false });
  await flush();
  expect(readBodies()).toEqual([]);
  expect(isRead()).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  await flush();
  expect(readBodies()).toEqual([true]);
});

test('Mark unread on the open article keeps it unread while it stays open', async () => {
  renderPane(false);
  // Marked read on open.
  fireEvent.click(await screen.findByRole('button', { name: 'Mark unread' }));

  expect(await screen.findByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  await flush();
  expect(readBodies()).toEqual([true, false]);
  expect(isRead()).toBe(false);
});

test('an already-read article marked unread from outside (u key) is not re-marked', async () => {
  renderPane(true);
  await flush();
  // What `u` does: an optimistic write to the detail cache, not via the pane.
  act(() => {
    qc.setQueryData(['article', 'a1'], item(false));
  });
  expect(await screen.findByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  await flush();

  expect(readBodies()).toEqual([]);
  expect(isRead()).toBe(false);
});
