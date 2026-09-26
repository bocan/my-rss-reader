import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { AddMenu } from './add-menu';

// #35: "+" offers a feed, a folder, and OPML import.

test.each([
  ['Add feed', 'onAddFeed'],
  ['New folder', 'onNewFolder'],
  ['Import OPML', 'onImportOpml'],
] as const)('"%s" runs once the menu has closed', async (item, handler) => {
  const props = { onAddFeed: vi.fn(), onNewFolder: vi.fn(), onImportOpml: vi.fn() };
  render(<AddMenu {...props} />);
  const trigger = screen.getByRole('button', { name: 'Add' });
  expect(trigger).toHaveAttribute('title', 'Add a feed, a folder, or an OPML file');
  // jsdom closes a Radix menu on the window blur that a first focus fires.
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));

  await waitFor(() => expect(props[handler]).toHaveBeenCalledOnce());
  expect(screen.queryByRole('menu')).toBeNull();
  // Focus went back to "+" first, so a dialog returns it there.
  expect(trigger).toHaveFocus();
  for (const other of Object.values(props)) if (other !== props[handler]) expect(other).not.toHaveBeenCalled();
});
