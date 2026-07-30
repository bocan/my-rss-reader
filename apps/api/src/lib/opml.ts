import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/** A normalized OPML outline: a folder (no xmlUrl) or a subscription. */
export interface OpmlOutline {
  title: string | null;
  xmlUrl: string | null;
  htmlUrl: string | null;
  children: OpmlOutline[];
}

export class OpmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpmlParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  // fast-xml-parser never resolves external entities or DOCTYPE subsets, so
  // XXE and billion-laughs expansion are not reachable.
  parseAttributeValue: false,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
  processEntities: true,
});

/** fast-xml-parser yields an object for one child and an array for many. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface RawOutline {
  '@_title'?: string;
  '@_text'?: string;
  '@_xmlUrl'?: string;
  '@_htmlUrl'?: string;
  outline?: RawOutline | RawOutline[];
}

function normalize(raw: RawOutline): OpmlOutline {
  const title = raw['@_title'] ?? raw['@_text'] ?? null;
  return {
    title: title === null ? null : String(title),
    xmlUrl: raw['@_xmlUrl'] ? String(raw['@_xmlUrl']) : null,
    htmlUrl: raw['@_htmlUrl'] ? String(raw['@_htmlUrl']) : null,
    children: toArray(raw.outline).map(normalize),
  };
}

/**
 * Parse an OPML document into a normalized outline tree.
 * Throws OpmlParseError on malformed XML or a missing opml/body root; the route
 * maps that to a 400 rather than a 500.
 */
export function parseOpml(xml: string): OpmlOutline[] {
  let doc: { opml?: { body?: { outline?: RawOutline | RawOutline[] } } };
  try {
    doc = parser.parse(xml) as typeof doc;
  } catch (err) {
    throw new OpmlParseError(err instanceof Error ? err.message : 'Could not parse XML');
  }
  if (!doc?.opml) throw new OpmlParseError('Not an OPML document (missing <opml> root)');
  if (!doc.opml.body) throw new OpmlParseError('OPML document has no <body>');
  return toArray(doc.opml.body.outline).map(normalize);
}

export interface OpmlFeedNode {
  title: string;
  xmlUrl: string;
  htmlUrl?: string | null;
  /** Carried for the blogroll HTML page (SPEC-020); ignored by buildOpml. */
  faviconUrl?: string | null;
}
export interface OpmlFolderNode {
  title: string;
  folders: OpmlFolderNode[];
  feeds: OpmlFeedNode[];
}

function feedOutline(feed: OpmlFeedNode) {
  return {
    '@_type': 'rss',
    '@_text': feed.title,
    '@_title': feed.title,
    '@_xmlUrl': feed.xmlUrl,
    ...(feed.htmlUrl ? { '@_htmlUrl': feed.htmlUrl } : {}),
  };
}

function folderOutline(folder: OpmlFolderNode): Record<string, unknown> {
  const children = [...folder.folders.map(folderOutline), ...folder.feeds.map(feedOutline)];
  return {
    '@_text': folder.title,
    '@_title': folder.title,
    ...(children.length > 0 ? { outline: children } : {}),
  };
}

/** Build an OPML 2.0 document. Attribute values are escaped by the builder. */
export function buildOpml(
  tree: { folders: OpmlFolderNode[]; feeds: OpmlFeedNode[] },
  title = 'Reader subscriptions',
): string {
  const body = {
    outline: [...tree.folders.map(folderOutline), ...tree.feeds.map(feedOutline)],
  };
  const xml = builder.build({
    opml: { '@_version': '2.0', head: { title }, body },
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}
