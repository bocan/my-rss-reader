import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ArticleThumbnail } from './ArticleThumbnail';

const base = { feedId: 'feed-1', title: 'Hello world' };

test('renders the article image lazily when one exists', () => {
  render(<ArticleThumbnail {...base} imageUrl="https://x.example/a.jpg" faviconUrl={null} />);
  const img = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('https://x.example/a.jpg');
  expect(img.getAttribute('loading')).toBe('lazy');
  expect(img.getAttribute('decoding')).toBe('async');
});

test('uses the feed favicon when there is no article image', () => {
  render(<ArticleThumbnail {...base} imageUrl={null} faviconUrl="https://x.example/i.ico" />);
  const img = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('https://x.example/i.ico');
});

test('falls back down the chain on error, never leaving a broken image', () => {
  const { container } = render(
    <ArticleThumbnail {...base} imageUrl="https://x.example/a.jpg" faviconUrl="https://x.example/i.ico" />,
  );
  // article image fails -> favicon
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('https://x.example/i.ico');
  // favicon fails -> generated placeholder (no <img> at all)
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('H'); // first initial
});

test('renders the placeholder directly when there is nothing to load', () => {
  const { container } = render(<ArticleThumbnail {...base} imageUrl={null} faviconUrl={null} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('H');
});
