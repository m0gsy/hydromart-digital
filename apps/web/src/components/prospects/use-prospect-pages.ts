'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import type { ProspectPage } from '@/lib/types';

/**
 * A uuid-cursor list read page by page ("Muat lagi"). `url(cursor)` is rebuilt whenever the
 * filters change (pass them in `deps`); a change starts over from the first page. Unlike
 * `useAsync` it keeps the HTTP status, because a 403 here means "your capability was removed
 * mid-session" and has its own screen, not a retry button. `null` url = do not load.
 */
export function useProspectPages<T>(url: ((cursor?: string) => string) | null, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    const build = urlRef.current;
    if (!build) {
      setItems([]);
      setNext(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setMoreError(null);
    api
      .get<ProspectPage<T>>(build(), true)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNext(page.nextCursor);
      })
      .catch((e) => {
        if (!alive) return;
        setItems([]);
        setNext(null);
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const more = useCallback(async () => {
    const build = urlRef.current;
    if (!build || !next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.get<ProspectPage<T>>(build(next), true);
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextCursor);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [next]);

  return {
    items,
    loading,
    loadingMore,
    error,
    status: error instanceof ApiError ? error.status : null,
    moreError,
    hasMore: next !== null,
    more,
    reload: () => setNonce((n) => n + 1),
  };
}
