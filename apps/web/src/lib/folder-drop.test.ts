import { describe, expect, test } from 'vitest';
import { folderDrop, HAS_CHILDREN_MESSAGE, NEST_LIMIT_MESSAGE } from './folder-drop';
import type { FolderRow } from './folders';

// #28: dropping a folder on a folder row.

const folder = (id: string, parentId: string | null = null) => ({ id, parentId }) as FolderRow;
const tech = folder('tech');
const news = folder('news');
const css = folder('css', 'tech');
const header = { top: 100, height: 40 }; // middle half: 110 to 130

const drop = (over: Partial<Parameters<typeof folderDrop>[0]>) =>
  folderDrop({
    dragged: news,
    target: tech,
    draggedHasChildren: false,
    reorder: true,
    y: 120,
    header,
    ...over,
  }).kind;

describe('manual order', () => {
  test('the middle of a sibling row nests, its edges reorder', () => {
    expect(drop({ y: 120 })).toBe('nest');
    expect(drop({ y: 104 })).toBe('reorder');
    expect(drop({ y: 136 })).toBe('reorder');
  });

  test('a keyboard drag (no pointer) reorders siblings', () => {
    expect(drop({ y: null, header: null })).toBe('reorder');
  });
});

describe('name and unread order', () => {
  test('anywhere on a top-level row nests, because a reorder would not show', () => {
    expect(drop({ reorder: false, y: 104 })).toBe('nest');
    expect(drop({ reorder: false, y: 120 })).toBe('nest');
    expect(drop({ reorder: false, y: null, header: null })).toBe('nest');
  });

  test('over the open contents of a folder, not its row, nothing happens', () => {
    expect(drop({ reorder: false, y: 200 })).toBe('none');
  });
});

describe('the one-level limit', () => {
  test('a subfolder cannot take a folder, and says why', () => {
    const result = folderDrop({
      dragged: news,
      target: css,
      draggedHasChildren: false,
      reorder: false,
      y: 120,
      header,
    });
    expect(result).toEqual({ kind: 'blocked', message: NEST_LIMIT_MESSAGE });
  });

  test('a folder with subfolders cannot go inside another', () => {
    const result = folderDrop({
      dragged: tech,
      target: news,
      draggedHasChildren: true,
      reorder: false,
      y: 120,
      header,
    });
    expect(result).toEqual({ kind: 'blocked', message: HAS_CHILDREN_MESSAGE });
  });

  test('a subfolder moves to another top-level folder, and a drop on its own parent does nothing', () => {
    expect(drop({ dragged: css, target: news, reorder: false })).toBe('nest');
    expect(drop({ dragged: css, target: tech, reorder: false })).toBe('none');
  });

  test('a folder dropped on itself does nothing', () => {
    expect(drop({ dragged: tech, target: tech })).toBe('none');
  });
});
