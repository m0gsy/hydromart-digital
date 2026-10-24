'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

export interface InsightData<T> {
  data: T | null;
  loading: boolean;
  /** The server refused this widget (403): the caller hides it rather than showing an error. */
  forbidden: boolean;
  /** Any other failure, as a sentence. */
  error: string | null;
  reload: () => void;
}

/**
 * One dashboard widget's request.
 *
 * Unlike `useAsync` it tells a REFUSAL from a failure. A role can hold a tab through one
 * capability and be refused a widget on it through another, or by a per-depot override the
 * client cannot see; that is "not for you", and putting a red error box on a dashboard for it
 * would report a permission as an outage. A widget that is not wanted yet (`enabled` false:
 * no single depot chosen, say) makes no request at all.
 *
 * A reply that arrives after its inputs changed is dropped: the caller changing the window
 * mid-flight must never end up looking at the previous window's numbers.
 */
export function useInsightData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
): InsightData<T> {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    forbidden: boolean;
    error: string | null;
  }>({ data: null, loading: enabled, forbidden: false, error: null });
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, forbidden: false, error: null });
      return undefined;
    }
    let alive = true;
    // The previous answer is dropped, not kept on screen: it belongs to inputs that are gone, and
    // showing it as current is how a figure for one window ends up beside another's base.
    setState({ data: null, loading: true, forbidden: false, error: null });
    run()
      .then((data) => alive && setState({ data, loading: false, forbidden: false, error: null }))
      .catch((e: unknown) => {
        if (!alive) return;
        const refused = e instanceof ApiError && e.status === 403;
        setState({
          data: null,
          loading: false,
          forbidden: refused,
          error: refused ? null : e instanceof ApiError ? e.message : 'Something went wrong.',
        });
      });
    return () => {
      alive = false;
    };
  }, [run, nonce, enabled]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
