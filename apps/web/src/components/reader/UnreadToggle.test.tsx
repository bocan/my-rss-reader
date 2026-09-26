import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { UnreadToggle } from './UnreadToggle';

// #34: the filter reads as words, and its tooltip names the sidebar effect.

test('two words, with the current one pressed', () => {
  render(<UnreadToggle unreadOnly onChange={vi.fn()} />);
  expect(screen.getByRole('group', { name: 'Articles to show' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
});

test('a click on the other word switches the filter; the current one does nothing', () => {
  const onChange = vi.fn();
  render(<UnreadToggle unreadOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('the tooltip says the sidebar is filtered too', () => {
  render(<UnreadToggle unreadOnly={false} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute(
    'title',
    expect.stringMatching(/sidebar also hides feeds/),
  );
});
