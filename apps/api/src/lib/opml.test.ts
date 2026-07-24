import { describe, expect, test } from 'vitest';
import { buildOpml, OpmlParseError, parseOpml } from './opml.js';

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>t</title></head><body>${body}</body></opml>`;

describe('parseOpml', () => {
  test('normalizes a single outline (object, not array)', () => {
    const tree = parseOpml(wrap('<outline type="rss" text="One" xmlUrl="https://a.example/f" />'));
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ title: 'One', xmlUrl: 'https://a.example/f' });
  });

  test('normalizes multiple outlines (array)', () => {
    const tree = parseOpml(
      wrap(
        '<outline text="One" xmlUrl="https://a.example/1" />' +
          '<outline text="Two" xmlUrl="https://a.example/2" />',
      ),
    );
    expect(tree.map((o) => o.xmlUrl)).toEqual(['https://a.example/1', 'https://a.example/2']);
  });

  test('discriminates folders from subscriptions by xmlUrl and preserves nesting', () => {
    const tree = parseOpml(
      wrap(
        '<outline text="Tech"><outline text="Inner">' +
          '<outline text="Deep" xmlUrl="https://a.example/deep" />' +
          '</outline><outline text="Flat" xmlUrl="https://a.example/flat" /></outline>',
      ),
    );
    expect(tree).toHaveLength(1);
    const tech = tree[0]!;
    expect(tech.xmlUrl).toBeNull(); // folder
    expect(tech.title).toBe('Tech');
    expect(tech.children.map((c) => c.title)).toEqual(['Inner', 'Flat']);
    expect(tech.children[0]!.children[0]!.xmlUrl).toBe('https://a.example/deep');
  });

  test('falls back from title to text', () => {
    const tree = parseOpml(wrap('<outline title="T" xmlUrl="https://a/1" />'));
    expect(tree[0]!.title).toBe('T');
    const tree2 = parseOpml(wrap('<outline text="X" xmlUrl="https://a/1" />'));
    expect(tree2[0]!.title).toBe('X');
  });

  test('throws a typed error on malformed XML and a wrong root', () => {
    expect(() => parseOpml('<opml><body><outline')).toThrow(OpmlParseError);
    expect(() => parseOpml('<html><body></body></html>')).toThrow(OpmlParseError);
    expect(() => parseOpml('<opml version="2.0"></opml>')).toThrow(OpmlParseError);
  });

  test('rejects external entities outright (no XXE file read)', () => {
    const xxe =
      `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
      `<opml version="2.0"><body><outline text="&xxe;" xmlUrl="https://a/1" /></body></opml>`;
    // fast-xml-parser refuses external entities; the route turns this into a 400.
    expect(() => parseOpml(xxe)).toThrow(OpmlParseError);
    expect(() => parseOpml(xxe)).toThrow(/external entit/i);
  });

  test('does not blow up on a billion-laughs style internal entity payload', () => {
    const lol =
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "haha">` +
      `<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>` +
      `<opml version="2.0"><body><outline text="&lol2;" xmlUrl="https://a/2" /></body></opml>`;
    // Either rejected or parsed without runaway expansion; never a hang.
    try {
      const tree = parseOpml(lol);
      expect((tree[0]?.title ?? '').length).toBeLessThan(1000);
    } catch (err) {
      expect(err).toBeInstanceOf(OpmlParseError);
    }
  });
});

describe('buildOpml', () => {
  test('emits nested folders and feed outlines with the expected attributes', () => {
    const xml = buildOpml({
      folders: [
        {
          title: 'Tech',
          folders: [
            { title: 'Inner', folders: [], feeds: [{ title: 'Deep', xmlUrl: 'https://a/deep' }] },
          ],
          feeds: [{ title: 'Flat', xmlUrl: 'https://a/flat', htmlUrl: 'https://a' }],
        },
      ],
      feeds: [{ title: 'Loose', xmlUrl: 'https://a/loose' }],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('version="2.0"');
    expect(xml).toContain('xmlUrl="https://a/deep"');
    expect(xml).toContain('htmlUrl="https://a"');
    expect(xml).toContain('type="rss"');
    expect(xml).toContain('title="Tech"');
    expect(xml).toContain('title="Loose"');
    // Round-trips through the parser.
    const back = parseOpml(xml);
    expect(back.map((o) => o.title)).toEqual(['Tech', 'Loose']);
  });

  test('escapes characters that would break the XML', () => {
    const xml = buildOpml({
      folders: [],
      feeds: [{ title: 'A & B <hack> "quoted"', xmlUrl: 'https://a/1?x=1&y=2' }],
    });
    expect(xml).not.toMatch(/title="A & B/); // raw ampersand would be invalid
    expect(xml).toContain('&amp;');
    // And it parses back to the original text.
    const back = parseOpml(xml);
    expect(back[0]!.title).toBe('A & B <hack> "quoted"');
    expect(back[0]!.xmlUrl).toBe('https://a/1?x=1&y=2');
  });

  test('omits htmlUrl when absent and emits an empty folder without children', () => {
    const xml = buildOpml({ folders: [{ title: 'Empty', folders: [], feeds: [] }], feeds: [] });
    expect(xml).not.toContain('htmlUrl');
    expect(parseOpml(xml)[0]).toMatchObject({ title: 'Empty', children: [] });
  });
});
