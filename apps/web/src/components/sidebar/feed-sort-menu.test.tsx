import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { FeedSortMenu } from './feed-sort-menu';

// #27: three sort modes, one of them manual.

test('the button names the current mode, and the menu offers all three', () => {
  const onChange = vi.fn();
  render(<FeedSortMenu sort="name" onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'Sort feeds: By name' });

  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('menuitemradio', { name: 'By name' })).toBeChecked();
  expect(screen.getByRole('menuitemradio', { name: 'By unread count' })).not.toBeChecked();

  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Manual (drag to reorder)' }));
  expect(onChange).toHaveBeenCalledWith('manual');
});
