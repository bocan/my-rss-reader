import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoginPage } from './LoginPage';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<LoginPage />, { wrapper: Wrapper });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage registration adaptation', () => {
  test('login route shows the sign-in form', () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: 'open' }));
    renderAt('/login');
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByLabelText('Email or username')).toBeInTheDocument();
  });

  test('closed mode hides the register form on /register', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: 'closed' }));
    renderAt('/register');
    await waitFor(() =>
      expect(screen.getByText(/Registration is closed/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  test('invite mode without a token asks for an invite link', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: 'invite' }));
    renderAt('/register');
    await waitFor(() =>
      expect(screen.getByText(/need an invite link/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  test('invite mode with a token shows the register form', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: 'invite' }));
    renderAt('/register?invite=abc123');
    // Even before the mode query resolves, the token gates the form open.
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByText(/registering with an invite/i)).toBeInTheDocument();
    // The login/register toggle is suppressed for invite links.
    expect(screen.queryByText(/Have an account\? Sign in/i)).not.toBeInTheDocument();
  });
});
