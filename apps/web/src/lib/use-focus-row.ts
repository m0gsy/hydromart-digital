'use client';

import { useEffect, useRef } from 'react';

import { useQueryParam } from './use-query-param';

/** The DOM id of a row a link can point at with `?id=`. */
export const focusRowId = (id: string): string => `row-${id}`;

/** How the row a notification opened is marked (the caller adds a radius to match the row). */
export const FOCUS_RING = 'ring-2 ring-brand-500';

/**
 * Flow 6a (plan PR-6): the row a notification is about. A push opens its list with `?id=`;
 * the row is scrolled into view the first time it is on screen, once per id, so a reload, a
 * "load more" or an action on another row does not pull the reader back to it. An id the list
 * does not hold (another page, filtered out) leaves the list as it is. Callers put the id in
 * their read's deps: a push tapped while the page is already open names a row the loaded list
 * may not have yet.
 */
export function useFocusRow(): string {
  const id = useQueryParam('id');
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!id || scrolled.current === id) return;
    const row = document.getElementById(focusRowId(id));
    if (!row) return;
    scrolled.current = id;
    row.scrollIntoView?.({ block: 'center' });
  });
  return id;
}
