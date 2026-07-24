import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Agent, interceptors, request } from 'undici';
import { sanitizeArticleHtml } from './sanitize.js';

const FETCH_TIMEOUT_MS = 15_000; // matches rss-parser's timeout in poll.ts
// A browser-like UA: bare/library UAs are blocked by some publishers.
const USER_AGENT = 'Mozilla/5.0 (compatible; rss-reader/0.1; +https://github.com/your/rss-reader)';

// undici's request() does not follow redirects on its own (see feed-fetch.ts);
// article URLs frequently redirect, so opt in via the redirect interceptor.
const dispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }));

// Readability's types reference the DOM `Document`, which the API tsconfig does
// not load; borrow the exact constructor parameter type instead of naming it.
type ReadabilityDoc = ConstructorParameters<typeof Readability>[0];

// Characters that, when they are the entire content of a small element, mark it
// as a leftover layout separator (e.g. a byline "date | read-time" whose pipe
// ends up alone). em/en dashes via \u escapes to keep them out of the source.
const SEPARATOR_ONLY = /^[\s|/\\*·•‧∙・\u2014\u2013-]+$/;

/**
 * Remove isolated separator elements (a <p>/<span>/etc. whose whole text is just
 * a separator character and which holds no media or links). Pipes and dashes
 * inside real prose are left untouched because such elements have other text.
 */
interface MinimalElement {
  querySelector(selectors: string): unknown;
  textContent: string | null;
  remove(): void;
}

export function stripSeparatorNodes(html: string): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const elements = document.querySelectorAll('p, div, li, span, h1, h2, h3, h4, h5, h6, td');
  for (const el of Array.from(elements) as MinimalElement[]) {
    if (el.querySelector('img, video, audio, iframe, picture, source, a')) continue;
    const text = (el.textContent ?? '').trim();
    if (text.length > 0 && text.length <= 3 && SEPARATOR_ONLY.test(text)) {
      el.remove();
    }
  }
  return document.body?.innerHTML ?? html;
}

/**
 * Fetch `url`, extract the main article with Readability, and return sanitized
 * HTML, or null on any failure (bad scheme, network, timeout, non-HTML, empty
 * extraction). Never throws for expected failures.
 */
export async function extractReadableHtml(url: string): Promise<string | null> {
  // SSRF scheme guard: only ever fetch http(s). (Blocking private/loopback
  // ranges is a documented follow-up in the spec.)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  try {
    const res = await request(url, {
      method: 'GET',
      dispatcher,
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: FETCH_TIMEOUT_MS,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });

    if (res.statusCode >= 400) {
      await res.body.dump(); // drain to free the socket
      return null;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (!contentType.includes('html')) {
      await res.body.dump();
      return null;
    }

    const html = await res.body.text();
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as ReadabilityDoc).parse();
    if (!article?.content) return null;

    // Drop isolated layout separators Readability leaves behind, then sanitize.
    // linkedom does not track the document's URL, so Readability cannot
    // absolutize relative links itself; the sanitizer resolves them against
    // `url`, matching SPEC-001's ingestion path.
    const clean = sanitizeArticleHtml(stripSeparatorNodes(article.content), url);
    return clean.trim() ? clean : null;
  } catch {
    // Timeouts, DNS/connection errors, malformed HTML: all "no readable
    // version", never a 5xx to the client.
    return null;
  }
}
