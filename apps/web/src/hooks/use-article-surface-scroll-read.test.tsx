import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { registerMutationDefaults } from '@/lib/articles';
import { useArticleSurface } from './use-article-surface';

// #17 wiring: the setting turns the row observer on, and a row that scrolls
// past the top reaches the API as one mark-read batch.

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
class FakeObserver {
  static all: FakeObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: Callback) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}
const rowObserver = (row: Element) => FakeObserver.all.find((o) => o.observed.has(row));

const filters = { sort: 'newest' as const };
let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  Element.prototype.scrollTo = () => {}; // jsdom has no element scrolling
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  registerMutationDefaults(qc);
  qc.setQueryData(['articles', filters], {
    pages: [
      {
        items: [
          { id: 'a1', feedId: 'f1', read: false, starred: false },
          { id: 'a2', feedId: 'f1', read: false, starred: false },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ on }: { on: boolean }) {
  const s = useArticleSurface(filters, undefined, { markReadOnScroll: on });
  return (
    <div ref={s.rootRef}>
      {s.items.map((a) => (
        <div key={a.id} ref={s.registerRow(a.id)}>
          {a.id}
        </div>
      ))}
      <div ref={s.sentinelRef} />
    </div>
  );
}

const renderHarness = (on: boolean) =>
  render(
    <QueryClientProvider client={qc}>
      <Harness on={on} />
    </QueryClientProvider>,
  );

// jsdom puts the list top at 0, so "past the top" is a bottom edge below 0.
const seen = (target: Element) => ({
  target,
  isIntersecting: true,
  boundingClientRect: { bottom: 50, height: 50 } as DOMRectReadOnly,
});
const scrolledPast = (target: Element) => ({
  target,
  isIntersecting: false,
  boundingClientRect: { bottom: -10, height: 50 } as DOMRectReadOnly,
});

test('with the setting off, rows are not observed for reading', () => {
  renderHarness(false);
  expect(rowObserver(screen.getByText('a1'))).toBeUndefined();
});

test('with it on, a row scrolled past the top is marked read in one batch', async () => {
  renderHarness(true);
  const row = screen.getByText('a1');
  const observer = rowObserver(row)!;
  expect(observer).toBeDefined();

  act(() => observer.callback([seen(row)]));
  act(() => observer.callback([scrolledPast(row)]));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/articles\/mark-read$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ articleIds: ['a1'] }) }),
    ),
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});
