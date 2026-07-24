import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SHORTCUTS, type Shortcut } from '@/lib/shortcuts/registry';

/** Render a shortcut's trigger as <kbd> chips ("g then g" for chords). */
function KeyHint({ shortcut }: { shortcut: Shortcut }) {
  const kbd = (k: string) => (
    <kbd
      key={k}
      className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
    >
      {k === ' ' ? 'Space' : k}
    </kbd>
  );
  if (shortcut.chord) {
    return (
      <span className="flex items-center gap-1">
        {kbd(shortcut.chord[0])}
        <span className="text-xs text-muted-foreground">then</span>
        {kbd(shortcut.chord[1])}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {shortcut.keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
          {kbd(k)}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  // Group in registry order so adding an entry needs no other edit.
  const groups = SHORTCUTS.reduce<Record<string, Shortcut[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </div>

        <div className="space-y-4">
          {Object.entries(groups).map(([group, items]) => (
            <section key={group}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h3>
              <ul className="divide-y">
                {items.map((s) => (
                  <li
                    key={s.label}
                    data-shortcut-row
                    className="flex items-center justify-between gap-4 py-1.5 text-sm"
                  >
                    <span>{s.label}</span>
                    <KeyHint shortcut={s} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
