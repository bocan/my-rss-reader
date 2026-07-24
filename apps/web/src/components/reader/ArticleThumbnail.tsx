import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Deterministic hue per feed, so a feed's placeholders are consistent. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

type Stage = 'image' | 'favicon' | 'placeholder';

interface ArticleThumbnailProps {
  imageUrl: string | null;
  faviconUrl: string | null;
  feedId: string;
  title: string;
  className?: string;
}

/**
 * Thumbnail with a graceful chain: article image -> feed favicon -> generated
 * tint + initial. Never shows a broken-image icon.
 */
export function ArticleThumbnail({
  imageUrl,
  faviconUrl,
  feedId,
  title,
  className,
}: ArticleThumbnailProps) {
  const [stage, setStage] = useState<Stage>(
    imageUrl ? 'image' : faviconUrl ? 'favicon' : 'placeholder',
  );
  const [loaded, setLoaded] = useState(false);

  const src = stage === 'image' ? imageUrl : stage === 'favicon' ? faviconUrl : null;

  function stepDown() {
    setLoaded(false);
    setStage((current) =>
      current === 'image' && faviconUrl ? 'favicon' : 'placeholder',
    );
  }

  if (!src) {
    const hue = hueFor(feedId);
    return (
      <div
        aria-hidden
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-md text-lg font-semibold text-white/90',
          className,
        )}
        style={{
          background: `linear-gradient(135deg, oklch(0.62 0.13 ${hue}), oklch(0.48 0.11 ${(hue + 40) % 360}))`,
        }}
      >
        {title.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-md bg-muted', className)}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={stepDown}
        className={cn(
          'size-full transition-opacity duration-500 motion-reduce:transition-none',
          stage === 'favicon' ? 'object-contain p-3' : 'object-cover',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
