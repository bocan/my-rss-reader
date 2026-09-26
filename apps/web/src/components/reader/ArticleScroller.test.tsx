import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test, vi } from 'vitest';
import type { ArticleSurface } from '@/hooks/use-article-surface';
import { ArticleScroller } from './ArticleScroller';

function surface(over: Partial<ArticleSurface>): ArticleSurface {
  return {
    items: [],
    asOf: null,
    isLoading: false,
    isError: false,
    error: null,
    retry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    focusedId: null,
    setFocusedId: vi.fn(),
    focusNext: vi.fn(),
    focusPrev: vi.fn(),
    focusFirst: vi.fn(),
    getFocused: () => null,
    registerRow: () => () => {},
    rootRef: createRef(),
    sentinelRef: createRef(),
    ...over,
  };
}

test('a load error offers Try again, which refetches (#15)', () => {
  const s = surface({ isError: true, error: new Error('boom') });
  render(<ArticleScroller surface={s}>{null}</ArticleScroller>);

  expect(screen.getByText('Could not load the articles.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(s.retry).toHaveBeenCalledOnce();
});
