import sanitizeHtml from 'sanitize-html';

/**
 * Bump this whenever the policy below changes in a way that should force a
 * re-sanitize of already-stored rows. After bumping, run the backfill:
 *   pnpm --filter @rss/api exec tsx src/scripts/resanitize.ts
 */
export const SANITIZER_VERSION = 1;

/** Allow known third-party video embeds (YouTube / Vimeo). */
const ALLOW_EMBEDS = true;

const ALLOWED_IFRAME_HOSTNAMES = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
];

/**
 * Resolve a possibly-relative URL against the article's own URL (falling back
 * to the feed's site URL). Returns an absolute URL string, or null if it can
 * not be parsed (in which case the caller drops the attribute).
 */
function resolveUrl(value: string | undefined, base: string | null): string | null {
  if (!value) return null;
  try {
    return base ? new URL(value, base).href : new URL(value).href;
  } catch {
    return null;
  }
}

/** Merge the required hardening tokens into any existing rel value. */
function hardenRel(existing: string | undefined): string {
  const tokens = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  tokens.add('noopener');
  tokens.add('noreferrer');
  tokens.add('nofollow');
  return [...tokens].join(' ');
}

/**
 * Strip all markup and collapse whitespace, producing plain text for the
 * full-text search column (SPEC-006). Safe on already-sanitized or raw HTML.
 */
export function extractText(html: string): string {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitize untrusted feed HTML for safe storage in articles.contentHtml.
 * @param html    Raw HTML from the feed item.
 * @param baseUrl The article URL (item.link) or feed site URL, for resolving
 *                relative links/images. May be null.
 */
export function sanitizeArticleHtml(html: string, baseUrl: string | null): string {
  return sanitizeHtml(html, {
    allowedTags: [
      // Text + structure
      'p', 'a', 'blockquote', 'cite', 'q',
      'code', 'pre', 'kbd', 'samp', 'var',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup',
      'small', 'mark', 'abbr', 'time', 'span', 'div',
      'hr', 'br', 'wbr',
      // Tables
      'table', 'caption', 'colgroup', 'col',
      'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
      // Media
      'img', 'figure', 'figcaption', 'picture',
      'video', 'audio', 'source', 'track',
      // Embeds (only when ALLOW_EMBEDS; hosts are restricted below)
      ...(ALLOW_EMBEDS ? ['iframe'] : []),
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      video: ['src', 'controls', 'poster', 'width', 'height', 'preload'],
      audio: ['src', 'controls', 'preload'],
      source: ['src', 'type', 'media'],
      track: ['src', 'kind', 'srclang', 'label', 'default'],
      abbr: ['title'],
      time: ['datetime'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      col: ['span'],
      colgroup: ['span'],
      ...(ALLOW_EMBEDS
        ? { iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'title'] }
        : {}),
    },
    // No 'data' scheme: blocks data:text/html and data:image payloads.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      // Media sources must be network URLs, never mailto.
      img: ['http', 'https'],
      video: ['http', 'https'],
      audio: ['http', 'https'],
      source: ['http', 'https'],
      ...(ALLOW_EMBEDS ? { iframe: ['http', 'https'] } : {}),
    },
    allowProtocolRelative: false,
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTNAMES,
    // Default behavior, stated for clarity: disallowed tags are dropped but
    // their text is kept, EXCEPT the default nonTextTags (script, style,
    // textarea, option) whose text content is also discarded. That is what
    // neutralizes <script>alert(1)</script> and <style>...</style> completely.
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        const href = resolveUrl(attribs.href, baseUrl);
        if (href) next.href = href;
        else delete next.href;
        next.target = '_blank';
        next.rel = hardenRel(attribs.rel);
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        const resolved = resolveUrl(attribs.src, baseUrl);
        if (resolved) {
          const u = new URL(resolved);
          if (u.protocol === 'http:') {
            u.protocol = 'https:'; // upgrade http -> https
            next.src = u.href;
          } else if (u.protocol === 'https:') {
            next.src = u.href;
          } else {
            delete next.src; // any other scheme: drop it
          }
        } else {
          delete next.src;
        }
        next.loading = 'lazy';
        next.decoding = 'async';
        return { tagName, attribs: next };
      },
    },
    exclusiveFilter: (frame) =>
      // Drop 1x1 tracking pixels.
      (frame.tag === 'img' && frame.attribs.width === '1' && frame.attribs.height === '1') ||
      // Drop iframe shells whose src was removed (host not allowlisted), so no
      // empty <iframe></iframe> remains in the output.
      (frame.tag === 'iframe' && !frame.attribs.src),
  });
}
