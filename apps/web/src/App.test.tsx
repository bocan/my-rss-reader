import { IsRestoringProvider, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';

// A deep link must survive a cold start: while the persisted cache restores,
// the session is unknown, not "signed out".

vi.mock('@/routes/ReaderPage', () => ({ ReaderPage: () => <p>reader</p> }));
vi.mock('@/routes/LoginPage', () => ({ LoginPage: () => <p>login</p> }));

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

afterEach(() => vi.unstubAllGlobals());

test('no redirect to /login while the cache is still restoring', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IsRestoringProvider value={true}>
        <MemoryRouter initialEntries={['/?article=a1']}>
          <App />
          <Where />
        </MemoryRouter>
      </IsRestoringProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(screen.getByTestId('where')).toHaveTextContent('/?article=a1');
});

test('a known user on a deep link stays on it', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['auth', 'me'], { id: 'u1', role: 'user' });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/?article=a1']}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('reader')).toBeInTheDocument();
  expect(screen.getByTestId('where')).toHaveTextContent('/?article=a1');
});
