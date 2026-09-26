import { beforeEach, describe, expect, test, vi } from 'vitest';

// Shared mock response table, hoisted so the vi.mock factory can reference it.
interface RespSpec {
  statusCode?: number;
  headers?: Record<string, string | string[]>;
  body?: string;
}
const responses = vi.hoisted(() => new Map<string, RespSpec>());

vi.mock('undici', () => ({
  request: vi.fn(async (url: string) => {
    const r = responses.get(url);
    if (!r) throw new Error(`no mock for ${url}`);
    return {
      statusCode: r.statusCode ?? 200,
      headers: r.headers ?? {},
      body: { text: async () => r.body ?? '' },
    };
  }),
  // Stubs so the module-level composed dispatcher constructs without a network.
  Agent: class {
    compose() {
      return this;
    }
  },
  interceptors: { redirect: () => ({}) },
}));

// Import after the mock is registered.
const {
  discoverFeedCandidates,
  extractEnclosure,
  fetchAndParseFeed,
  feedArticleRows,
  normalizeFeedUrl,
  resolveFavicon,
  socialFeedProbes,
} = await import('./feed-fetch.js');
const { request } = await import('undici');

const RSS = (title = 'My Feed') =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>` +
  `<link>https://site.example</link><item><title>One</title>` +
  `<link>https://site.example/1</link></item></channel></rss>`;

function html(body: string): RespSpec {
  return { headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

beforeEach(() => responses.clear());

describe('discoverFeedCandidates', () => {
  test('returns a single candidate for a direct feed URL', async () => {
    const url = 'https://site.example/feed.xml';
    responses.set(url, { headers: { 'content-type': 'application/rss+xml' }, body: RSS('Direct') });
    const out = await discoverFeedCandidates(url);
    expect(out).toEqual([{ feedUrl: url, title: 'Direct' }]);
  });

  test('extracts multiple <link rel="alternate"> candidates from a homepage', async () => {
    const url = 'https://blog.example/';
    responses.set(
      url,
      html(
        '<html><head>' +
          '<link rel="alternate" type="application/rss+xml" href="/rss.xml" title="RSS" />' +
          '<link rel="alternate" type="application/atom+xml" href="https://blog.example/atom" title="Atom" />' +
          '</head><body>hi</body></html>',
      ),
    );
    const out = await discoverFeedCandidates(url);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.feedUrl)).toEqual([
      'https://blog.example/rss.xml',
      'https://blog.example/atom',
    ]);
    expect(out.map((c) => c.title)).toEqual(['RSS', 'Atom']);
  });

  test('resolves a single homepage link candidate to an absolute URL', async () => {
    const url = 'https://blog.example/';
    responses.set(
      url,
      html('<link rel="alternate" type="application/rss+xml" href="/feed" title="Feed" />'),
    );
    const out = await discoverFeedCandidates(url);
    expect(out).toEqual([{ feedUrl: 'https://blog.example/feed', title: 'Feed' }]);
  });

  test('falls back to probing common paths when no link tags exist', async () => {
    const url = 'https://nolinks.example/';
    responses.set(url, html('<html><head></head><body>no feeds here</body></html>'));
    responses.set('https://nolinks.example/feed', {
      headers: { 'content-type': 'application/rss+xml' },
      body: RSS('Probed'),
    });
    const out = await discoverFeedCandidates(url);
    expect(out).toEqual([{ feedUrl: 'https://nolinks.example/feed', title: 'Probed' }]);
  });

  test('returns empty when nothing is discoverable', async () => {
    const url = 'https://empty.example/';
    responses.set(url, html('<html><head></head><body>nothing</body></html>'));
    const out = await discoverFeedCandidates(url);
    expect(out).toEqual([]);
  });

  test('returns empty for an unreachable host (no throw)', async () => {
    const out = await discoverFeedCandidates('https://down.example/');
    expect(out).toEqual([]);
  });
});

// SPEC-023: social profiles are feeds too.
describe('socialFeedProbes', () => {
  test.each([
    ['https://bsky.app/profile/somebody.bsky.social', 'https://bsky.app/profile/somebody.bsky.social/rss'],
    ['https://bsky.app/profile/somebody.bsky.social/', 'https://bsky.app/profile/somebody.bsky.social/rss'],
    [
      'https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur',
      'https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/rss',
    ],
    ['https://hachyderm.io/@someone', 'https://hachyderm.io/@someone.rss'],
    ['https://hachyderm.io/@someone/', 'https://hachyderm.io/@someone.rss'],
    ['https://Social.Example.ORG/@Some_One', 'https://social.example.org/@Some_One.rss'],
    // Medium serves its own feed path; its profile page is 403 to non-browsers.
    ['https://medium.com/@writer', 'https://medium.com/feed/@writer'],
    ['https://www.medium.com/@writer/', 'https://medium.com/feed/@writer'],
  ])('%s -> %s', (input, probe) => {
    expect(socialFeedProbes(input)).toEqual([probe]);
  });

  test.each([
    'https://hachyderm.io/@someone/posts',
    'https://hachyderm.io/@someone@mastodon.social',
    'https://bsky.app/profile/x/feed',
    'https://bsky.app/profile/x/post/abc',
    'https://bsky.app/',
    'https://medium.com/some-publication',
    'https://blog.example/',
    'https://blog.example/about',
    'ftp://host/@user',
    'not a url',
    '',
  ])('no probe for %s', (input) => {
    expect(socialFeedProbes(input)).toEqual([]);
  });
});

