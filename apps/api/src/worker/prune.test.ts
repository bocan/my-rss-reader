import { expect, test, vi } from 'vitest';
import { PRUNE_EVERY_MS, pruneScheduler } from './prune.js';

// SPEC-024: the prune runs at most once per 24 h in one worker process.

const DAY = PRUNE_EVERY_MS;

test('runs on the first tick, then not again until a day has passed', async () => {
  const prune = vi.fn(async () => 3);
  const maybe = pruneScheduler(prune);

  expect(await maybe(0)).toBe(3);
  expect(await maybe(60_000)).toBeNull();
  expect(await maybe(DAY - 1)).toBeNull();
  expect(await maybe(DAY)).toBe(3);
  expect(prune).toHaveBeenCalledTimes(2);
});

test('a failed run still waits a full day', async () => {
  const prune = vi.fn(async () => {
    throw new Error('db down');
  });
  const maybe = pruneScheduler(prune);

  await expect(maybe(0)).rejects.toThrow('db down');
  expect(await maybe(1000)).toBeNull();
  expect(prune).toHaveBeenCalledTimes(1);
});
