import type { ArticleView, DefaultArticleView } from '@rss/shared';

/** User-facing names. The stored values predate the rename and stay put. */
export const ARTICLE_VIEW_LABELS: Record<DefaultArticleView, string> = {
  auto: 'Automatic',
  readable: 'Feed',
  simplified: 'Extracted',
  web: 'Web',
};

/** Fewer words than this in the feed body reads as a teaser, not an article. */
const MIN_FULL_WORDS = 25;

/** "…", "...", "[…]", "[...]" at the very end: the feed cut the post short. */
const TRAILING_ELLIPSIS = /(?:…|\.\.\.|\[\s*(?:…|\.\.\.)\s*\])\s*$/;
/** A "read more" style link near the end also marks a truncated body. */
const READ_MORE = /\b(?:continue reading|read more|read the (?:full|rest)|keep reading)\b/i;

function plainText(html: string): string {
  // Space after every tag so adjacent blocks ("</p><p>") do not fuse words.
  const doc = new DOMParser().parseFromString(html.replace(/>/g, '> '), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Choose the view for 'auto'. The feed's own content wins whenever it looks
 * like the whole article, since extraction is a guess that often picks the
 * wrong block. Extraction is used only when the feed carries a teaser or
 * nothing, and never when the link is a `#fragment` of a shared page (e.g. a
 * changelog, where every item would extract the same whole page).
 */
export function resolveAutoView(article: {
  url: string | null;
  contentHtml: string | null;
}): ArticleView {
  if (!article.url) return 'readable';
  if (/#./.test(article.url)) return 'readable';
  const text = article.contentHtml ? plainText(article.contentHtml) : '';
  if (!text) return 'simplified';
  if (TRAILING_ELLIPSIS.test(text) || READ_MORE.test(text.slice(-160))) return 'simplified';
  if (text.split(' ').length < MIN_FULL_WORDS) return 'simplified';
  return 'readable';
}
