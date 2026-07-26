import { useEffect, useState } from 'react';

/**
 * A loaded image is "usable" as cover art only if its natural size clears the
 * box's minimum, so it fills the box without upscaling into blur. This is what
 * keeps a 16px feed favicon (or a tiny inline thumbnail) from being blown up.
 */
export function isUsableImageSize(
  naturalWidth: number,
  naturalHeight: number,
  minWidth: number,
  minHeight: number,
): boolean {
  return naturalWidth >= minWidth && naturalHeight >= minHeight;
}

/**
 * Preloads an article image and reports whether it is worth showing: present,
 * loads cleanly, and large enough for its box (see isUsableImageSize). Starts
 * false and only flips true once a big-enough image has loaded, so cards and
 * magazine rows show no image at all rather than an upscaled, blurry one. There
 * is deliberately no favicon or placeholder fallback.
 */
export function useUsableArticleImage(
  imageUrl: string | null,
  minWidth: number,
  minHeight: number,
): boolean {
  const [usable, setUsable] = useState(false);
  useEffect(() => {
    setUsable(false);
    if (!imageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setUsable(isUsableImageSize(img.naturalWidth, img.naturalHeight, minWidth, minHeight));
      }
    };
    img.onerror = () => {
      if (!cancelled) setUsable(false);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl, minWidth, minHeight]);
  return usable;
}
