import { describe, expect, test } from 'vitest';
import {
  dropHighlight,
  folderDrop,
  HAS_CHILDREN_MESSAGE,
  NEST_LIMIT_MESSAGE,
  treeDrop,
  type DragData,
  type TreeDrop,
} from './folder-drop';
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

// A sidebar drop: one rule for the highlight while dragging and the drop.

const feedIn = (subscriptionId: string, folderId: string | null) =>
  ({ type: 'feed', subscriptionId, folderId }) as const;
const folderRow = (f: FolderRow) =>
  ({ type: 'folder', folderId: f.id, parentId: f.parentId }) as const;
const zone = (folderId: string | null) => ({ type: 'dropzone', folderId }) as const;

const tree = (
  active: DragData,
  over: DragData,
  more: Partial<Parameters<typeof treeDrop>[0]> = {},
): TreeDrop | null =>
  treeDrop({
    active,
    over,
    folders: [tech, news, css],
    reorder: false,
    feedScope: (folderId) => (folderId === 'tech' ? ['s1', 's2', 's3'] : ['s9']),
    folderScope: (parentId) => (parentId === null ? ['tech', 'news'] : ['css']),
    hasChildren: (id) => id === 'tech',
    y: 120,
    header: () => header,
    ...more,
  });

describe('treeDrop and dropHighlight', () => {
  test('a feed over another folder row, body or feed moves there, and that folder lights up', () => {
    const active = feedIn('s1', 'tech');
    for (const over of [folderRow(news), zone('news'), feedIn('s9', 'news')]) {
      const result = tree(active, over);
      expect(result).toEqual({
        kind: 'move-feed',
        subscriptionId: 's1',
        folderId: 'news',
        position: undefined,
      });
      expect(dropHighlight(result, active)).toBe('news');
    }
  });

  test('a feed over the top level moves out of its folder, and the top level lights up', () => {
    const active = feedIn('s1', 'tech');
    const result = tree(active, zone(null));
    expect(result).toMatchObject({ kind: 'move-feed', folderId: null });
    expect(dropHighlight(result, active)).toBeNull();
  });

  test('a feed over its own folder does nothing, and nothing lights up', () => {
    const active = feedIn('s1', 'tech');
    for (const over of [folderRow(tech), zone('tech'), feedIn('s2', 'tech')]) {
      expect(tree(active, over)).toBeNull();
      expect(dropHighlight(tree(active, over), active)).toBeUndefined();
    }
  });

  test('in manual order a feed reorders in its folder, with no folder lit (the rows make room)', () => {
    const active = feedIn('s1', 'tech');
    const result = tree(active, feedIn('s3', 'tech'), { reorder: true });
    expect(result).toEqual({
      kind: 'move-feed',
      subscriptionId: 's1',
      folderId: 'tech',
      position: 2,
    });
    expect(dropHighlight(result, active)).toBeUndefined();
  });

  test('a folder over the middle of a top-level row nests, and the new parent lights up', () => {
    const active = folderRow(news);
    const result = tree(active, folderRow(tech), { hasChildren: () => false });
    expect(result).toEqual({ kind: 'nest-folder', folderId: 'news', parentId: 'tech' });
    expect(dropHighlight(result, active)).toBe('tech');
  });

  test('a folder over the edge of a sibling in manual order reorders, with nothing lit', () => {
    const active = folderRow(news);
    const result = tree(active, folderRow(tech), { reorder: true, y: 104 });
    expect(result).toEqual({ kind: 'reorder-folder', folderId: 'news', position: 0 });
    expect(dropHighlight(result, active)).toBeUndefined();
  });

  test('a blocked folder drop says why, and nothing lights up', () => {
    const active = folderRow(tech);
    const result = tree(active, folderRow(news));
    expect(result).toEqual({ kind: 'blocked', message: HAS_CHILDREN_MESSAGE });
    expect(dropHighlight(result, active)).toBeUndefined();
  });

  test('a subfolder over the top level moves out, and the top level lights up; a top-level one does nothing', () => {
    const sub = folderRow(css);
    expect(tree(sub, zone(null))).toEqual({ kind: 'unnest-folder', folderId: 'css' });
    expect(dropHighlight(tree(sub, zone(null)), sub)).toBeNull();
    expect(tree(folderRow(news), zone(null))).toBeNull();
  });
});
