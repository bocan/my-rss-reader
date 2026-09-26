import type { FolderRow } from '@/lib/folders';

/** What a folder dropped on another folder's row does (#28). */
export type FolderDrop =
  | { kind: 'reorder' }
  | { kind: 'nest' }
  | { kind: 'none' }
  | { kind: 'blocked'; message: string };

export const NEST_LIMIT_MESSAGE = 'Folders can only be one level deep.';
export const HAS_CHILDREN_MESSAGE = 'A folder with subfolders cannot go inside another folder.';

/**
 * The drop rule. In manual order, the top and bottom quarters of a folder row
 * reorder, and the middle half nests. In the other orders the whole row nests,
 * because a reorder would not show (#27). The API caps nesting at one level;
 * this mirrors it, so a drop that would fail says why instead of sending a
 * request that gets a 400.
 *
 * `y` is the pointer, and `header` the target's row box. Either is null for a
 * keyboard drag: then manual order reorders siblings, and other drops nest.
 */
export function folderDrop(opts: {
  dragged: FolderRow;
  target: FolderRow;
  draggedHasChildren: boolean;
  reorder: boolean;
  y: number | null;
  header: { top: number; height: number } | null;
}): FolderDrop {
  const { dragged, target, y, header } = opts;
  if (dragged.id === target.id) return { kind: 'none' };

  let where: 'unknown' | 'outside' | 'edge' | 'middle' = 'unknown';
  if (y !== null && header) {
    const offset = y - header.top;
    if (offset < 0 || offset > header.height) where = 'outside';
    else if (offset < header.height / 4 || offset > (header.height * 3) / 4) where = 'edge';
    else where = 'middle';
  }

  if (opts.reorder && dragged.parentId === target.parentId && where !== 'middle') {
    return { kind: 'reorder' };
  }
  // Over the open contents of a folder, not its row: not a nest.
  if (where === 'outside') return { kind: 'none' };
  // Already inside it.
  if (target.id === dragged.parentId) return { kind: 'none' };
  if (target.parentId !== null) return { kind: 'blocked', message: NEST_LIMIT_MESSAGE };
  if (opts.draggedHasChildren) return { kind: 'blocked', message: HAS_CHILDREN_MESSAGE };
  return { kind: 'nest' };
}
