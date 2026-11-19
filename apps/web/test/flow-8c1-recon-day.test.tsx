// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 8c-1 (owner decision 2026-11-19: "total satu hari penuh"). The reconciliation read the
 * twenty newest orders and summed THOSE as if they were the day: on a busy day the COD card
 * was short by every order past the twentieth. It now reads every order placed in the chosen
 * WIB day (walked by cursor), totals all of them, and draws the rows twenty at a time.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'MANAGER' } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/payment-recon',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selectedId: 'depot-a',
    selected: { id: 'depot-a', name: 'Depot A', code: 'DPT-A' },
    depots: [{ id: 'depot-a', name: 'Depot A', code: 'DPT-A' }],
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import PaymentReconPage from '@/app/dashboard/payment-recon/page';

const order = (n: number) => ({
  id: `o-${n}`,
  orderNumber: `HM-20261119-${String(n).padStart(6, '0')}`,
  recipientName: `Pembeli ${n}`,
  total: 1000,
  customerId: 'c-1',
  depotId: 'depot-a',
  status: 'COMPLETED',
});

/** 150 orders over two cursor pages (100 + 50), every one paid in cash. */
function serveDay() {
  const all = Array.from({ length: 150 }, (_, i) => order(i + 1));
  get.mockImplementation(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    return q.get('cursor') === 'c-100'
      ? { items: all.slice(100), total: 150, page: 1, limit: 100, nextCursor: null }
      : { items: all.slice(0, 100), total: 150, page: 1, limit: 100, nextCursor: 'c-100' };
  });
  post.mockImplementation(async (_url: string, body: { orderIds: string[] }) =>
    body.orderIds.map((orderId) => ({ id: `p-${orderId}`, orderId, method: 'CASH', status: 'PAID', amount: 1000 })),
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
afterEach(() => vi.useRealTimers());

const view = () =>
  render(
    <LocaleProvider>
      <PaymentReconPage />
    </LocaleProvider>,
  );

describe('payment reconciliation covers the whole day', () => {
  it('totals every order of the day, not the rows drawn', async () => {
    serveDay();
    view();

    await screen.findByText(/HM-20261119-000001/);
    // 150 × Rp 1.000 in the COD card although only twenty rows are on screen.
    expect(screen.getByText(/150\.000/)).toBeTruthy();
    expect(screen.queryByText(/HM-20261119-000021/)).toBeNull();
    // Payments asked in chunks the server takes (100 ids at most), one chunk per call.
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.map((c) => (c[1] as { orderIds: string[] }).orderIds.length)).toEqual([100, 50]);

    fireEvent.click(screen.getByRole('button', { name: /Muat lebih banyak|Load more/i }));
    expect(await screen.findByText(/HM-20261119-000021/)).toBeTruthy();
  });

  it('does not count a cancelled or voided order as unsettled', async () => {
    get.mockResolvedValue({
      items: [
        { ...order(1), status: 'CANCELLED' },
        { ...order(2), status: 'VOIDED' },
        order(3),
      ],
      total: 3,
      page: 1,
      limit: 100,
      nextCursor: null,
    });
    // Only o-3 has a payment row, and it is still pending.
    post.mockResolvedValue([{ id: 'p-3', orderId: 'o-3', method: 'CASH', status: 'PENDING', amount: 1000 }]);
    view();

    await screen.findByText(/HM-20261119-000001/);
    expect(screen.getByText(/1 belum lunas/)).toBeTruthy();
    expect(screen.getAllByText('Dibatalkan')).toHaveLength(2);
  });

  it('a half-typed year neither crashes the screen nor reads a day', async () => {
    serveDay();
    view();
    await screen.findByText(/HM-20261119-000001/);
    get.mockClear();
    // Typing 2025 into the year passes through these; before 1924 the zone has no clean offset.
    for (const partial of ['0002-11-18', '0020-11-18', '0202-11-18', '2999-01-01']) {
      fireEvent.change(screen.getByLabelText(/Tanggal|Date/), { target: { value: partial } });
    }
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText(/HM-20261119-000001/)).toBeTruthy();
  });

  it("asks for the chosen WIB day's window and reads it again on another date", async () => {
    serveDay();
    view();
    await screen.findByText(/HM-20261119-000001/);

    const first = new URL(get.mock.calls[0]![0] as string, 'http://x').searchParams;
    expect(first.get('depotId')).toBe('depot-a');
    // A WIB day runs 17:00Z to 17:00Z.
    expect(first.get('from')).toMatch(/T17:00:00\.000Z$/);
    expect(first.get('to')).toMatch(/T17:00:00\.000Z$/);
    expect(Date.parse(first.get('to')!) - Date.parse(first.get('from')!)).toBe(24 * 3_600_000);
    // The second page is the cursor's, not page 2.
    expect(new URL(get.mock.calls[1]![0] as string, 'http://x').searchParams.get('cursor')).toBe('c-100');

    get.mockClear();
    fireEvent.change(screen.getByLabelText(/Tanggal|Date/), { target: { value: '2026-11-18' } });
    await waitFor(() => expect(get).toHaveBeenCalled());
    const again = new URL(get.mock.calls[0]![0] as string, 'http://x').searchParams;
    expect(again.get('from')).toBe('2026-11-17T17:00:00.000Z');
    expect(again.get('to')).toBe('2026-11-18T17:00:00.000Z');
  });
});
