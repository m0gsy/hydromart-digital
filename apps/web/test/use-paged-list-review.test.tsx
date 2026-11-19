// @vitest-environment jsdom
/**
 * Flow plan PR-8a review · three faults every usePagedList screen shared (~25 of them).
 *
 * - A later page that failed was SKIPPED: "Muat lagi" advanced past it, so its rows never
 *   appeared and the count never reached the total.
 * - On a filter change, the previous filter's first page was drawn under the new filter until
 *   the answer landed (useAsync keeps the old answer while the next one loads).
 * - Offset paging over a list that moves showed a row twice when one was written between two
 *   page reads.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePagedList } from '@/lib/use-paged-list';

type Row = { id: string };
const rows = (from: number, n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r-${from + i}` }));

describe('usePagedList', () => {
  it('a failed later page is asked for again, not skipped', async () => {
    const asked: number[] = [];
    let failPage2 = true;
    const fetchPage = vi.fn(async (page: number) => {
      asked.push(page);
      if (page === 2 && failPage2) throw new Error('500');
      return { items: rows((page - 1) * 2, 2), total: 6 };
    });
    const { result } = renderHook(() => usePagedList<Row>(fetchPage, []));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // The rows already loaded stay, and there is still more to read.
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);

    failPage2 = false;
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(asked).toEqual([1, 2, 2]);
    expect(result.current.rows.map((r) => r.id)).toEqual(['r-0', 'r-1', 'r-2', 'r-3']);
  });

  it("a filter change does not draw the old filter's rows under the new one", async () => {
    let resolveB: (v: { items: Row[]; total: number }) => void = () => {};
    const fetchPage = vi.fn((page: number, filter?: string) =>
      filter === 'B'
        ? new Promise<{ items: Row[]; total: number }>((r) => (resolveB = r))
        : Promise.resolve({ items: rows(0, 2), total: 2 }),
    );
    const { result, rerender } = renderHook(
      ({ f }: { f: string }) => usePagedList<Row>((p) => fetchPage(p, f), [f]),
      {
        initialProps: { f: 'A' },
      },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    rerender({ f: 'B' });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(1, 'B'));
    expect(result.current.rows).toEqual([]);

    await act(async () => resolveB({ items: [{ id: 'b-0' }], total: 1 }));
    expect(result.current.rows).toEqual([{ id: 'b-0' }]);
  });

  it('a row pushed onto the next page by a new one is shown once', async () => {
    // Page 1 = r-0, r-1. A row is written before page 2 is read: page 2 starts at r-1 again.
    const fetchPage = vi.fn(async (page: number) =>
      page === 1
        ? { items: rows(0, 2), total: 5 }
        : { items: [{ id: 'r-1' }, { id: 'r-2' }], total: 5 },
    );
    const { result } = renderHook(() => usePagedList<Row>(fetchPage, []));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.rows.map((r) => r.id)).toEqual(['r-0', 'r-1', 'r-2']);
  });

  it('a later page that comes back empty is the end, whatever the total said', async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 1 ? { items: rows(0, 2), total: 3 } : { items: [], total: 3 },
    );
    const { result } = renderHook(() => usePagedList<Row>(fetchPage, []));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(2));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
  });
});
