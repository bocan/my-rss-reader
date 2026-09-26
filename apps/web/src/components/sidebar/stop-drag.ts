import type { SyntheticEvent } from 'react';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Keeps menu presses out of the row's mouse and touch drag sensors. */
export const stopDrag = { onPointerDown: stop, onMouseDown: stop, onTouchStart: stop };
