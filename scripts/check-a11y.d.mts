/**
 * Types for `check-a11y.mjs`, so `apps/web/test/keyboard-and-names.test.tsx` can import the
 * SAME walk CI runs instead of a copy of it that could drift away from the gate.
 */
export interface A11yFinding {
  rule: 'filePicker' | 'clickableRow' | 'errorLiveRegion' | 'controlName';
  file: string;
  line: number;
  why: string;
}

/** Every finding under `apps/web/src`. Empty is the only passing answer. */
export function scan(): A11yFinding[];

/** The same four rules over one snippet — what proves the gate can go red. */
export function scanSource(text: string): A11yFinding[];

/** Comment bodies blanked to spaces, offsets preserved. Exported for its own test. */
export function blankComments(src: string): string;

/** The attribute text of the JSX tag opening at `start`, `=>` in handlers and all. */
export function tagAttrs(src: string, start: number): string;