describe('discoverFeedCandidates with social profiles', () => {
  const requested = () => vi.mocked(request).mock.calls.map(([u]) => String(u));
  // A block body: a function returned from beforeEach runs as a teardown.
  beforeEach(() => {
    vi.mocked(request).mockClear();
  });

  test('a Bluesky profile discovers exactly its /rss feed', async () => {
    const feed = 'https://bsky.app/profile/somebody.bsky.social/rss';
    responses.set(feed, { headers: { 'content-type': 'application/rss+xml' }, body: RSS('@somebody.bsky.social') });
    const out = await discoverFeedCandidates('https://bsky.app/profile/somebody.bsky.social');
    expect(out).toEqual([{ feedUrl: feed, title: '@somebody.bsky.social' }]);
  });

  test('a Mastodon profile discovers <profile>.rss with one request, and never fetches the HTML', async () => {
    responses.set('https://hachyderm.io/@someone.rss', { body: RSS('Someone') });
    responses.set('https://hachyderm.io/@someone', html('<html>big profile page</html>'));
    const out = await discoverFeedCandidates('https://hachyderm.io/@someone');
    expect(out).toEqual([{ feedUrl: 'https://hachyderm.io/@someone.rss', title: 'Someone' }]);
    expect(requested()).toEqual(['https://hachyderm.io/@someone.rss']);
  });

  test('a /@user URL whose .rss 404s falls back to generic discovery', async () => {
    responses.set('https://writing.example/@writer.rss', { statusCode: 404, body: 'Not found' });
    responses.set(
      'https://writing.example/@writer',
      html('<link rel="alternate" type="application/rss+xml" title="RSS" href="https://writing.example/feed/@writer">'),
    );
    const out = await discoverFeedCandidates('https://writing.example/@writer');
    expect(out).toEqual([{ feedUrl: 'https://writing.example/feed/@writer', title: 'RSS' }]);
  });

  test('a Medium profile finds medium.com/feed/@user, without the 403 profile page', async () => {
    responses.set('https://medium.com/feed/@writer', { body: RSS('Stories by Writer on Medium') });
    responses.set('https://medium.com/@writer', { statusCode: 403, body: '<html>blocked</html>' });
    const out = await discoverFeedCandidates('https://medium.com/@writer');
    expect(out).toEqual([
      { feedUrl: 'https://medium.com/feed/@writer', title: 'Stories by Writer on Medium' },
    ]);
    expect(requested()).toEqual(['https://medium.com/feed/@writer']);
  });

  test('a probe that answers with HTML, not a feed, also falls back', async () => {
    responses.set('https://misskey.example/@user.rss', html('<html>app shell</html>'));
    responses.set(
      'https://misskey.example/@user',
      html('<link rel="alternate" type="application/atom+xml" href="/@user.atom">'),
    );
    const out = await discoverFeedCandidates('https://misskey.example/@user');
    expect(out).toEqual([{ feedUrl: 'https://misskey.example/@user.atom', title: null }]);
  });

  test('a YouTube channel page resolves through its <link rel="alternate"> (regression pin)', async () => {
    const page = 'https://www.youtube.com/@SomeChannel';
    // The probe is tried first (the path is /@handle) and misses.
    responses.set('https://www.youtube.com/@SomeChannel.rss', { statusCode: 404 });
    responses.set(
      page,
      html(
        '<html><head><link rel="alternate" type="application/rss+xml" title="RSS" ' +
          'href="https://www.youtube.com/feeds/videos.xml?channel_id=UC123"></head></html>',
      ),
    );
    const out = await discoverFeedCandidates(page);
    expect(out).toEqual([
      { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123', title: 'RSS' },
    ]);
  });

  test('a YouTube /channel/ URL makes no probe at all', async () => {
    const page = 'https://www.youtube.com/channel/UC123';
    responses.set(
      page,
      html('<link rel="alternate" type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC123">'),
    );
    await discoverFeedCandidates(page);
    expect(requested()[0]).toBe(page);
  });
});

describe('feedArticleRows text coercion', () => {
  // rss-parser returns objects for xhtml/html Atom fields; those must never
  // reach a text column (they broke the whole insert -> feeds imported empty).
  test('flattens xhtml/object titles and Atom author objects to strings', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [
        {
          id: 'g1',
          link: 'https://ex.com/1',
          title: { $: { type: 'xhtml' }, div: [{ _: 'Hello World', $: {} }] },
          isoDate: '2026-01-01T00:00:00.000Z',
        },
        // A title-less note (empty xhtml div, attributes only) -> null title.
        { id: 'g2', link: 'https://ex.com/2', title: { $: { type: 'xhtml' }, div: [{ $: { class: 'x' } }] } },
        // Atom <author> object -> its name.
        { id: 'g3', link: 'https://ex.com/3', title: 'plain', author: { name: 'Jane', email: 'j@x.com' } },
      ],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    const rows = feedArticleRows('feed-1', parsed);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.title).toBe('Hello World');
    expect(rows[1]!.title).toBeNull();
    expect(rows[2]!.author).toBe('Jane');
    // Nothing bound to a text column is ever a non-string object.
    for (const r of rows) {
      for (const v of [r.title, r.author, r.guid, r.url, r.summary, r.contentHtml]) {
        expect(v === null || typeof v === 'string').toBe(true);
      }
    }
  });

  // An Atom <summary type="html"> with no <content> (simonwillison.net) comes
  // back from rss-parser as raw markup and no contentSnippet.
  test('stores an HTML Atom summary as plain, decoded text', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [
        {
          id: 'g1',
          link: 'https://ex.com/1',
          title: 't',
          summary:
            '<p><a href="https://x.example">Tom &amp; Jerry</a> said hi.</p><h4>Next</h4>' +
            '<pre><span class="pl-k">from</span> x</pre><script>bad()</script>',
        },
      ],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    expect(feedArticleRows('feed-1', parsed)[0]!.summary).toBe('Tom & Jerry said hi. Next from x');
  });

  // #47: with no body, that HTML summary is the body, sanitized.
  test('uses an HTML summary as the sanitized body when there is no content', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [
        {
          id: 'g1',
          link: 'https://ex.com/1',
          title: 't',
          summary: '<p><a href="/tom">Tom</a> said <em>hi</em>.</p><script>bad()</script>',
        },
      ],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    const row = feedArticleRows('feed-1', parsed)[0]!;
    expect(row.contentHtml).toContain('<em>hi</em>');
    expect(row.contentHtml).toContain('href="https://ex.com/tom"');
    expect(row.contentHtml).not.toContain('script');
    // The card text stays plain.
    expect(row.summary).toBe('Tom said hi.');
  });

  test('a real body wins over an HTML summary', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [{ id: 'g1', link: 'https://ex.com/1', title: 't', content: '<p>Body</p>', summary: '<p>Teaser</p>' }],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    expect(feedArticleRows('feed-1', parsed)[0]!.contentHtml).toBe('<p>Body</p>');
  });

  test('a plain-text summary does not become a body', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [{ id: 'g1', link: 'https://ex.com/1', title: 't', contentSnippet: 'Just text.', summary: 'Just text.' }],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    const row = feedArticleRows('feed-1', parsed)[0]!;
    expect(row.contentHtml).toBeNull();
    expect(row.summary).toBe('Just text.');
  });

  test('keeps a plain-text contentSnippet as is, even with a stray "<"', () => {
    const parsed = {
      link: 'https://ex.com',
      items: [{ id: 'g1', link: 'https://ex.com/1', title: 't', contentSnippet: 'use <div> when 5 < 6' }],
    } as unknown as Parameters<typeof feedArticleRows>[1];

    expect(feedArticleRows('feed-1', parsed)[0]!.summary).toBe('use <div> when 5 < 6');
  });
});

