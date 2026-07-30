import { describe, expect, test } from 'vitest';
import { esc, escMultiline, layout } from './public-html.js';

describe('esc', () => {
  test('escapes every HTML-significant character', () => {
    expect(esc(`<script>alert("x&y")</script>'`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;',
    );
  });

  test('leaves plain text alone', () => {
    expect(esc('plain text, no entities')).toBe('plain text, no entities');
  });
});

describe('escMultiline', () => {
  test('escapes first, then renders newlines as <br>', () => {
    expect(escMultiline('a<b\nc & d')).toBe('a&lt;b<br>\nc &amp; d');
    expect(escMultiline('crlf\r\nline')).toBe('crlf<br>\nline');
  });
});

describe('layout', () => {
  test('escapes the title and produces a complete document', () => {
    const html = layout({ title: '<Evil> & Co', body: '<p>hello</p>' });
    expect(html).toContain('<title>&lt;Evil&gt; &amp; Co</title>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<p>hello</p>');
    expect(html).toContain('prefers-color-scheme: dark');
  });
});
