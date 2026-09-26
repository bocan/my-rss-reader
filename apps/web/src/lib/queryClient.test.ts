import { beforeEach, expect, test, vi } from 'vitest';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ApiRequestError } = await import('./api');
const { onMutationError, queryClient } = await import('./queryClient');

beforeEach(() => vi.clearAllMocks());

test('a failed mutation toasts its meta errorMessage', () => {
  onMutationError(new Error('boom'), { errorMessage: 'Could not unsubscribe.' });
  expect(toast.error).toHaveBeenCalledWith('Could not unsubscribe.', {});
});

test('inlineError mutations do not toast (the form shows it)', () => {
  onMutationError(new Error('boom'), { inlineError: true });
  expect(toast.error).not.toHaveBeenCalled();
});

test('with no meta, the server message is used, else a generic one', () => {
  onMutationError(new ApiRequestError(400, { error: 'x', message: 'Name taken', statusCode: 400 }), undefined);
  expect(toast.error).toHaveBeenLastCalledWith('Name taken', {});

  onMutationError(new Error('boom'), undefined);
  expect(toast.error).toHaveBeenLastCalledWith('Something went wrong.', {});
});

test('a dropped connection says so', () => {
  onMutationError(new TypeError('Failed to fetch'), undefined);
  expect(toast.error).toHaveBeenLastCalledWith(
    'Something went wrong. Check your connection.',
    {},
  );
});

test('a 401 says the session ended, whatever the meta', () => {
  onMutationError(new ApiRequestError(401, null), { errorMessage: 'Could not save.' });
  expect(toast.error).toHaveBeenCalledWith('Your session has ended. Sign in again.', {});
});

// Wiring: the app's QueryClient routes every mutation failure through it.
test('the app query client toasts any failed mutation', async () => {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: () => Promise.reject(new Error('boom')),
    meta: { errorMessage: 'Could not create the folder.' },
  });
  await mutation.execute(undefined).catch(() => {});
  expect(toast.error).toHaveBeenCalledWith('Could not create the folder.', {});
});
