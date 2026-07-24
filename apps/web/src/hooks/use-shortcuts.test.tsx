import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useShortcuts } from './use-shortcuts';
import type { ShortcutActions, ShortcutContextName } from '@/lib/shortcuts/registry';

function makeActions(): ShortcutActions {
  return {
    selectNext: vi.fn(),
    selectPrev: vi.fn(),
    openFocused: vi.fn(),
    closeReader: vi.fn(),
    toggleRead: vi.fn(),
    markUnread: vi.fn(),
    toggleStar: vi.fn(),
    markAllRead: vi.fn(),
    refresh: vi.fn(),
    focusSearch: vi.fn(),
    nextFeed: vi.fn(),
    prevFeed: vi.fn(),
    gotoTop: vi.fn(),
    toggleOverlay: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

function Harness({ ctx, actions }: { ctx: ShortcutContextName; actions: ShortcutActions }) {
  useShortcuts(ctx, actions);
  return <input data-testid="field" />;
}

function press(key: string, target?: Element) {
  act(() => {
    (target ?? document).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

let actions: ShortcutActions;

beforeEach(() => {
  vi.useFakeTimers();
  actions = makeActions();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useShortcuts dispatch', () => {
  test('fires the action for a context-matching key', () => {
    render(<Harness ctx="list" actions={actions} />);
    press('j');
    expect(actions.selectNext).toHaveBeenCalledTimes(1);
  });

  test('does not fire a list key while the reader is open', () => {
    render(<Harness ctx="reader" actions={actions} />);
    press('j');
    expect(actions.selectNext).not.toHaveBeenCalled();
  });

  test('never fires while typing in a field', () => {
    const { getByTestId } = render(<Harness ctx="list" actions={actions} />);
    press('j', getByTestId('field'));
    expect(actions.selectNext).not.toHaveBeenCalled();
  });

  test('Escape still reaches the handler from inside a field', () => {
    const { getByTestId } = render(<Harness ctx="reader" actions={actions} />);
    press('Escape', getByTestId('field'));
    expect(actions.closeReader).toHaveBeenCalledTimes(1);
  });

  test('ignores keys combined with browser/OS modifiers', () => {
    render(<Harness ctx="list" actions={actions} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true }));
    });
    expect(actions.refresh).not.toHaveBeenCalled();
  });
});

describe('chord state machine', () => {
  test('g then g jumps to top', () => {
    render(<Harness ctx="list" actions={actions} />);
    press('g');
    press('g');
    expect(actions.gotoTop).toHaveBeenCalledTimes(1);
  });

  test('g then an unmapped key does nothing and clears', () => {
    render(<Harness ctx="list" actions={actions} />);
    press('g');
    press('x');
    expect(actions.gotoTop).not.toHaveBeenCalled();
    // state cleared: a following bare `j` works normally
    press('j');
    expect(actions.selectNext).toHaveBeenCalledTimes(1);
  });

  test('g then a pause clears the pending chord', () => {
    render(<Harness ctx="list" actions={actions} />);
    press('g');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    press('g'); // starts a fresh pending chord, does not fire
    expect(actions.gotoTop).not.toHaveBeenCalled();
    press('g'); // completes it
    expect(actions.gotoTop).toHaveBeenCalledTimes(1);
  });
});
