import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { surfaceStub } from '../../../test/surface-stub';
import { ArticleScroller } from './ArticleScroller';

test('new articles wait behind a bar, which loads them on a click (#30)', () => {
  const s = surfaceStub({ newCount: 3 });
  const { rerender } = render(<ArticleScroller surface={s}>{null}</ArticleScroller>);

  fireEvent.click(screen.getByRole('button', { name: '3 new articles' }));
  expect(s.showNew).toHaveBeenCalledOnce();

  rerender(<ArticleScroller surface={surfaceStub({ newCount: 1 })}>{null}</ArticleScroller>);
  expect(screen.getByRole('button', { name: '1 new article' })).toBeInTheDocument();
  rerender(<ArticleScroller surface={surfaceStub()}>{null}</ArticleScroller>);
  expect(screen.queryByRole('button', { name: /new article/ })).not.toBeInTheDocument();
});

test('a load error offers Try again, which refetches (#15)', () => {
  const s = surfaceStub({ isError: true, error: new Error('boom') });
  render(<ArticleScroller surface={s}>{null}</ArticleScroller>);

  expect(screen.getByText('Could not load the articles.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(s.retry).toHaveBeenCalledOnce();
});
