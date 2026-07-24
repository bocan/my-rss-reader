import { describe, expect, test } from 'vitest';
import { isEditableTarget, resolveShortcut, SHORTCUTS, startsChord } from './registry';

describe('isEditableTarget', () => {
  const el = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild!;
  };

  test('flags inputs, textareas and selects', () => {
    expect(isEditableTarget(el('<input />'))).toBe(true);
    expect(isEditableTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(el('<select></select>'))).toBe(true);
  });

  test('flags contenteditable, including nested nodes', () => {
    expect(isEditableTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    const nested = el('<div contenteditable="true"><span>x</span></div>').querySelector('span')!;
    expect(isEditableTarget(nested)).toBe(true);
  });

  test('does not flag ordinary elements or null', () => {
    expect(isEditableTarget(el('<div></div>'))).toBe(false);
    expect(isEditableTarget(el('<button></button>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('resolveShortcut', () => {
  test('resolves list-context keys only in the list context', () => {
    expect(resolveShortcut('j', 'list')?.label).toBe('Next article');
    expect(resolveShortcut('j', 'reader')).toBeUndefined();
  });

  test('Escape is global so it dismisses on lg+, where context stays list', () => {
    expect(resolveShortcut('Escape', 'reader')?.label).toContain('Close reader');
    expect(resolveShortcut('Escape', 'list')?.label).toContain('Close reader');
  });

  test('global keys resolve in both contexts', () => {
    for (const ctx of ['list', 'reader'] as const) {
      expect(resolveShortcut('s', ctx)?.label).toBe('Toggle star');
      expect(resolveShortcut('?', ctx)?.label).toContain('shortcuts');
    }
  });

  test('is case-sensitive so ? and / stay distinct', () => {
    expect(resolveShortcut('/', 'list')?.label).toBe('Focus search');
    expect(resolveShortcut('?', 'list')?.label).not.toBe('Focus search');
    expect(resolveShortcut('J', 'list')).toBeUndefined(); // shift+j is not j
  });

  test('unmapped keys resolve to nothing', () => {
    expect(resolveShortcut('z', 'list')).toBeUndefined();
  });

  test('chords only resolve with a matching pending prefix', () => {
    expect(startsChord('g', 'list')).toBe(true);
    expect(startsChord('x', 'list')).toBe(false);
    expect(resolveShortcut('g', 'list', 'g')?.label).toBe('Jump to top');
    expect(resolveShortcut('x', 'list', 'g')).toBeUndefined();
    // A bare `g` is not itself an action.
    expect(resolveShortcut('g', 'list')).toBeUndefined();
  });
});

describe('registry integrity', () => {
  test('every entry has a label, group and a trigger', () => {
    for (const s of SHORTCUTS) {
      expect(s.label).toBeTruthy();
      expect(s.group).toBeTruthy();
      expect(s.keys.length > 0 || s.chord).toBeTruthy();
    }
  });
});
