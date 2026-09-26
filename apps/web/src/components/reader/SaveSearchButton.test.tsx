import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SaveSearchButton } from './SaveSearchButton';

// SPEC-025: "Save this search" beside the search box.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const scope = { feedId: null, folderId: 'd1', starred: false, unread: true };
function renderButton(savedAs?: string) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <SaveSearchButton
        query="postgres"
        scope={scope}
        scopeText="in folder Tech, unread only"
        savedAs={savedAs}
      />
    </QueryClientProvider>,
  );
}
const open = () => {
  const trigger = screen.getByRole('button', { name: 'Save this search' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
};

test('the popover names the search after the query and says what scope it keeps', async () => {
  renderButton();
  open();
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('postgres');
  expect(screen.getByText(/in folder Tech, unread only/)).toBeInTheDocument();
});

test('Save sends the name, the query and the captured scope', async () => {
  renderButton();
  open();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: ' Postgres news ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('/api/searches');
  expect(JSON.parse(String(init.body))).toEqual({ name: 'Postgres news', q: 'postgres', ...scope });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull());
});

test('a search that is already saved shows that instead', () => {
  renderButton('PG');
  expect(screen.queryByRole('button', { name: 'Save this search' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Saved as "PG"' })).toBeInTheDocument();
});
