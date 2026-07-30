import { describe, expect, test } from 'vitest';
import { assembleFeedTree, type TreeFolderRow, type TreeSubRow } from './opml-tree.js';

const folder = (id: string, name: string, parentId: string | null = null): TreeFolderRow => ({
  id,
  name,
  parentId,
});

const sub = (feedUrl: string, folderId: string | null, extra: Partial<TreeSubRow> = {}): TreeSubRow => ({
  folderId,
  customTitle: null,
  title: `Feed ${feedUrl}`,
  feedUrl,
  siteUrl: null,
  faviconUrl: null,
  ...extra,
});

describe('assembleFeedTree', () => {
  test('nests one level and keeps root feeds at the top level', () => {
    const tree = assembleFeedTree(
      [folder('f1', 'Tech'), folder('f2', 'Deep', 'f1')],
      [sub('https://a.example/rss', 'f1'), sub('https://b.example/rss', 'f2'), sub('https://c.example/rss', null)],
    );
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]!.title).toBe('Tech');
    expect(tree.folders[0]!.feeds.map((f) => f.xmlUrl)).toEqual(['https://a.example/rss']);
    expect(tree.folders[0]!.folders[0]!.title).toBe('Deep');
    expect(tree.folders[0]!.folders[0]!.feeds.map((f) => f.xmlUrl)).toEqual(['https://b.example/rss']);
    expect(tree.feeds.map((f) => f.xmlUrl)).toEqual(['https://c.example/rss']);
  });

  test('prefers the custom title and falls back title -> feedUrl', () => {
    const tree = assembleFeedTree(
      [],
      [
        sub('https://a.example/rss', null, { customTitle: 'My Name' }),
        sub('https://b.example/rss', null, { title: null }),
      ],
    );
    expect(tree.feeds.map((f) => f.title)).toEqual(['My Name', 'https://b.example/rss']);
  });

  test('pruneEmptyFolders drops empty folders, including empty-chain parents', () => {
    const rows = [
      folder('keep', 'Keep'),
      folder('empty', 'Empty'),
      folder('parent', 'Parent'),
      folder('child', 'Child', 'parent'), // both empty: whole chain goes
    ];
    const subs = [sub('https://a.example/rss', 'keep')];

    const pruned = assembleFeedTree(rows, subs, { pruneEmptyFolders: true });
    expect(pruned.folders.map((f) => f.title)).toEqual(['Keep']);

    // Without the flag (authenticated export), empty folders survive.
    const full = assembleFeedTree(rows, subs);
    expect(full.folders.map((f) => f.title)).toEqual(['Keep', 'Empty', 'Parent']);
  });

  test('a parent kept alive only by a non-empty child keeps that child', () => {
    const tree = assembleFeedTree(
      [folder('parent', 'Parent'), folder('child', 'Child', 'parent')],
      [sub('https://a.example/rss', 'child')],
      { pruneEmptyFolders: true },
    );
    expect(tree.folders.map((f) => f.title)).toEqual(['Parent']);
    expect(tree.folders[0]!.folders.map((f) => f.title)).toEqual(['Child']);
  });

  test('carries favicons through for the blogroll page', () => {
    const tree = assembleFeedTree(
      [],
      [sub('https://a.example/rss', null, { faviconUrl: 'https://a.example/icon.png' })],
    );
    expect(tree.feeds[0]!.faviconUrl).toBe('https://a.example/icon.png');
  });
});
