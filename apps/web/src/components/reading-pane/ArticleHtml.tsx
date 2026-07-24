/**
 * The single component in the client that renders raw article HTML. Its input
 * is ALREADY sanitized server-side (SPEC-001 for contentHtml, SPEC-004's
 * extraction path for readableHtml). It TRUSTS its input and never
 * re-sanitizes. Never wire an un-sanitized HTML source into it.
 */
export function ArticleHtml({ html }: { html: string }) {
  return (
    <div
      className="prose prose-neutral max-w-none dark:prose-invert prose-a:text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
