import type { Query } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { shouldDehydrateQuery } from './persister';

const q = (key: readonly unknown[]) => ({ queryKey: key }) as unknown as Query;

describe('shouldDehydrateQuery', () => {
  test('persists the whitelisted content queries', () => {
    expect(shouldDehydrateQuery(q(['articles', { feedId: 'x' }]))).toBe(true);
    expect(shouldDehydrateQuery(q(['article', 'id-1']))).toBe(true);
    expect(shouldDehydrateQuery(q(['article', 'id-1', 'readable']))).toBe(true);
    expect(shouldDehydrateQuery(q(['feeds']))).toBe(true);
    expect(shouldDehydrateQuery(q(['counts']))).toBe(true);
  });

  test('never persists the session or search results', () => {
    expect(shouldDehydrateQuery(q(['auth', 'me']))).toBe(false);
    expect(shouldDehydrateQuery(q(['search', 'query']))).toBe(false);
    expect(shouldDehydrateQuery(q(['settings']))).toBe(false);
    expect(shouldDehydrateQuery(q(['admin', 'users']))).toBe(false);
  });
});
