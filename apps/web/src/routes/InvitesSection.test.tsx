import type { InviteDto } from '@rss/shared';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { onMutationError } from '@/lib/queryClient';
import { InvitesSection } from './AdminPage';

// #50: the invite link is always visible, and admin errors are never silent.

const invite: InviteDto = {
  id: 'i1',
  token: 'tok',
  email: null,
  role: 'user',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  redeemedAt: null,
  redeemedByUserId: null,
  createdAt: new Date().toISOString(),
  link: '/register?invite=tok',
};
const url = `${window.location.origin}/register?invite=tok`;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

function renderInvites() {
  // The app's own error rule (lib/queryClient.ts), on a fresh client.
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: (e, _v, _c, m) => onMutationError(e, m.options.meta) }),
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  qc.setQueryData(['admin', 'invites'], [invite]);
  render(
    <QueryClientProvider client={qc}>
      <Toaster />
      <InvitesSection />
    </QueryClientProvider>,
  );
}

test('the link shows in a read-only field', () => {
  renderInvites();
  const field = screen.getByRole('textbox', { name: 'Invite link' });
  expect(field).toHaveValue(url);
  expect(field).toHaveAttribute('readonly');
});

test('with no clipboard (plain HTTP), Copy selects the link and says how to copy it', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
  renderInvites();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  const field = screen.getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement;
  expect(await screen.findByRole('status')).toHaveTextContent('press Ctrl+C');
  expect(field).toHaveFocus();
  expect(field.selectionEnd! - field.selectionStart!).toBe(url.length);
});

test('with a clipboard, Copy copies the link', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  renderInvites();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(url);
});

test('a failed revoke shows an error toast', async () => {
  fetchMock.mockImplementation(
    async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) as Response,
  );
  renderInvites();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke invite' }));
  expect(await screen.findByText('Could not revoke the invite.')).toBeInTheDocument();
});
