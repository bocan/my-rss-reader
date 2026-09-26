import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { SearchField, SearchScope } from './Search';

// #33: search scope, clear, and Escape.

function Field({ initial = '', onLeave = vi.fn() }: { initial?: string; onLeave?: () => void }) {
  const [value, setValue] = useState(initial);
  return <SearchField value={value} onChange={setValue} onLeave={onLeave} />;
}

describe('SearchField', () => {
  test('the clear button empties the box and keeps focus there', () => {
    render(<Field initial="kubernetes" />);
    const box = screen.getByRole('searchbox', { name: 'Search articles' });
    box.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    // Nothing to clear, so no button.
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  test('Escape clears first, then leaves the box', () => {
    const onLeave = vi.fn();
    render(<Field initial="kubernetes" onLeave={onLeave} />);
    const box = screen.getByRole('searchbox');
    box.focus();

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(onLeave).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).not.toHaveFocus();
    expect(onLeave).toHaveBeenCalled();
  });

  test('Escape does not reach the page shortcuts (which close the article)', () => {
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    render(<Field initial="x" />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);
    expect(onDocKey).not.toHaveBeenCalled();
  });
});

describe('SearchScope', () => {
  const base = {
    query: 'rust',
    scope: 'Kubernetes Blog',
    allFeeds: false,
    unreadOnly: false,
    onSearchAll: vi.fn(),
    onClear: vi.fn(),
  };

  test('states the query and the scope', () => {
    render(<SearchScope {...base} />);
    expect(screen.getByText(/Results for/).textContent).toBe('Results for "rust" in Kubernetes Blog');
  });

  test('says when only unread articles are searched', () => {
    render(<SearchScope {...base} unreadOnly />);
    expect(screen.getByText(/Results for/).textContent).toBe(
      'Results for "rust" in Kubernetes Blog (unread only)',
    );
  });

  test('offers to search every feed, and not when it already does', () => {
    const onSearchAll = vi.fn();
    const { rerender } = render(<SearchScope {...base} onSearchAll={onSearchAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search all feeds' }));
    expect(onSearchAll).toHaveBeenCalled();

    rerender(<SearchScope {...base} allFeeds scope="All items" />);
    expect(screen.getByText(/Results for/).textContent).toBe('Results for "rust" in all feeds');
    expect(screen.queryByRole('button', { name: 'Search all feeds' })).toBeNull();
  });

  test('Clear ends the search', () => {
    const onClear = vi.fn();
    render(<SearchScope {...base} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});
