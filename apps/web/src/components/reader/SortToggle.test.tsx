import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SortToggle } from './SortToggle';

// #31: one button flips newest and oldest first.

test('the button names the current order and flips to the other', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SortToggle sort="newest" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Newest first. Show oldest first' }));
  expect(onChange).toHaveBeenLastCalledWith('oldest');

  rerender(<SortToggle sort="oldest" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Oldest first. Show newest first' }));
  expect(onChange).toHaveBeenLastCalledWith('newest');
});
