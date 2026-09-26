import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionRow } from '@/lib/folders';
import { FolderTree } from './folder-tree';

const markRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/articles', () => ({ useMarkRead: () => ({ mutate: markRead }) }));

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
  articleView: null,
  hideFromAll: false,
  inBlogroll: false,
  attention: 'normal',
  websubState: 'inactive',
  websubLeaseExpiresAt: null,
  fetchIntervalSec: null,
  lastFetchedAt: null,
  lastError: null,
  unreadCount: 3,
};

function renderTree() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['feeds'], { items: [sub] });
  render(
    <QueryClientProvider client={qc}>
      <FolderTree
        onSelectFeed={vi.fn()}
        onSelectFolder={vi.fn()}
        countByFeed={new Map([['f1', 3]])}
        sort="name"
      />
    </QueryClientProvider>,
  );
}

test('"Mark all read" fires even when the pointer moves a few px during the click', () => {
  renderTree();
  const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = screen.getByRole('menuitem', { name: 'Mark all read' });

  // A real click on a trackpad: down, a small wobble past the 4px drag
  // threshold, up, click. The row's drag sensor must not steal it.
  const at = (x: number) => ({ clientX: x, clientY: 0, button: 0, isPrimary: true, pointerId: 1 });
  fireEvent.pointerDown(item, at(0));
  fireEvent.mouseDown(item, at(0));
  fireEvent.pointerMove(document, at(10));
  fireEvent.mouseMove(document, at(10));
  fireEvent.pointerUp(document, at(10));
  fireEvent.mouseUp(document, at(10));
  fireEvent.click(item);

  expect(markRead).toHaveBeenCalledWith({ feedId: 'f1' });
});

// #21: phones.

const row = () => screen.getByTitle(sub.feedUrl);
const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }] });

test('the row menu button is always shown on touch screens', () => {
  renderTree();
  const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
  // Hidden until hover for a mouse, always visible for a coarse pointer.
  expect(trigger).toHaveClass('opacity-0', 'pointer-coarse:opacity-100');
});

describe('touch drag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a swipe to scroll never picks a row up', () => {
    renderTree();
    fireEvent.touchStart(row(), touch(100));
    act(() => vi.advanceTimersByTime(50));
    // Touch events stay on the element first touched, as in a browser.
    fireEvent.touchMove(row(), touch(160)); // moved before the hold ended
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchMove(row(), touch(220));
    expect(row()).not.toHaveClass('opacity-50');
    fireEvent.touchEnd(row(), touch(220));
  });

  test('a long press, then a move, still drags', () => {
    renderTree();
    fireEvent.touchStart(row(), touch(100));
    act(() => vi.advanceTimersByTime(300));
    fireEvent.touchMove(row(), touch(140));
    expect(row()).toHaveClass('opacity-50');
    fireEvent.touchEnd(row(), touch(140));
  });
});
