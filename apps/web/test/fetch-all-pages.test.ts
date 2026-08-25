/**
 * K3.5 — the shared root, not one screen.
 *
 * `{ limit: 100 }` sat on six product screens. The plan's own causal chain is why patching
 * the till alone could not work: past 100 active products an operator can no longer SEE an
 * older product in the inventory new-line form, so they can never open its stock row — and
 * the till derives its catalogue from stock rows, so the product can never be sold, however
 * well the till is fixed.
 *
 * The behaviour these pin is the one that made `{ limit: 100 }` survive so long: a truncated
 * list looks exactly like a short list. So the ceiling here THROWS, and the tests say so.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_ITEMS, PAGE_SIZE, TooManyPagesError, fetchAllPages } from '@/lib/fetch-all-pages';

/** A server that holds `total` rows and answers honest pages. */
function server(total: number) {
  const calls: Array<{ page: number; limit: number }> = [];
  const fetchPage = vi.fn(async ({ page, limit }: { page: number; limit: number }) => {
    calls.push({ page, limit });
    const start = (page - 1) * limit;
    return {
      items: Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({
        id: `p${start + i}`,
      })),
      total,
      page,
      limit,
    };
  });
  return { fetchPage, calls };
}

describe('fetchAllPages', () => {
  it('returns every row, not the first page', async () => {
    const { fetchPage, calls } = server(450);
    const rows = await fetchAllPages<{ id: string }>(fetchPage);

    expect(rows).toHaveLength(450);
    expect(rows[0]?.id).toBe('p0');
    expect(rows[449]?.id).toBe('p449');
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it('costs exactly one request when everything fits', async () => {
    // The common case has to stay as cheap as it was, or this trades one bug for a
    // slower screen on every depot with a small catalogue.
    const { fetchPage } = server(12);
    expect(await fetchAllPages(fetchPage)).toHaveLength(12);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('asks for one page when the total is an exact multiple, not one empty extra', async () => {
    const { fetchPage, calls } = server(PAGE_SIZE * 2);
    await fetchAllPages(fetchPage);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  it('handles an empty list without asking twice', async () => {
    const { fetchPage } = server(0);
    expect(await fetchAllPages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('REFUSES past the ceiling instead of returning part of the answer', async () => {
    // The whole point. Silently returning 5,000 of 9,000 rows is the defect this file
    // replaces, dressed in a bigger number.
    const { fetchPage } = server(MAX_ITEMS + 1);
    await expect(fetchAllPages(fetchPage)).rejects.toBeInstanceOf(TooManyPagesError);
    // And it refuses on the FIRST page's total, without walking the whole list first.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('cannot be made to loop by a server that undercounts its own total', async () => {
    // Worth pinning because it is the property, not a guard: the page count is computed from
    // the FIRST response's total, so however many rows later pages hand back, the walk is
    // bounded before it starts. There is no "ask until a short page arrives" to run away.
    const fetchPage = vi.fn(async ({ page, limit }: { page: number; limit: number }) => ({
      items: Array.from({ length: limit }, (_, i) => ({ id: `p${page}-${i}` })),
      total: 10, // a lie: every page is full
      page,
      limit,
    }));
    await fetchAllPages(fetchPage, { pageSize: 5 });
    expect(fetchPage).toHaveBeenCalledTimes(2); // ceil(10/5), and not one more
  });

  it('refuses when pages hand back more rows than the total promised', async () => {
    // The one way the total can still be outrun: a page that over-delivers. Stopping is
    // right; stopping SILENTLY is what this file exists to prevent, so it throws.
    const fetchPage = vi.fn(async ({ page, limit }: { page: number; limit: number }) => ({
      items: Array.from({ length: limit * 4 }, (_, i) => ({ id: `p${page}-${i}` })),
      total: MAX_ITEMS,
      page,
      limit,
    }));
    await expect(fetchAllPages(fetchPage, { pageSize: 2000 })).rejects.toBeInstanceOf(
      TooManyPagesError,
    );
  });

  it('names the size in the message, because the reader has to decide what to do next', async () => {
    const { fetchPage } = server(7000);
    await expect(fetchAllPages(fetchPage)).rejects.toThrow(/7000/);
  });
});
