import { describe, expect, test } from 'vitest';
import { resolveTheme, THEME_IDS, THEMES } from './types.js';

describe('theme registry', () => {
  test('every theme id has a registry entry with a valid mode', () => {
    for (const id of THEME_IDS) {
      const info = THEMES.find((t) => t.id === id);
      expect(info, id).toBeDefined();
      expect(info!.mode === 'light' || info!.mode === 'dark').toBe(true);
    }
  });

  test('there is at least one light and one dark theme', () => {
    expect(THEMES.some((t) => t.mode === 'light')).toBe(true);
    expect(THEMES.some((t) => t.mode === 'dark')).toBe(true);
  });
});

describe('resolveTheme', () => {
  test('auto maps to the default light/dark by OS preference', () => {
    expect(resolveTheme('auto', false).id).toBe('daylight');
    expect(resolveTheme('auto', true).id).toBe('midnight');
  });

  test('a named theme resolves to itself with its own mode', () => {
    expect(resolveTheme('ember', false)).toMatchObject({ id: 'ember', mode: 'dark' });
    expect(resolveTheme('paper', true)).toMatchObject({ id: 'paper', mode: 'light' });
  });
});
