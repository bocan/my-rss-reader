import { act, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { notify } from '@/lib/notify';
import { Toaster } from './sonner';

test('notify shows a visible toast with its action button', async () => {
  render(<Toaster />);
  act(() => {
    notify.error('Could not unsubscribe.', { action: { label: 'Retry', onClick: () => {} } });
  });
  expect(await screen.findByText('Could not unsubscribe.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
