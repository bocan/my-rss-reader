import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createScrollReadTracker, SCROLL_READ_BATCH } from './scroll-read';

// The list's top edge sits at y = 100 in these tests.
const TOP = 100;
const onScreen = { isIntersecting: true, bottom: 300, height: 80 };
const pastTop = { isIntersecting: false, bottom: 90, height: 80 };
const belowBottom = { isIntersecting: false, bottom: 2000, height: 80 };
const hidden = { isIntersecting: false, bottom: 0, height: 0 };

let unread: Set<string>;
let flush: ReturnType<typeof vi.fn<(ids: string[]) => void>>;
const make = () =>
  createScrollReadTracker({ isUnread: (id) => unread.has(id), flush, delayMs: 500 });

beforeEach(() => {
  vi.useFakeTimers();
  unread = new Set(['a', 'b', 'c']);
  flush = vi.fn<(ids: string[]) => void>();
});
afterEach(() => vi.useRealTimers());

test('a row seen and then scrolled past the top is marked', () => {
  const t = make();
  t.update('a', onScreen, TOP);
  t.update('a', pastTop, TOP);
  vi.advanceTimersByTime(500);
  expect(flush).toHaveBeenCalledWith(['a']);
});

test('a row never on screen is never marked, even if it is above the top', () => {
  const t = make();
  t.update('a', pastTop, TOP);
  vi.advanceTimersByTime(500);
  expect(flush).not.toHaveBeenCalled();
});

test('a row that leaves over the bottom edge is not marked', () => {
  const t = make();
  t.update('a', onScreen, TOP);
  t.update('a', belowBottom, TOP);
  vi.advanceTimersByTime(500);
  expect(flush).not.toHaveBeenCalled();
});

test('a list hidden by the reader marks nothing', () => {
  const t = make();
  t.update('a', onScreen, TOP);
  t.update('a', hidden, TOP);
  vi.advanceTimersByTime(500);
  expect(flush).not.toHaveBeenCalled();
});

test('read rows are skipped, also when they became read while queued', () => {
  const t = make();
  unread.delete('b');
  for (const id of ['a', 'b', 'c']) {
    t.update(id, onScreen, TOP);
    t.update(id, pastTop, TOP);
  }
  unread.delete('c'); // e.g. opened in the reader before the flush
  vi.advanceTimersByTime(500);
  expect(flush).toHaveBeenCalledWith(['a']);
});

test('a fast scroll sends one batched request, not one per row', () => {
  const t = make();
  for (const id of ['a', 'b', 'c']) {
    t.update(id, onScreen, TOP);
    t.update(id, pastTop, TOP);
    vi.advanceTimersByTime(100);
  }
  expect(flush).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(flush).toHaveBeenCalledOnce();
  expect(flush).toHaveBeenCalledWith(['a', 'b', 'c']);
});

test('flushNow sends at once and splits large batches', () => {
  const ids = Array.from({ length: SCROLL_READ_BATCH + 5 }, (_, i) => `x${i}`);
  unread = new Set(ids);
  const t = make();
  for (const id of ids) {
    t.update(id, onScreen, TOP);
    t.update(id, pastTop, TOP);
  }
  t.flushNow();
  expect(flush).toHaveBeenCalledTimes(2);
  expect(flush.mock.calls[0]![0]).toHaveLength(SCROLL_READ_BATCH);
  expect(flush.mock.calls[1]![0]).toHaveLength(5);
  // Nothing is left for the timer.
  vi.advanceTimersByTime(500);
  expect(flush).toHaveBeenCalledTimes(2);
});
