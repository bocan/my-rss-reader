import { describe, expect, test } from 'vitest';
import { sanitizeArticleHtml } from './sanitize.js';

const BASE = 'https://blog.example/post/1';

describe('sanitizeArticleHtml - XSS vectors', () => {
  test('strips <script> tag and its text', () => {
    const out = sanitizeArticleHtml('<p>hi</p><script>alert(1)</script>', BASE);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hi');
  });

  test('removes onerror handler from <img>', () => {
    const out = sanitizeArticleHtml('<img src="https://x.example/a.png" onerror="alert(1)">', BASE);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain('a.png');
  });

  test('drops javascript: href (and obfuscated variants)', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'jav\tascript:alert(1)']) {
      const out = sanitizeArticleHtml(`<a href="${href}">click</a>`, BASE);
      expect(out.toLowerCase()).not.toContain('javascript:');
      expect(out).toContain('click');
    }
  });

  test('removes <svg> element wholesale', () => {
    const out = sanitizeArticleHtml('<svg onload="alert(1)"></svg><p>ok</p>', BASE);
    expect(out).not.toContain('<svg');
    expect(out).not.toMatch(/onload/i);
    expect(out).toContain('ok');
  });

  test('strips style attribute and CSS javascript vector', () => {
    const out = sanitizeArticleHtml('<div style="background:url(javascript:alert(1))">x</div>', BASE);
    expect(out).not.toMatch(/\bstyle=/);
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).toContain('x');
  });

  test('strips iframe from a non-allowlisted host', () => {
    const out = sanitizeArticleHtml('<iframe src="https://evil.example.com/"></iframe>', BASE);
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.example.com');
  });

  test('drops data: image src', () => {
    const out = sanitizeArticleHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">', BASE);
    expect(out).not.toContain('data:');
  });

  test('removes 1x1 tracking pixels', () => {
    const out = sanitizeArticleHtml(
      '<p>body</p><img width="1" height="1" src="https://t.example/p">',
      BASE,
    );
    expect(out).not.toContain('<img');
    expect(out).toContain('body');
  });
});

describe('sanitizeArticleHtml - hardening', () => {
  test('anchors get target=_blank and merged rel tokens', () => {
    const out = sanitizeArticleHtml('<a href="https://x.example" rel="author">link</a>', BASE);
    expect(out).toContain('target="_blank"');
    const rel = /rel="([^"]*)"/.exec(out)?.[1] ?? '';
    for (const token of ['author', 'noopener', 'noreferrer', 'nofollow']) {
      expect(rel.split(/\s+/)).toContain(token);
    }
  });

  test('images gain lazy loading and get upgraded to https', () => {
    const out = sanitizeArticleHtml('<img src="http://cdn.example/p.jpg">', BASE);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('https://cdn.example/p.jpg');
    expect(out).not.toContain('http://cdn.example');
  });
});

describe('sanitizeArticleHtml - URL resolution', () => {
  test('resolves relative img and anchor URLs against the base', () => {
    const out = sanitizeArticleHtml('<img src="/media/x.png"><a href="../about">a</a>', BASE);
    expect(out).toContain('https://blog.example/media/x.png');
    expect(out).toContain('https://blog.example/about');
  });

  test('drops relative URLs when there is no base', () => {
    const out = sanitizeArticleHtml('<img src="/media/x.png"><a href="/about">a</a>', null);
    expect(out).not.toContain('/media/x.png');
    expect(out).not.toContain('href="/about"');
  });
});

describe('sanitizeArticleHtml - embeds and benign content', () => {
  test('retains an allowlisted YouTube embed, strips arbitrary hosts', () => {
    const yt = sanitizeArticleHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>', BASE);
    expect(yt).toContain('<iframe');
    expect(yt).toContain('youtube.com/embed/abc');

    const other = sanitizeArticleHtml('<iframe src="https://vids.example/x"></iframe>', BASE);
    expect(other).not.toContain('<iframe');
  });

  test('preserves realistic benign content', () => {
    const input = [
      '<h2>Title</h2>',
      '<p>First paragraph with <strong>bold</strong>.</p>',
      '<p>Second paragraph.</p>',
      '<ul><li>one</li><li>two</li></ul>',
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>',
      '<pre><code>const x = 1;</code></pre>',
      '<blockquote>quote</blockquote>',
      '<img src="https://cdn.example/pic.jpg" alt="pic">',
      '<a href="https://example.com">home</a>',
    ].join('');
    const out = sanitizeArticleHtml(input, BASE);
    for (const tag of ['<h2', '<p', '<ul', '<li', '<table', '<thead', '<tbody', '<pre', '<code', '<blockquote', '<img', '<a']) {
      expect(out).toContain(tag);
    }
    for (const text of ['Title', 'First paragraph', 'bold', 'one', 'two', 'const x = 1;', 'quote']) {
      expect(out).toContain(text);
    }
    expect(out).toContain('alt="pic"');
  });

  test('does not throw on malformed HTML', () => {
    expect(() => sanitizeArticleHtml('<p>unclosed <b>bold <  stray', BASE)).not.toThrow();
    expect(typeof sanitizeArticleHtml('<p>unclosed', BASE)).toBe('string');
  });
});
