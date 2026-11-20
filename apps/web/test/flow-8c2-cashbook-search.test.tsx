// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 8c-2.
 * - The cash book read "today" from the BROWSER's midnight with no end, so a phone in another
 *   zone read another day, and no earlier day could be read at all. It reads one WIB day now,
 *   chosen on the screen.
 * - The order queue and the staff directory are paged; finding one order or one person meant
 *   paging for it. Both search on the server now (order number; name or phone).
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
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
vi.mock('@/lib/use-custom-roles', () => ({
  useCustomRoles: () => [],
  useDisabledRoles: () => new Set<string>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import CashbookPage from '@/app/dashboard/cashbook/page';
import OrdersQueuePage from '@/app/dashboard/orders/page';
import { StaffDirectory } from '@/components/staff/staff-directory';

const calls = (path: string) =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(path)).map((u) => new URL(u, 'http://x').searchParams);

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/depots/api/v1/cashbook')) return { entries: [], summary: { inIdr: 0, outIdr: 0, netIdr: 0 } };
    if (url.includes('/drivers') || url.includes('/shifts') || url.includes('liabilit')) return [];
    return { items: [], total: 0, page: 1, limit: 50 };
  });
});
afterEach(() => vi.useRealTimers());

describe('the cash book reads one WIB day', () => {
  it("opens on today's WIB window and reads another day when one is picked", async () => {
    render(<CashbookPage />);
    await waitFor(() => expect(calls('/depots/api/v1/cashbook')).toHaveLength(1));
    const first = calls('/depots/api/v1/cashbook')[0]!;
    // A WIB day runs 17:00Z to 17:00Z, the end exclusive: no browser midnight, no open end.
    expect(first.get('from')).toMatch(/T17:00:00\.000Z$/);
    expect(Date.parse(first.get('to')!) - Date.parse(first.get('from')!)).toBe(24 * 3_600_000);
    expect(screen.getByText('opsFix.cashbook.today')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('opsFix.cashbook.day'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(calls('/depots/api/v1/cashbook')).toHaveLength(2));
    const picked = calls('/depots/api/v1/cashbook')[1]!;
    expect(picked.get('from')).toBe('2026-10-31T17:00:00.000Z');
    expect(picked.get('to')).toBe('2026-11-01T17:00:00.000Z');
    // Not today any more: the chip and the "today" heading go.
    expect(screen.queryByText('opsFix.cashbook.today')).toBeNull();
    expect(screen.getByText('opsFix.cashbook.dayTx')).toBeTruthy();
  });
});

describe('a correction on an earlier day', () => {
  it('shows today afterwards, where the server dates the reversal', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/depots/api/v1/cashbook'))
        return {
          entries: [
            { id: 'e1', depotId: 'd1', direction: 'IN', category: 'Penjualan', label: 'Setoran', amountIdr: 5000, occurredAt: '2026-11-01T03:00:00.000Z', sourceRef: null, reversesId: null },
          ],
          summary: { inIdr: 5000, outIdr: 0, netIdr: 5000 },
        };
      if (url.includes('liabilit')) return [];
      return { items: [], total: 0 };
    });
    render(<CashbookPage />);
    await waitFor(() => expect(calls('/depots/api/v1/cashbook')).toHaveLength(1));
    const today = calls('/depots/api/v1/cashbook')[0]!.get('from');

    fireEvent.change(screen.getByLabelText('opsFix.cashbook.day'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(calls('/depots/api/v1/cashbook')).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'opsFix.cashbook.correct' }));
    fireEvent.change(screen.getByLabelText('opsFix.cashbook.reason'), { target: { value: 'salah input' } });
    fireEvent.click(screen.getByRole('button', { name: 'opsFix.cashbook.correctConfirm' }));

    await waitFor(() => expect(calls('/depots/api/v1/cashbook')).toHaveLength(3));
    expect(calls('/depots/api/v1/cashbook')[2]!.get('from')).toBe(today);
  });
});

describe('server-side search', () => {
  it('the order queue asks order-service for the typed order number', async () => {
    render(<OrdersQueuePage />);
    await waitFor(() => expect(calls('/orders/api/v1/orders/manage').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('dashB.orders.search'), { target: { value: ' hm-2026 ' } });
    await waitFor(() =>
      expect(calls('/orders/api/v1/orders/manage').some((q) => q.get('orderNumber') === 'hm-2026')).toBe(true),
    );
    expect(await screen.findByText('dashB.orders.noMatch')).toBeTruthy();
  });

  it('the order queue shows a match from any group while searching', async () => {
    render(<OrdersQueuePage />);
    await waitFor(() => expect(calls('/orders/api/v1/orders/manage').length).toBeGreaterThan(0));
    get.mockImplementation(async (url: string) => {
      if (url.includes('orderNumber=HM-77'))
        return {
          items: [{ id: 'o-77', orderNumber: 'HM-77', status: 'COMPLETED', depotId: 'd1', total: 1, items: [], history: [], recipientName: 'X', createdAt: '2026-11-19T03:00:00.000Z' }],
          total: 1,
          page: 1,
          limit: 100,
        };
      if (url.includes('/drivers') || url.includes('/shifts')) return [];
      return { items: [], total: 0, page: 1, limit: 100 };
    });
    fireEvent.change(screen.getByLabelText('dashB.orders.search'), { target: { value: 'HM-77' } });
    // Completed, so not in the default "needs assigning" group: still on screen.
    expect(await screen.findByText(/HM-77/)).toBeTruthy();
    expect(screen.queryByText('dashB.orders.noMatch')).toBeNull();
  });

  it('the staff directory asks auth-service for the typed name or phone', async () => {
    render(<StaffDirectory header={() => null} />);
    await waitFor(() => expect(calls('/auth/api/v1/auth/staff').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('hq.staff.search'), { target: { value: 'budi' } });
    await waitFor(() =>
      expect(calls('/auth/api/v1/auth/staff').some((q) => q.get('search') === 'budi')).toBe(true),
    );
    expect(await screen.findByText('hq.staff.noMatch')).toBeTruthy();

    // A phone typed the local way is sent as the stored form's digits (+62…).
    fireEvent.change(screen.getByLabelText('hq.staff.search'), { target: { value: '0812-345 6' } });
    await waitFor(() =>
      expect(calls('/auth/api/v1/auth/staff').some((q) => q.get('search') === '628123456')).toBe(true),
    );
  });
});
