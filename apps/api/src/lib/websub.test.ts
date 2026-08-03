import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { discoverWebSubLinks, verifySignature } from './websub.js';

const FEED_URL = 'https://blog.example/feed.xml';

describe('discoverWebSubLinks', () => {
  test('reads rel=hub and rel=self from a Link header', () => {
    const out = discoverWebSubLinks(
      '<https://hub.example/>; rel="hub", <https://blog.example/canonical.xml>; rel="self"',
      '',
      FEED_URL,
    );
    expect(out).toEqual({
      hubUrl: 'https://hub.example/',
      topicUrl: 'https://blog.example/canonical.xml',
    });
  });

  test('handles multi-value headers and unquoted rel', () => {
    const out = discoverWebSubLinks(
      ['<https://hub.example/>; rel=hub', '<https://blog.example/self>; rel=self'],
      '',
      FEED_URL,
    );
    expect(out.hubUrl).toBe('https://hub.example/');
    expect(out.topicUrl).toBe('https://blog.example/self');
  });

  test('reads Atom <link rel="hub">', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>T</title>
      <link rel="hub" href="https://hub.example/"/>
      <link rel="self" href="https://blog.example/atom.xml"/>
    </feed>`;
    expect(discoverWebSubLinks(undefined, xml, FEED_URL)).toEqual({
      hubUrl: 'https://hub.example/',
      topicUrl: 'https://blog.example/atom.xml',
    });
  });

  test('reads RSS <atom:link rel="hub"> and resolves relative hrefs', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel><title>T</title>
        <atom:link rel="hub" href="/hub"/>
        <atom:link rel="self" href="feed.xml"/>
      </channel></rss>`;
    expect(discoverWebSubLinks(undefined, xml, FEED_URL)).toEqual({
      hubUrl: 'https://blog.example/hub',
      topicUrl: 'https://blog.example/feed.xml',
    });
  });

  test('the Link header wins over in-document links', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <link rel="hub" href="https://xml-hub.example/"/>
    </feed>`;
    const out = discoverWebSubLinks('<https://header-hub.example/>; rel="hub"', xml, FEED_URL);
    expect(out.hubUrl).toBe('https://header-hub.example/');
  });

  test('topic falls back to the feed URL when no rel=self exists', () => {
    const out = discoverWebSubLinks('<https://hub.example/>; rel="hub"', '', FEED_URL);
    expect(out.topicUrl).toBe(FEED_URL);
  });

  test('no hub anywhere yields null, and malformed XML never throws', () => {
    expect(discoverWebSubLinks(undefined, 'not xml <<<', FEED_URL)).toEqual({
      hubUrl: null,
      topicUrl: FEED_URL,
    });
  });
});

describe('verifySignature', () => {
  const secret = 's3cret';
  const body = Buffer.from('<rss>payload</rss>', 'utf8');
  const sign = (method: string) => createHmac(method, secret).update(body).digest('hex');

  test('accepts a correct sha256 signature (and sha1, which many hubs send)', () => {
    expect(verifySignature(secret, `sha256=${sign('sha256')}`, body)).toBe(true);
    expect(verifySignature(secret, `sha1=${sign('sha1')}`, body)).toBe(true);
  });

  test('rejects wrong digests, wrong secrets, and tampered bodies', () => {
    expect(verifySignature(secret, `sha256=${'0'.repeat(64)}`, body)).toBe(false);
    expect(verifySignature('other', `sha256=${sign('sha256')}`, body)).toBe(false);
    expect(
      verifySignature(secret, `sha256=${sign('sha256')}`, Buffer.from('tampered', 'utf8')),
    ).toBe(false);
  });

  test('never throws on malformed headers', () => {
    for (const header of [undefined, '', 'sha256=', 'md5=abcd', 'sha256', 'sha256=zzzz', 'sha256=abc']) {
      expect(verifySignature(secret, header, body)).toBe(false);
    }
  });
});
