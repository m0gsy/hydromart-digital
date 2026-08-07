'use client';

import { useEffect, useState } from 'react';

/**
 * A value that only settles once typing stops.
 *
 * Feed it into a `useAsync` dependency list instead of the raw input state: wired straight
 * to `onChange`, a search box fires one authenticated request per keystroke, which the
 * browser baseline (F-12) records as "per debounced keystroke", not per keystroke.
 *
 * 300ms is the interval `/hq/search` already inlines; this is the same behaviour with one
 * place to change it.
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}
