import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { FolderRow } from '@/lib/folders';
import { FolderOptions } from './folder-options';

// #28: folder selects show subfolders under their parent, indented.

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, name, parentId }) as FolderRow;

test('subfolders follow their parent, indented, and roots are by name', () => {
  render(
    <select aria-label="Folder">
      <FolderOptions
        folders={[folder('n', 'News'), folder('c', 'CSS', 't'), folder('t', 'Tech'), folder('a', 'Art', 't')]}
      />
    </select>,
  );
  const options = screen.getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent]);
  const indent = String.fromCharCode(0xa0).repeat(4);
  expect(options).toEqual([
    ['n', 'News'],
    ['t', 'Tech'],
    ['a', `${indent}Art`],
    ['c', `${indent}CSS`],
  ]);
});
