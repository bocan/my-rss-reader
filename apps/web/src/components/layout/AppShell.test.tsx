import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AppShell } from './AppShell';

// #22: phones get one "More actions" menu in place of a crowded header.

afterEach(() => vi.unstubAllGlobals());

function renderShell(phoneMenu?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['auth', 'me'], { id: 'u1', displayName: 'Chris' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => null }));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppShell phoneMenu={phoneMenu}>content</AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('with phone items, a phone-only menu holds them, then settings and sign out', () => {
  const onMark = vi.fn();
  renderShell(<DropdownMenuItem onSelect={onMark}>Mark all read</DropdownMenuItem>);

  const trigger = screen.getByRole('button', { name: 'More actions' });
  expect(trigger).toHaveClass('sm:hidden');
  fireEvent.keyDown(trigger, { key: 'Enter' });

  const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
  expect(items[0]).toBe('Mark all read');
  expect(items.slice(1)).toEqual(['Theme and settings', 'Sign out']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mark all read' }));
  expect(onMark).toHaveBeenCalled();
});

test('without phone items (Settings, Admin), the header is unchanged', () => {
  renderShell();
  expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  // Theme and Sign out stay in the bar at every width.
  expect(screen.getByRole('button', { name: 'Sign out' }).closest('.hidden')).toBeNull();
});
