import { createRef } from 'react';
import { vi } from 'vitest';
import type { ArticleSurface } from '@/hooks/use-article-surface';

/** An ArticleSurface with inert defaults, for component tests. */
export function surfaceStub(over: Partial<ArticleSurface> = {}): ArticleSurface {
  return {
    items: [],
    asOf: null,
    isLoading: false,
    isError: false,
    error: null,
    retry: vi.fn(),
    newCount: 0,
    showNew: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    focusedId: null,
    setFocusedId: vi.fn(),
    focusNext: vi.fn(),
    focusPrev: vi.fn(),
    openAdjacent: vi.fn(),
    adjacency: () => ({ hasPrev: false, hasNext: false }),
    focusFirst: vi.fn(),
    getFocused: () => null,
    registerRow: () => () => {},
    rootRef: createRef(),
    sentinelRef: createRef(),
    ...over,
  };
}
