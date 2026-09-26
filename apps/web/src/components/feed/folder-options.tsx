import { folderChoices } from '@/lib/feed-order';
import type { FolderRow } from '@/lib/folders';

/** A native option cannot take padding, so the indent is non-breaking spaces. */
const INDENT = String.fromCharCode(0xa0).repeat(4);

/** The `<option>`s for a folder select: subfolders under their parent,
 *  indented (#28). */
export function FolderOptions({ folders }: { folders: readonly FolderRow[] }) {
  return folderChoices(folders).map(({ folder, depth }) => (
    <option key={folder.id} value={folder.id}>
      {depth ? INDENT + folder.name : folder.name}
    </option>
  ));
}
