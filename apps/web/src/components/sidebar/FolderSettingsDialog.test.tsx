import { DEFAULT_SETTINGS } from '@rss/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FolderRow } from '@/lib/folders';
import { FolderSettingsDialog } from './FolderSettingsDialog';

// #48: a folder has settings too: name, parent folder and list view.

const folder = (id: string, name: string, parentId: string | null = null): FolderRow =>
  ({ id, userId: 'u1', name, parentId, position: 0, viewMode: null, createdAt: '' }) as FolderRow;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog(target: FolderRow, all: FolderRow[], onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: all });
  qc.setQueryData(['feeds'], { items: [] });
  qc.setQueryData(['settings'], { ...DEFAULT_SETTINGS, defaultViewMode: 'magazine' });
  render(
    <QueryClientProvider client={qc}>
      <FolderSettingsDialog folder={target} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init.body)) }));

const news = folder('d3', 'News');
const all = [folder('d1', 'Tech'), folder('d2', 'CSS', 'd1'), news];

test('Save sends only what changed', async () => {
  const onOpenChange = renderDialog(news, all);
  fireEvent.change(screen.getByRole('combobox', { name: 'Inside folder' }), { target: { value: 'd1' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'List view' }), { target: { value: 'cards' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(patches()).toEqual([{ url: '/api/folders/d3', body: { parentId: 'd1', viewMode: 'cards' } }]);
});

test('a rename alone sends only the name', async () => {
  const onOpenChange = renderDialog(news, all);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: ' World ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(patches()).toEqual([{ url: '/api/folders/d3', body: { name: 'World' } }]);
});

test('no change sends nothing, and closes', () => {
  const onOpenChange = renderDialog(news, all);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(patches()).toEqual([]);
});

test('parents are top-level folders other than itself, and the view names its default', () => {
  renderDialog(news, all);
  const parent = screen.getByRole('combobox', { name: 'Inside folder' });
  expect([...parent.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['None (top level)', 'Tech']);
  expect(screen.getByRole('combobox', { name: 'List view' })).toHaveDisplayValue('Use default (Magazine)');
});

test('a folder with subfolders cannot move inside another, and says why', () => {
  renderDialog(all[0]!, all);
  expect(screen.getByRole('combobox', { name: 'Inside folder' })).toBeDisabled();
  expect(screen.getByText('A folder with subfolders cannot go inside another folder.')).toBeInTheDocument();
});
