import { eq } from 'drizzle-orm';
import { beforeEach, expect, test, vi } from 'vitest';

// SPEC-024: the one capture path for the Extracted view and for star/share.
const extractMock = vi.hoisted(() => vi.fn<(url: string) => Promise<string | null>>());
vi.mock('./readability.js', () => ({ extractReadableHtml: extractMock }));

const { ensureReadableSnapshot } = await import('./readable-snapshot.js');
const { db } = await import('../db/index.js');
const { articles } = await import('../db/schema.js');
const { resetDb, seedArticle, seedFeed } = await import('../../test/helpers.js');

beforeEach(async () => {
  await resetDb();
  extractMock.mockReset();
});

const stored = async (id: string) =>
  (await db.select().from(articles).where(eq(articles.id, id)))[0]!;

test('captures and stores a snapshot on the first call', async () => {
  const feed = await seedFeed();
  const a = await seedArticle(feed.id, { url: 'https://site.example/p' });
  extractMock.mockResolvedValue('<p>clean</p>');

  const out = await ensureReadableSnapshot(a.id);
  expect(out?.readableHtml).toBe('<p>clean</p>');
  expect(extractMock).toHaveBeenCalledWith('https://site.example/p');
  const row = await stored(a.id);
  expect(row.readableHtml).toBe('<p>clean</p>');
  expect(row.readableFetchedAt).not.toBeNull();
});

test('an attempt already made, good or failed, is not fetched again', async () => {
  const feed = await seedFeed();
  const failed = await seedArticle(feed.id, { url: 'https://site.example/a', readableFetchedAt: new Date() });
  const good = await seedArticle(feed.id, {
    url: 'https://site.example/b',
    readableHtml: '<p>kept</p>',
    readableFetchedAt: new Date(),
  });

  expect((await ensureReadableSnapshot(failed.id))?.readableHtml).toBeNull();
  expect((await ensureReadableSnapshot(good.id))?.readableHtml).toBe('<p>kept</p>');
  expect(extractMock).not.toHaveBeenCalled();
});

test('no source URL: stamps the attempt and fetches nothing', async () => {
  const feed = await seedFeed();
  const a = await seedArticle(feed.id, { url: null });

  const out = await ensureReadableSnapshot(a.id);
  expect(out).toMatchObject({ readableHtml: null });
  expect(out?.readableFetchedAt).toBeInstanceOf(Date);
  expect(extractMock).not.toHaveBeenCalled();
  expect((await stored(a.id)).readableFetchedAt).not.toBeNull();
});

test('a forced retry that fails keeps the stored copy (the archive)', async () => {
  const feed = await seedFeed();
  const a = await seedArticle(feed.id, {
    url: 'https://gone.example/p',
    readableHtml: '<p>taken while alive</p>',
    readableFetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
  extractMock.mockResolvedValue(null); // the page has died

  const out = await ensureReadableSnapshot(a.id, { force: true });
  expect(out?.readableHtml).toBe('<p>taken while alive</p>');
  expect((await stored(a.id)).readableHtml).toBe('<p>taken while alive</p>');
});

test('a forced retry that works replaces the copy', async () => {
  const feed = await seedFeed();
  const a = await seedArticle(feed.id, {
    url: 'https://site.example/p',
    readableHtml: '<p>old</p>',
    readableFetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
  extractMock.mockResolvedValue('<p>new</p>');
  expect((await ensureReadableSnapshot(a.id, { force: true }))?.readableHtml).toBe('<p>new</p>');
});

test('two calls at once share one extraction', async () => {
  const feed = await seedFeed();
  const a = await seedArticle(feed.id, { url: 'https://site.example/p' });
  let release: (v: string) => void = () => {};
  extractMock.mockImplementation(() => new Promise((r) => (release = r)));

  const first = ensureReadableSnapshot(a.id);
  const second = ensureReadableSnapshot(a.id);
  await vi.waitFor(() => expect(extractMock).toHaveBeenCalledTimes(1));
  release('<p>once</p>');
  expect((await first)?.readableHtml).toBe('<p>once</p>');
  expect((await second)?.readableHtml).toBe('<p>once</p>');
  expect(extractMock).toHaveBeenCalledTimes(1);
});

test('an unknown article gives null', async () => {
  expect(await ensureReadableSnapshot('00000000-0000-4000-8000-000000000000')).toBeNull();
});
