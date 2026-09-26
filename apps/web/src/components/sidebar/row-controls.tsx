import { MoreHorizontal } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { stopDrag } from './stop-drag';

/**
 * The controls a sidebar row shares: feeds, folders and saved searches
 * (SPEC-025) use the same menu and the same inline rename.
 */

/**
 * Actions menu. Visible on hover, on keyboard focus, and always on touch
 * screens, which have no hover (#21). Never hover-only.
 */
export function RowMenu({
  label,
  children,
}: {
  label: string;
  /** `afterClose(fn)` runs `fn` once the menu has closed. */
  children: (afterClose: (fn: () => void) => void) => ReactNode;
}) {
  // Rename and New subfolder open a text field that takes focus. While the
  // menu closes, it puts focus back on its button, which would blur the field,
  // and a blur cancels it. So those actions wait until the menu has closed,
  // and then focus stays where the field puts it.
  const pending = useRef<(() => void) | null>(null);
  const afterClose = (fn: () => void) => {
    pending.current = fn;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      {/* The menu is portalled, but React still bubbles its presses up to the
          row's drag listeners. A few px of travel during the click then starts
          a drag, and dnd-kit swallows the click, so the item never fires. Keep
          menu presses out of the mouse and touch drag sensors. */}
      <DropdownMenuContent
        align="end"
        {...stopDrag}
        onCloseAutoFocus={(e) => {
          const fn = pending.current;
          if (!fn) return;
          pending.current = null;
          e.preventDefault();
          fn();
        }}
      >
        {children(afterClose)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InlineInput({
  defaultValue = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  // Enter or Escape closes the input, and the unmount can then fire a blur.
  // Only the first of these may act.
  const done = useRef(false);
  const finish = (act: () => void) => {
    if (done.current) return;
    done.current = true;
    act();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(() => onSubmit(value));
    if (e.key === 'Escape') finish(onCancel);
  };
  // #43: a click away keeps a new name. Only Escape throws it away.
  const onBlur = () => {
    const changed = value.trim() !== '' && value.trim() !== defaultValue.trim();
    finish(changed ? () => onSubmit(value) : onCancel);
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
