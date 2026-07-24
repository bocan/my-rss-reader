import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { SHORTCUTS } from '@/lib/shortcuts/registry';

test('renders nothing when closed', () => {
  const { container } = render(<ShortcutsOverlay open={false} onOpenChange={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test('renders exactly one row per registry entry, so help cannot drift', () => {
  render(<ShortcutsOverlay open onOpenChange={vi.fn()} />);
  expect(document.querySelectorAll('[data-shortcut-row]')).toHaveLength(SHORTCUTS.length);
});

test('shows every group heading and renders a chord as two keys', () => {
  render(<ShortcutsOverlay open onOpenChange={vi.fn()} />);
  for (const group of new Set(SHORTCUTS.map((s) => s.group))) {
    expect(screen.getByText(group)).toBeInTheDocument();
  }
  // The g-then-g chord is rendered with a "then" separator.
  expect(screen.getByText('then')).toBeInTheDocument();
  expect(screen.getByText('Jump to top')).toBeInTheDocument();
});
