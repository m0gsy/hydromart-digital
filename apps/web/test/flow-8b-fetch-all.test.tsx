// @vitest-environment jsdom
/**
 * Flow plan PR-8b · screens that COUNT or DRAW a whole list read the whole list.
 *
 * The tracking board polls every 15 s and acts on each card (pull back, cancel), so its 51st
 * in-flight delivery could not be seen or acted on. The team screen named couriers from the
 * first 100 staff, and a miss showed a raw id. The depots screen drew the first 100 depots on
 * its list and its map. Each now reads every page (fetchAllPages, which refuses rather than
 * truncating). The home widget shows five couriers but counts them all: its subtitle used the
 * page length, so it stopped at 50.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k), locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Satu', code: 'D1' }],
    selected: { id: 'd1', name: 'Depot Satu', code: 'D1' },
    selectedId: 'd1',
    scopedId: 'd1',
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import TrackingPage from '@/app/dashboard/tracking/page';

/** `route` pages `n` rows of `make(i)`, honouring ?page and ?limit; everything else is empty. */
function paged(route: string, n: number, make: (i: number) => Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    const u = new URL(url, 'http://x');
    // The courier roster is a plain array; every other list is a page.
    if (!u.pathname.includes(route)) return u.pathname.includes('/drivers') ? [] : { items: [], total: 0 };
    const limit = Number(u.searchParams.get('limit') ?? 20);
    // Keyset: the cursor is the offset the next page starts at.
    const from = Number(u.searchParams.get('cursor') ?? 0);
    const end = Math.min(n, from + limit);
    return {
      items: Array.from({ length: Math.max(0, end - from) }, (_, i) => make(from + i)),
      total: n,
      nextCursor: end < n ? String(end) : null,
    };
  });
}

beforeEach(() => get.mockReset());
afterEach(() => vi.clearAllMocks());

describe('the tracking board reads every in-flight delivery', () => {
  it('shows the 130th, past what one page holds', async () => {
    paged('/deliveries/api/v1/deliveries', 130, (i) => ({
      id: `dl-${i}`,
      orderId: `o-${i}`,
      orderNumber: `HM-${i}`,
      status: 'ON_DELIVERY',
      driverId: `drv-${i}`,
      destinationAddress: `Jl. ${i}`,
      assignedAt: '2026-11-20T01:00:00Z',
    }));
    render(<TrackingPage />);
    expect(await screen.findByText(/"HM-129"/)).toBeTruthy();
    await waitFor(() => {
      const cursors = get.mock.calls
        .map((c) => new URL(String(c[0]), 'http://x'))
        .filter((u) => u.pathname.includes('/deliveries/api/v1/deliveries'))
        .map((u) => u.searchParams.get('cursor'));
      // First page without a cursor, the second from where the first one ended.
      expect(cursors).toEqual(expect.arrayContaining([null, '100']));
    });
  });
});

describe('fetchAllByCursor', () => {
  it('walks the cursor to the end and keeps each row once', async () => {
    const { fetchAllByCursor } = await import('@/lib/fetch-all-pages');
    const pages: Record<string, { items: { id: string }[]; nextCursor: string | null }> = {
      start: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c2' },
      // The edge row comes back again: drawn once.
      c2: { items: [{ id: 'b' }, { id: 'c' }], nextCursor: null },
    };
    const rows = await fetchAllByCursor(async ({ cursor }) => pages[cursor ?? 'start']!);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses past its ceiling rather than truncating', async () => {
    const { fetchAllByCursor, TooManyPagesError } = await import('@/lib/fetch-all-pages');
    let n = 0;
    await expect(
      fetchAllByCursor(async () => ({ items: [{ id: `r${(n += 1)}` }], nextCursor: 'more' }), { max: 3 }),
    ).rejects.toBeInstanceOf(TooManyPagesError);
  });
});
