import type { ReadingSize } from '@rss/shared';
import { proseSizeClass } from '@/lib/reading-format';
import { cn } from '@/lib/utils';

/**
 * The single component in the client that renders raw article HTML. Its input
 * is ALREADY sanitized server-side (SPEC-001 for contentHtml, SPEC-004's
 * extraction path for readableHtml). It TRUSTS its input and never
 * re-sanitizes. Never wire an un-sanitized HTML source into it.
 *
 * It fills its column; the reading pane sets the column width (#41).
 */
export function ArticleHtml({ html, size = 'medium' }: { html: string; size?: ReadingSize }) {
  return (
    <div
      className={cn(
        'prose prose-neutral max-w-none dark:prose-invert prose-a:text-primary',
        proseSizeClass(size),
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
