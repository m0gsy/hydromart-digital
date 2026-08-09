'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from './api';
import { onResume } from './app-lifecycle';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * How long the app has to have been away before coming back counts as a reason to ask
 * the server again.
 *
 * A backgrounded Android app is frozen: no timers, no events, and the delivery list on
 * screen is exactly as old as the time since the courier last looked at it. A minute is
 * short enough that "I switched to the camera and came back" refetches, and long enough
 * that a browser tab being clicked between on a desktop does not turn every alt-tab into
 * a round of requests across every hook on the page.
 */
const STALE_AFTER_MS = 60_000;

/** Run an async loader on mount (and on `deps` change), tracking the full cycle. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((result) => alive && setData(result))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [run, nonce]);

  // Every screen in the app reads through this hook, so coming back to a stale one is
  // fixed here rather than per-page. Deliberately not a poll: the cost is one round of
  // requests when the person actually returns, and nothing at all while they are away.
  useEffect(
    () => onResume((awayMs) => awayMs >= STALE_AFTER_MS && setNonce((n) => n + 1)),
    [],
  );

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}