describe('normalizeFeedUrl', () => {
  test('strips a trailing slash from a path (the day2cloud duplicate)', () => {
    expect(normalizeFeedUrl('https://feeds.packetpushers.net/day2cloud/')).toBe(
      'https://feeds.packetpushers.net/day2cloud',
    );
    expect(normalizeFeedUrl('https://feeds.packetpushers.net/day2cloud')).toBe(
      'https://feeds.packetpushers.net/day2cloud',
    );
  });

  test('collapses root-URL variants to one form', () => {
    expect(normalizeFeedUrl('https://example.com')).toBe(normalizeFeedUrl('https://example.com/'));
  });

  test('lowercases the host, drops fragments and default ports, keeps the query', () => {
    expect(normalizeFeedUrl('https://Example.COM:443/Feed?a=1#frag')).toBe(
      'https://example.com/Feed?a=1',
    );
    expect(normalizeFeedUrl('https://www.youtube.com/feeds/videos.xml?channel_id=UC1')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC1',
    );
  });

  test('does not upgrade http to https or touch unparseable input', () => {
    expect(normalizeFeedUrl('http://example.com/feed/')).toBe('http://example.com/feed');
    expect(normalizeFeedUrl('  not a url  ')).toBe('not a url');
    expect(normalizeFeedUrl('ftp://example.com/feed/')).toBe('ftp://example.com/feed/');
  });
});

