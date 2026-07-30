import { esc, escMultiline } from './public-html.js';

/** Everything the feed builders need about one shared item (SPEC-019). */
export interface ShareFeedItem {
  articleId: string;
  title: string | null;
  url: string | null;
  summary: string | null;
  note: string | null;
  sharedAt: Date;
  feedTitle: string | null;
  feedSiteUrl: string | null;
}

export interface ShareFeedSource {
  /** Absolute base URL of the instance, no trailing slash. */
  base: string;
  slug: string;
  userId: string;
  displayName: string;
  pageTitle: string;
  items: ShareFeedItem[];
}

/** Entry body: the note (the human voice) first, then a citation line. */
function entryHtml(item: ShareFeedItem): string {
  const note = item.note ? `<p>${escMultiline(item.note)}</p>` : '';
  const summary = !item.note && item.summary ? `<p>${esc(item.summary)}</p>` : '';
  const from = item.feedTitle ? `<p>Shared from ${esc(item.feedTitle)}</p>` : '';
  return `${note}${summary}${from}`;
}

/** Atom 1.0 document of a user's shared items. */
export function buildShareAtom(src: ShareFeedSource): string {
  const pageUrl = `${src.base}/u/${src.slug}`;
  const updated = (src.items[0]?.sharedAt ?? new Date(0)).toISOString();
  const entries = src.items
    .map((item) => {
      const link = item.url ?? item.feedSiteUrl;
      return `  <entry>
    <id>urn:reader:share:${esc(src.userId)}:${esc(item.articleId)}</id>
    <title>${esc(item.title ?? 'Untitled')}</title>
${link ? `    <link rel="alternate" href="${esc(link)}"/>\n` : ''}    <updated>${item.sharedAt.toISOString()}</updated>
    <content type="html">${esc(entryHtml(item))}</content>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(pageUrl)}</id>
  <title>${esc(src.pageTitle)}</title>
  <link rel="alternate" type="text/html" href="${esc(pageUrl)}"/>
  <link rel="self" type="application/atom+xml" href="${esc(pageUrl)}/feed.xml"/>
  <updated>${updated}</updated>
  <author><name>${esc(src.displayName)}</name></author>
${entries}
</feed>
`;
}

/** JSON Feed 1.1 document of a user's shared items. */
export function buildShareJsonFeed(src: ShareFeedSource): string {
  const pageUrl = `${src.base}/u/${src.slug}`;
  return JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: src.pageTitle,
      home_page_url: pageUrl,
      feed_url: `${pageUrl}/feed.json`,
      authors: [{ name: src.displayName }],
      items: src.items.map((item) => ({
        id: item.articleId,
        ...(item.url ? { url: item.url } : {}),
        title: item.title ?? 'Untitled',
        content_text: item.note ?? item.summary ?? '',
        date_published: item.sharedAt.toISOString(),
      })),
    },
    null,
    2,
  );
}
