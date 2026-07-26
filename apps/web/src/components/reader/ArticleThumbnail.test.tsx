import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ArticleThumbnail } from './ArticleThumbnail';
import { isUsableImageSize } from './article-image';

test('renders the article image lazily', () => {
  render(<ArticleThumbnail imageUrl="https://x.example/a.jpg" />);
  const img = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('https://x.example/a.jpg');
  expect(img.getAttribute('loading')).toBe('lazy');
  expect(img.getAttribute('decoding')).toBe('async');
});

test('isUsableImageSize accepts images that fill the box without upscaling', () => {
  expect(isUsableImageSize(800, 600, 320, 180)).toBe(true);
  expect(isUsableImageSize(320, 180, 320, 180)).toBe(true); // exact boundary
});

test('isUsableImageSize rejects icons and images too small for the box', () => {
  expect(isUsableImageSize(16, 16, 320, 180)).toBe(false); // feed favicon
  expect(isUsableImageSize(64, 64, 320, 180)).toBe(false); // small icon
  expect(isUsableImageSize(300, 180, 320, 180)).toBe(false); // too narrow
  expect(isUsableImageSize(320, 120, 320, 180)).toBe(false); // too short
});
