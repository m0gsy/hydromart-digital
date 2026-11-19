'use client';

import { useState } from 'react';

import { useAsync } from './use-async';

/**
 * CA-1-16 / CA-1-18 / CA-1-19 / CA-2-27 / CA-2-28 / CA-2-40 — a list that stops at N and
 * says nothing.
 *
 * Eleven console screens read one page of a paginated endpoint and rendered it as if it
 * were the list. The audit found them one at a time, which is the wrong unit: the defect is
 * not "the leave queue asks for 20", it is that a truncated list and a short list render
 * identically, so nobody can tell them apart from the screen. A queue sorted oldest-first
 * (the franchise applications, `hq/applications`) turns that into buried work: past 100
 * applications a new applicant is not late in the list, they are absent from it.
 *
 * `fetchAllPages` is the answer when a screen needs the WHOLE list — a total it is about to
 * compute, or a file it is about to write. This hook is the answer for the other half: a
 * list a human reads, where reading everything up front is the wrong trade. It walks pages
 * on demand and always exposes `total`, so `ListFooter` can state "43 dari 512" rather than
 * letting 43 pass for all of them.
 *
 * The accumulate-and-append shape is taken from `dashboard/inventory`, which had already
 * written it by hand; this is that code with the two traps closed:
 *
 *  - A page in flight must not be rendered twice. `useAsync` keeps the PREVIOUS page's data
 *    while the next one loads, so `[...seen, ...data.items]` briefly appended page 1 to
 *    itself — duplicate rows and duplicate React keys. The response carries the page number
 *    it answered, and rows from a page that is no longer the one being asked for are
 *    ignored.
 *  - Changing the filter must not fetch twice. Resetting the page inside an effect lets the
 *    fetch for the OLD page fire first. The reset happens during render instead (React's
 *    documented adjust-state-on-prop-change), so the request that goes out is page 1 of the
 *    new filter and nothing else.
 */
export interface PagedList<T> {
  /** Every row loaded so far — page 1 through the last one asked for. */
  rows: T[];
  /** What the server says the whole list holds. `rows.length` is a subset of this. */
  total: number;
  /** True while rows exist that nobody on this screen has asked for yet. */
  hasMore: boolean;
  loadMore: () => void;
  loading: boolean;
  error: string | null;
  /** Back to page 1 and re-read — what a screen calls after it writes something. */
  reload: () => void;
}

const idOf = (row: unknown): unknown =>
  row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;

export function usePagedList<T>(
  /** Called with a 1-based page number; must return the server's own `total`. */
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
  deps: unknown[] = [],
): PagedList<T> {
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState<T[]>([]);

  // The filters, as one comparable value. Serialising them is what lets the reset below run
  // during render rather than in an effect — see the note at the top of the file.
  const key = JSON.stringify(deps);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
    setSeen([]);
  }

  const load = useAsync(async () => {
    const answer = await fetchPage(page);
    // Stamped with the page AND the filters it answers, so a stale response cannot be
    // appended as if it were the new one — nor drawn under a filter it was not asked for
    // (useAsync keeps the previous answer while the next one loads).
    return { ...answer, forPage: page, forKey: key };
  }, [key, page]);

  const sameKey = load.data?.forKey === key;
  const answered = sameKey && load.data?.forPage === page;
  // Offset paging over a list that moves: a row written between two page reads pushes the
  // last row of one page onto the next. Seen once is enough — a row is keyed by its `id`.
  // ponytail: a row DELETED between reads still shifts one out of sight; only a cursor fixes that.
  const seenIds = new Set<unknown>(seen.map(idOf).filter((id) => id !== undefined));
  const fresh = answered
    ? (load.data?.items ?? []).filter((r) => page === 1 || !seenIds.has(idOf(r)))
    : [];
  const rows = page === 1 ? fresh : [...seen, ...fresh];
  const total = sameKey ? (load.data?.total ?? rows.length) : rows.length;
  // A later page that came back empty is the end, whatever `total` said before the list moved.
  const exhausted = answered && page > 1 && (load.data?.items.length ?? 0) === 0;

  return {
    rows,
    total,
    hasMore: rows.length < total && !exhausted,
    loadMore: () => {
      // The page asked for did not arrive: ask for it again. Advancing would skip it for good.
      if (load.error) {
        load.reload();
        return;
      }
      setSeen(rows);
      setPage((p) => p + 1);
    },
    loading: load.loading,
    error: load.error,
    reload: () => {
      setSeen([]);
      // On page 1 there is no page change to trigger the read, so ask `useAsync` directly.
      // Past it, dropping back to page 1 is itself the refetch — doing both would send two.
      if (page === 1) load.reload();
      else setPage(1);
    },
  };
}
