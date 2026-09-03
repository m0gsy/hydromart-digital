'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Read one value out of the URL's query string, without `useSearchParams()`.
 *
 * Every route in this app is a client component that fetches its own data, so a
 * dynamic segment bought us nothing but a build that cannot be exported: an Android
 * binary ships its pages as files, and `/orders/[id]` has no file. Those segments are
 * now `?id=` instead, and this is what reads them.
 *
 * `useSearchParams()` would be the obvious hook, and it is the reason it can't be used:
 * Next requires a `<Suspense>` boundary around it during static generation, and putting
 * that boundary anywhere high enough to cover 22 pages makes every exported HTML file
 * render as the fallback — the static shell of the whole app thrown away to satisfy one
 * build rule. Reading `window.location` instead is the escape hatch this repo already
 * reached for once, in `hq/depots/page.tsx`.
 *
 * `useSyncExternalStore` rather than a bare read during render, because the query string
 * is external mutable state: the subscription catches the back button (which Next's
 * router does not re-render for), and `getSnapshot` re-runs on the re-render Next DOES
 * do for a push, so both directions land.
 *
 * The client snapshot is deliberately passed as the SERVER snapshot too. React would
 * otherwise hydrate with the empty server value and only then correct itself — one extra
 * render, during which `useAsync` has already fired a request for an empty id. Every
 * caller renders a skeleton until its data arrives, so nothing id-dependent is in the
 * first paint and there is no hydration mismatch to trade for that.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
}

function read(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

export function useQueryParam(name: string): string {
  const snapshot = useCallback(() => read(name), [name]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The same value, but writable — a filter that survives the back button.
 *
 * CA-1-35: filters held in `useState` are gone the moment the reader opens a row and comes
 * back. On a list somebody is working THROUGH — three hundred employees, filtered to one
 * department — that is the whole task re-done after every single record they open.
 *
 * `replaceState`, not `pushState`: a filter is not a place. Pushing one would mean Back
 * walked backwards through every keystroke of a search box instead of leaving the list.
 * Because the current entry carries the filters, navigating away and back returns to the
 * list as it was.
 *
 * The synthetic `popstate` is what tells `useQueryParam` above to re-read: it subscribes to
 * that event, and a programmatic `replaceState` does not fire one on its own.
 */
export function useQueryState(name: string): [string, (next: string) => void] {
  const value = useQueryParam(name);
  const set = useCallback(
    (next: string) => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set(name, next);
      else url.searchParams.delete(name);
      window.history.replaceState(window.history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [name],
  );
  return [value, set];
}
