import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { surfaceStub } from '../../../test/surface-stub';
import { ArticleScroller } from './ArticleScroller';

test('a load error offers Try again, which refetches (#15)', () => {
  const s = surfaceStub({ isError: true, error: new Error('boom') });
  render(<ArticleScroller surface={s}>{null}</ArticleScroller>);

  expect(screen.getByText('Could not load the articles.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(s.retry).toHaveBeenCalledOnce();
});
