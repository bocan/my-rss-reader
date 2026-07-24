import { beforeEach, describe, expect, test, vi } from 'vitest';

interface RespSpec {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}
const responses = vi.hoisted(() => new Map<string, RespSpec>());

vi.mock('undici', () => ({
  request: vi.fn(async (url: string) => {
    const r = responses.get(url);
    if (!r) throw new Error(`no mock for ${url}`);
    return {
      statusCode: r.statusCode ?? 200,
      headers: r.headers ?? { 'content-type': 'text/html' },
      body: { text: async () => r.body ?? '', dump: async () => {} },
    };
  }),
  Agent: class {
    compose() {
      return this;
    }
  },
  interceptors: { redirect: () => ({}) },
}));

const { extractReadableHtml, stripSeparatorNodes } = await import('./readability.js');

const para = (seed: string) =>
  `${seed} This paragraph contains enough real prose, with several full sentences, for the extractor to treat it as genuine article content rather than boilerplate navigation or chrome. `.repeat(
    3,
  );

const ARTICLE = `<!DOCTYPE html><html><head><title>Test Article</title></head><body>
<header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
<article>
  <h1>The Main Headline</h1>
  <p>${para('First.')}</p>
  <p>${para('Second.')}</p>
  <p>${para('Third.')}</p>
  <script>alert('xss')</script>
</article>
<footer>Copyright 2026</footer>
</body></html>`;

// Empty body: Readability finds no article and parse() returns null.
const BOILERPLATE = `<!DOCTYPE html><html><head><title>x</title></head><body></body></html>`;

beforeEach(() => responses.clear());

describe('extractReadableHtml', () => {
  test('extracts article body and strips scripts', async () => {
    const url = 'https://site.example/post';
    responses.set(url, { headers: { 'content-type': 'text/html; charset=utf-8' }, body: ARTICLE });
    const out = await extractReadableHtml(url);
    expect(out).not.toBeNull();
    expect(out).toContain('First.');
    expect(out).not.toContain('<script');
    expect(out).not.toContain("alert('xss')");
  });

  test('returns null for content-free boilerplate', async () => {
    const url = 'https://site.example/empty';
    responses.set(url, { headers: { 'content-type': 'text/html' }, body: BOILERPLATE });
    expect(await extractReadableHtml(url)).toBeNull();
  });

  test('returns null for a non-HTML content type without parsing', async () => {
    const url = 'https://site.example/data';
    responses.set(url, { headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(await extractReadableHtml(url)).toBeNull();
  });

  test('returns null for an HTTP error status', async () => {
    const url = 'https://site.example/gone';
    responses.set(url, { statusCode: 500, body: '' });
    expect(await extractReadableHtml(url)).toBeNull();
  });

  test('returns null (no throw) when the fetch rejects', async () => {
    expect(await extractReadableHtml('https://unreachable.example/x')).toBeNull();
  });

  test('returns null for a non-http scheme without fetching', async () => {
    expect(await extractReadableHtml('ftp://site.example/file')).toBeNull();
    expect(await extractReadableHtml('not a url')).toBeNull();
  });
});

describe('stripSeparatorNodes', () => {
  test('removes isolated separator elements but keeps pipes inside prose', () => {
    const out = stripSeparatorNodes(
      '<p><span>|</span></p><p>Real content stays.</p><p>A | B in prose stays.</p>',
    );
    expect(out).not.toContain('<span>|</span>');
    expect(out).toContain('Real content stays.');
    expect(out).toContain('A | B in prose stays.');
  });

  test('keeps separator characters that belong to real links or media', () => {
    const out = stripSeparatorNodes('<p><a href="https://x.example">|</a></p>');
    expect(out).toContain('href="https://x.example"');
  });
});
