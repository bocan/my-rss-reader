import { describe, expect, test } from 'vitest';
import { buildShareAtom, buildShareJsonFeed, type ShareFeedSource } from './share-feeds.js';

const hostileTitle = `<script>alert("boom")</script> & "quotes"`;
const src: ShareFeedSource = {
  base: 'https://reader.example',
  slug: 'chris',
  userId: 'user-1',
  displayName: 'Chris <admin>',
  pageTitle: `Chris's shared items`,
  items: [
    {
      articleId: 'a1',
      title: hostileTitle,
      url: 'https://blog.example/post?a=1&b=2',
      summary: null,
      note: 'Line one\nLine <two> & done',
      sharedAt: new Date('2026-07-30T12:00:00Z'),
      feedTitle: 'Some & Blog',
      feedSiteUrl: 'https://blog.example',
    },
    {
      articleId: 'a2',
      title: null,
      url: null,
      summary: 'Just a summary',
      note: null,
      sharedAt: new Date('2026-07-29T12:00:00Z'),
      feedTitle: null,
      feedSiteUrl: null,
    },
  ],
};

describe('buildShareAtom', () => {
  const xml = buildShareAtom(src);

  test('contains no raw markup from untrusted strings', () => {
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;'); // the escaped title
    // The note's markup is escaped into HTML, then that HTML is escaped into
    // XML for <content type="html">: double-escaped on the wire.
    expect(xml).toContain('&amp;lt;two&amp;gt;');
  });

  test('has feed-level metadata and stable entry ids', () => {
    expect(xml).toContain('<id>https://reader.example/u/chris</id>');
    expect(xml).toContain('rel="self" type="application/atom+xml" href="https://reader.example/u/chris/feed.xml"');
    expect(xml).toContain('<id>urn:reader:share:user-1:a1</id>');
    expect(xml).toContain('<updated>2026-07-30T12:00:00.000Z</updated>');
  });

  test('falls back: untitled entries and linkless entries degrade gracefully', () => {
    expect(xml).toContain('<title>Untitled</title>');
    // a2 has no url and no siteUrl: no alternate link inside that entry.
    const a2 = xml.slice(xml.indexOf('urn:reader:share:user-1:a2'));
    expect(a2).not.toContain('rel="alternate"');
  });

  test('escapes ampersands in URLs', () => {
    expect(xml).toContain('https://blog.example/post?a=1&amp;b=2');
  });
});

describe('buildShareJsonFeed', () => {
  const parsed = JSON.parse(buildShareJsonFeed(src)) as {
    version: string;
    title: string;
    home_page_url: string;
    feed_url: string;
    items: { id: string; url?: string; title: string; content_text: string; date_published: string }[];
  };

  test('is valid JSON Feed 1.1 with intact (unescaped) strings', () => {
    expect(parsed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(parsed.home_page_url).toBe('https://reader.example/u/chris');
    expect(parsed.feed_url).toBe('https://reader.example/u/chris/feed.json');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]!.title).toBe(hostileTitle); // JSON needs no HTML escaping
    expect(parsed.items[0]!.content_text).toBe('Line one\nLine <two> & done');
  });

  test('note wins over summary for content_text; summary is the fallback', () => {
    expect(parsed.items[1]!.content_text).toBe('Just a summary');
    expect(parsed.items[1]!.title).toBe('Untitled');
    expect(parsed.items[1]!.url).toBeUndefined();
  });
});
