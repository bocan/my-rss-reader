import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The article image tile for cards/magazine. Render this only when
 * useUsableArticleImage (see ./article-image) has confirmed the image is worth
 * showing (the image is already in cache from that preload, so it fades in
 * immediately). There is deliberately no favicon or placeholder fallback.
 */
export function ArticleThumbnail({ imageUrl, className }: { imageUrl: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cn('overflow-hidden rounded-md bg-muted', className)}>
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          'size-full object-cover transition-opacity duration-500 motion-reduce:transition-none',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
