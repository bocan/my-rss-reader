import { THEMES, type ThemeSetting } from '@rss/shared';
import { Palette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Tile = { id: ThemeSetting; name: string; swatch: { bg: string; fg: string; accent: string } };

// Auto first, then the eight named themes.
const TILES: Tile[] = [
  { id: 'auto', name: 'Auto', swatch: { bg: '#ffffff', fg: '#12151c', accent: '#2f6fd0' } },
  ...THEMES.map((t) => ({ id: t.id as ThemeSetting, name: t.name, swatch: t.swatch })),
];

/** A swatch tile: background with foreground + accent dots. Auto shows a split. */
function Swatch({ tile }: { tile: Tile }) {
  if (tile.id === 'auto') {
    return (
      <span className="relative block h-10 w-full overflow-hidden rounded-md border">
        <span className="absolute inset-0" style={{ background: '#ffffff' }} />
        <span
          className="absolute inset-0"
          style={{ background: '#12151c', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        />
        <span
          className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: '#2f6fd0' }}
        />
      </span>
    );
  }
  return (
    <span
      className="relative flex h-10 w-full items-center gap-1 rounded-md border px-2"
      style={{ background: tile.swatch.bg }}
    >
      <span className="size-3 rounded-full" style={{ background: tile.swatch.accent }} />
      <span className="size-2 rounded-full opacity-70" style={{ background: tile.swatch.fg }} />
    </span>
  );
}

/** The grid of theme tiles. Hovering/focusing previews live; clicking persists. */
export function ThemeTiles({ onPick }: { onPick?: () => void }) {
  const { theme, setTheme, preview } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="grid grid-cols-3 gap-2"
      onPointerLeave={() => preview(null)}
    >
      {TILES.map((tile) => (
        <button
          key={tile.id}
          type="button"
          aria-pressed={theme === tile.id}
          onPointerEnter={() => preview(tile.id)}
          onFocus={() => preview(tile.id)}
          onBlur={() => preview(null)}
          onClick={() => {
            setTheme(tile.id);
            onPick?.();
          }}
          className={cn(
            'flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-shadow',
            theme === tile.id ? 'ring-2 ring-primary' : 'hover:bg-accent',
          )}
        >
          <Swatch tile={tile} />
          <span className="px-0.5 text-xs">{tile.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Header control: a palette button that opens the theme grid in a popover. */
export function ThemePickerButton() {
  const [open, setOpen] = useState(false);
  const { preview } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reverting the preview when the popover closes keeps the saved theme showing.
  useEffect(() => {
    if (!open) preview(null);
  }, [open, preview]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Theme"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border bg-popover p-2 shadow-lg">
          <ThemeTiles onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