describe('extractEnclosure', () => {
  const base = 'https://pod.example/ep1';

  test('keeps a declared audio enclosure and lowercases its type', () => {
    const out = extractEnclosure(
      { enclosure: { url: 'https://cdn.example/ep1.mp3', type: 'Audio/MPEG' } },
      base,
    );
    expect(out).toEqual({ url: 'https://cdn.example/ep1.mp3', type: 'audio/mpeg' });
  });

  test('keeps a video enclosure and resolves a relative URL against the item', () => {
    const out = extractEnclosure({ enclosure: { url: '/media/ep1.mp4', type: 'video/mp4' } }, base);
    expect(out).toEqual({ url: 'https://pod.example/media/ep1.mp4', type: 'video/mp4' });
  });

  test('rejects image enclosures (those feed the thumbnail picker instead)', () => {
    expect(
      extractEnclosure({ enclosure: { url: 'https://x.example/a.jpg', type: 'image/jpeg' } }, base),
    ).toBeNull();
  });

  test('rejects missing/undeclared types and non-http schemes', () => {
    expect(extractEnclosure({ enclosure: { url: 'https://x.example/a.mp3' } }, base)).toBeNull();
    expect(
      extractEnclosure({ enclosure: { url: 'ftp://x.example/a.mp3', type: 'audio/mpeg' } }, base),
    ).toBeNull();
    expect(extractEnclosure({}, base)).toBeNull();
  });

  test('flows into feedArticleRows rows', () => {
    const parsed = {
      link: 'https://pod.example',
      items: [
        {
          id: 'ep1',
          link: 'https://pod.example/ep1',
          title: 'Episode 1',
          enclosure: { url: 'https://cdn.example/ep1.mp3', type: 'audio/mpeg' },
        },
        { id: 'post', link: 'https://pod.example/post', title: 'Plain post' },
      ],
    } as unknown as Parameters<typeof feedArticleRows>[1];
    const rows = feedArticleRows('feed-1', parsed);
    expect(rows[0]!.enclosureUrl).toBe('https://cdn.example/ep1.mp3');
    expect(rows[0]!.enclosureType).toBe('audio/mpeg');
    expect(rows[1]!.enclosureUrl).toBeNull();
    expect(rows[1]!.enclosureType).toBeNull();
  });
});

describe('resolveFavicon', () => {
  test('resolves a relative <link rel="icon"> against the site URL', () => {
    const out = resolveFavicon(
      'https://site.example/blog',
      '<link rel="icon" href="/favicon-32.png">',
    );
    expect(out).toBe('https://site.example/favicon-32.png');
  });

  test('keeps an absolute icon href', () => {
    const out = resolveFavicon(
      'https://site.example',
      '<link rel="shortcut icon" href="https://cdn.example/i.ico">',
    );
    expect(out).toBe('https://cdn.example/i.ico');
  });

  test('uses apple-touch-icon when no plain icon link is present', () => {
    const out = resolveFavicon(
      'https://site.example',
      '<link rel="apple-touch-icon" href="/touch.png">',
    );
    expect(out).toBe('https://site.example/touch.png');
  });

  test('falls back to /favicon.ico when no link tag matches', () => {
    expect(resolveFavicon('https://site.example/x', '<html><head></head></html>')).toBe(
      'https://site.example/favicon.ico',
    );
    expect(resolveFavicon('https://site.example')).toBe('https://site.example/favicon.ico');
  });
});

describe('fetchAndParseFeed', () => {
  test('reports not-modified on a 304 response', async () => {
    const url = 'https://site.example/feed';
    responses.set(url, { statusCode: 304 });
    const result = await fetchAndParseFeed(url, { etag: 'abc' });
    expect(result).toEqual({ status: 'not-modified' });
  });

  test('parses a 200 feed and returns caching headers', async () => {
    const url = 'https://site.example/feed';
    responses.set(url, {
      headers: { 'content-type': 'application/rss+xml', etag: 'W/"1"', 'last-modified': 'Mon' },
      body: RSS('Ok Feed'),
    });
    const result = await fetchAndParseFeed(url);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.parsed.title).toBe('Ok Feed');
      expect(result.etag).toBe('W/"1"');
      expect(result.lastModified).toBe('Mon');
    }
  });

  test('throws on an HTTP error status', async () => {
    const url = 'https://site.example/feed';
    responses.set(url, { statusCode: 500 });
    await expect(fetchAndParseFeed(url)).rejects.toThrow('HTTP 500');
  });
});
