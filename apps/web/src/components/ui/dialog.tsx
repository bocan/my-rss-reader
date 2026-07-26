import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  createContext,
  useContext,
  useRef,
  type ComponentProps,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal dialog built on Radix. Radix handles the hard accessibility parts: focus
 * is trapped inside while open, the rest of the page is inert and aria-hidden,
 * and Escape / outside-click close it.
 *
 * On top of that, we restore focus to whatever opened the dialog. These dialogs
 * are opened from buttons and menu items elsewhere in the tree, not a
 * Dialog.Trigger, so Radix cannot know the opener. We capture it in the Dialog
 * wrapper at the exact render where `open` becomes true - before Radix mounts
 * the content and aria-hides (and so blurs) the opener - and DialogContent
 * focuses it back on close.
 */
const OpenerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function Dialog({ open, ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }
  wasOpen.current = !!open;
  return (
    <OpenerContext.Provider value={openerRef}>
      <DialogPrimitive.Root open={open} {...props} />
    </OpenerContext.Provider>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  restoreFocusRef,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  /** Element to focus on close. Overrides the auto-captured opener - needed when
   *  the dialog is opened from a menu item, since the item is gone by then. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const openerRef = useContext(OpenerContext);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(e) => {
          // Return focus to the explicit target, else whatever opened us.
          const opener = restoreFocusRef?.current ?? openerRef?.current;
          if (opener?.isConnected) {
            e.preventDefault();
            opener.focus();
          }
          onCloseAutoFocus?.(e);
        }}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-card p-5 shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            title="Close"
            className="absolute right-4 top-4 rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn('text-base font-semibold leading-none', className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}
