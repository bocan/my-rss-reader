import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ImportOpmlDialog } from './OpmlImport';

// #35: OPML import from the sidebar "+" and the first-run panel.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ feedsAdded: 2, foldersCreated: 1, skipped: 0, failed: [] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <ImportOpmlDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const pick = (file: File) =>
  fireEvent.change(screen.getByTestId('opml-file'), { target: { files: [file] } });

test('the dialog imports the picked file and reports the result', async () => {
  const { invalidate } = renderDialog();
  expect(screen.getByRole('dialog', { name: 'Import subscriptions' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose OPML file' })).toHaveFocus();

  pick(new File(['<opml/>'], 'feeds.opml', { type: 'text/xml' }));

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added 2 feeds in 1 new folder'));
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toContain('/opml/import');
  expect(JSON.parse(init.body)).toEqual({ opml: '<opml/>' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['feeds'] });
});

test('a file over 5 MB is refused before upload', async () => {
  renderDialog();
  const big = new File(['x'], 'big.opml');
  Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
  pick(big);
  expect(await screen.findByText(/the limit is 5 MB/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
