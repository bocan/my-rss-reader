import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { surfaceStub } from '../../../test/surface-stub';
import { ArticleStepper } from './ArticleStepper';
import { BrowseSurface } from './BrowseSurface';

// #23: Previous / Next buttons in the reading pane.

vi.mock('@/components/reading-pane/ReadingPane', () => ({
  ReadingPane: ({ articleId, stepper }: { articleId: string; stepper?: React.ReactNode }) => (
    <div data-testid="pane">
      {articleId}
      {stepper}
    </div>
  ),
}));

test('the buttons step both ways and are disabled at the ends', () => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const { rerender } = render(
    <ArticleStepper hasPrev={false} hasNext onPrev={onPrev} onNext={onNext} />,
  );
  expect(screen.getByRole('button', { name: 'Previous article' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next article' }));
  expect(onNext).toHaveBeenCalledOnce();

  rerender(<ArticleStepper hasPrev hasNext={false} onPrev={onPrev} onNext={onNext} />);
  expect(screen.getByRole('button', { name: 'Next article' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous article' }));
  expect(onPrev).toHaveBeenCalledOnce();
});

test.each(['cards', 'magazine'] as const)('the %s reader shows the stepper', (view) => {
  const openAdjacent = vi.fn();
  const surface = surfaceStub({ openAdjacent });
  render(
    <BrowseSurface
      surface={surface}
      feeds={{}}
      view={view}
      selectedId="a1"
      onSelect={vi.fn()}
      onBack={vi.fn()}
      stepper={
        <ArticleStepper
          hasPrev
          hasNext
          onPrev={() => surface.openAdjacent(-1)}
          onNext={() => surface.openAdjacent(1)}
        />
      }
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next article' }));
  expect(openAdjacent).toHaveBeenCalledWith(1);
});
