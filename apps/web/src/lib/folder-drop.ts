import { dropIndex } from '@/lib/feed-order';
import type { FolderRow } from '@/lib/folders';

/** What each sidebar drag source and drop target carries (dnd-kit `data`). */
export type DragData =
  | { type: 'feed'; subscriptionId: string; folderId: string | null }
  | { type: 'folder'; folderId: string; parentId: string | null }
  | { type: 'dropzone'; folderId: string | null };

/** What a sidebar drop does. Null: nothing. */
export type TreeDrop =
  | { kind: 'move-feed'; subscriptionId: string; folderId: string | null; position?: number }
  | { kind: 'nest-folder'; folderId: string; parentId: string }
  | { kind: 'reorder-folder'; folderId: string; position: number }
  | { kind: 'unnest-folder'; folderId: string }
  | { kind: 'blocked'; message: string };

/**
 * The one rule for a sidebar drop, used both while dragging (to highlight the
 * folder it lands in) and at the drop (to do it), so the two cannot disagree.
 *
 * A feed goes to the folder of what it is over: a feed row, a folder row or a
 * folder body. Only manual order places it at the row it is over; otherwise
 * the sort decides where it shows, so only a move to another folder counts. A
 * folder follows folderDrop() over a folder row, and goes to the top level
 * over the root zone.
 */
export function treeDrop(opts: {
  active: DragData;
  over: DragData;
  folders: FolderRow[];
  reorder: boolean;
  /** Subscription ids in a folder (null: top level), in display order. */
  feedScope: (folderId: string | null) => string[];
  /** Folder ids under a parent (null: top level), in display order. */
  folderScope: (parentId: string | null) => string[];
  hasChildren: (folderId: string) => boolean;
  /** Pointer y, or null for a keyboard drag. */
  y: number | null;
  /** A folder's own row box (not its open contents). */
  header: (folderId: string) => { top: number; height: number } | null;
}): TreeDrop | null {
  const { active: a, over: o } = opts;

  if (a.type === 'feed') {
    const folderId = o.folderId;
    let position: number | undefined;
    if (o.type === 'feed') {
      if (o.subscriptionId === a.subscriptionId) return null;
      if (opts.reorder)
        position = dropIndex(opts.feedScope(folderId), a.subscriptionId, o.subscriptionId);
      else if (folderId === a.folderId) return null;
    }
    if (folderId === a.folderId && position === undefined) return null;
    return { kind: 'move-feed', subscriptionId: a.subscriptionId, folderId, position };
  }

  if (a.type === 'folder') {
    if (o.type === 'folder') {
      const dragged = opts.folders.find((f) => f.id === a.folderId);
      const target = opts.folders.find((f) => f.id === o.folderId);
      if (!dragged || !target) return null;
      const drop = folderDrop({
        dragged,
        target,
        draggedHasChildren: opts.hasChildren(dragged.id),
        reorder: opts.reorder,
        y: opts.y,
        header: opts.header(target.id),
      });
      if (drop.kind === 'blocked') return drop;
      if (drop.kind === 'nest')
        return { kind: 'nest-folder', folderId: dragged.id, parentId: target.id };
      if (drop.kind === 'reorder') {
        const position = dropIndex(opts.folderScope(dragged.parentId), dragged.id, target.id);
        return { kind: 'reorder-folder', folderId: dragged.id, position };
      }
      return null;
    }
    if (o.type === 'dropzone' && o.folderId === null && a.parentId !== null) {
      return { kind: 'unnest-folder', folderId: a.folderId };
    }
  }
  return null;
}

/**
 * The folder to highlight while dragging: where the drop moves the item.
 * A folder id, null for the top level, or undefined when the drop moves
 * nothing to another folder (no drop, a block, or a reorder in place, which
 * the rows show by making room).
 */
export function dropHighlight(drop: TreeDrop | null, active: DragData): string | null | undefined {
  if (!drop) return undefined;
  if (drop.kind === 'move-feed') {
    return active.type === 'feed' && drop.folderId !== active.folderId ? drop.folderId : undefined;
  }
  if (drop.kind === 'nest-folder') return drop.parentId;
  if (drop.kind === 'unnest-folder') return null;
  return undefined;
}

/** What a folder dropped on another folder's row does (#28). */
export type FolderDrop =
  { kind: 'reorder' } | { kind: 'nest' } | { kind: 'none' } | { kind: 'blocked'; message: string };

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
