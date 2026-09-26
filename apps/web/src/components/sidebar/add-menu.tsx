import { FolderPlus, Plus, Rss, Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The sidebar "+" (#35): add a feed, a folder, or a whole OPML file. A new
 * user with an OPML file looks here first, not in Settings.
 */
export function AddMenu({
  onAddFeed,
  onNewFolder,
  onImportOpml,
}: {
  onAddFeed: () => void;
  onNewFolder: () => void;
  onImportOpml: () => void;
}) {
  // Each action opens something that takes focus (a dialog or the folder
  // name field). It runs as the menu closes, so the menu puts focus back on
  // "+" first. Then the new field is not blurred by that, and a dialog
  // returns focus to "+" when it closes.
  const pending = useRef<(() => void) | null>(null);
  const later = (fn: () => void) => () => {
    pending.current = fn;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Add"
          title="Add a feed, a folder, or an OPML file"
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={() => {
          const fn = pending.current;
          pending.current = null;
          fn?.();
        }}
      >
        <DropdownMenuItem onSelect={later(onAddFeed)}>
          <Rss className="size-4" /> Add feed
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={later(onNewFolder)}>
          <FolderPlus className="size-4" /> New folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={later(onImportOpml)}>
          <Upload className="size-4" /> Import OPML
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
