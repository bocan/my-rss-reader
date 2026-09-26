import type { ReadingSize, ReadingWidth } from '@rss/shared';

export const READING_SIZE_LABELS: Record<ReadingSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export const READING_WIDTH_LABELS: Record<ReadingWidth, string> = {
  narrow: 'Narrow',
  normal: 'Normal',
  wide: 'Wide',
};

// Full class names, so Tailwind finds them in the source.
const PROSE_SIZE: Record<ReadingSize, string> = {
  small: 'prose-sm',
  medium: 'prose-base',
  large: 'prose-lg',
};

// The column carries the same font size as its prose, so `ch` counts the
// characters of the article text: the line length stays the same at every
// text size.
const COLUMN_SIZE: Record<ReadingSize, string> = {
  small: 'text-sm',
  medium: 'text-base',
  large: 'text-lg',
};

const COLUMN_WIDTH: Record<ReadingWidth, string> = {
  narrow: 'max-w-[60ch]',
  normal: 'max-w-[70ch]',
  wide: 'max-w-[90ch]',
};

/** The centered column for the article header and body (#41). */
export function readingColumnClass(size: ReadingSize, width: ReadingWidth): string {
  return `mx-auto w-full ${COLUMN_WIDTH[width]} ${COLUMN_SIZE[size]}`;
}

/** The prose size for the article body. */
export function proseSizeClass(size: ReadingSize): string {
  return PROSE_SIZE[size];
}
