/**
 * Server-rendered public pages (SPEC-019/020): zero-JS, self-contained HTML.
 * Every interpolated value MUST pass through esc(); notes, titles, and feed
 * names are untrusted input.
 */

/** HTML-entity escape for text and attribute contexts (single + double quoted). */
export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Escaped text with newlines rendered as <br>. For share notes. */
export function escMultiline(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>\n');
}

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 42rem;
    font: 1rem/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #fdfdfc; color: #21242b;
  }
  a { color: #2f6fd0; }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 0.25rem; }
  header p { margin: 0.25rem 0 0; color: #6a7180; }
  header { margin-bottom: 2.25rem; }
  article { margin: 0 0 2rem; }
  article .note { margin: 0 0 0.35rem; font-family: Georgia, 'Times New Roman', serif; font-size: 1.05rem; }
  article h2 { font-size: 1rem; margin: 0; font-weight: 600; }
  article .meta { margin: 0.15rem 0 0; font-size: 0.85rem; color: #6a7180; }
  footer { margin-top: 3rem; font-size: 0.85rem; color: #6a7180; }
  @media (prefers-color-scheme: dark) {
    body { background: #14161b; color: #e8ebf1; }
    a { color: #69a8ef; }
    header p, article .meta, footer { color: #98a0ad; }
  }
`;

/** Wrap body content in a complete, self-contained HTML document. */
export function layout(opts: { title: string; head?: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${STYLE}</style>
${opts.head ?? ''}
</head>
<body>
${opts.body}
</body>
</html>
`;
}
