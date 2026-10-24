// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

const auth = { customer: null as { id: string; role: string } | null };

vi.mock('@/lib/api', () => ({
  api: { get, getCached },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hq/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import { InsightDashboard } from '@/components/insight/insight-dashboard';
import { LocaleProvider } from '@/lib/locale-context';
import { ApiError } from '@/lib/api';

/**
 * The windows below follow from this instant: 2026-10-15 12:00 WIB. The page reads the clock
 * once, so pinning only `Date` is enough and leaves the timers the test waits on alone.
 */
const NOW = new Date('2026-10-15T05:00:00.000Z');
const THIS_MONTH_FROM = '2026-09-30T17:00:00.000Z';
const LAST_MONTH_FROM = '2026-08-31T17:00:00.000Z';
const LAST_YEAR_FROM = '2025-09-30T17:00:00.000Z';

const fromOf = (path: string): string | null => new URL(path, 'http://x').searchParams.get('from');

const exec = (revenue: number, orders: number, slaRate = 0.9) => ({
  from: null,
  to: null,
  sales: {
    granularity: 'monthly',
    from: null,
    to: null,
    buckets: [{ period: '2026-10', orderCount: orders, revenue }],
  },
  topCustomers: null,
  topDepots: null,
  deliverySla: {
    from: null,
    to: null,
    thresholdMinutes: 60,
    totalDelivered: 20,
    onTime: 18,
    breached: 2,
    slaRate,
    avgMinutes: 41.4,
    failedCount: 0,
  },
  sources: { order: 'ok', delivery: 'ok' },
});

/** What the services answer, keyed by what the URL asks for. */
function serve(overrides: Record<string, () => unknown> = {}) {
  get.mockImplementation((path: string) => {
    const p = String(path);
    for (const [needle, make] of Object.entries(overrides)) {
      if (p.includes(needle)) return Promise.resolve().then(make);
    }
    if (p.includes('/dashboard/executive')) {
      const from = fromOf(p);
      if (from === THIS_MONTH_FROM) return Promise.resolve(exec(1_100_000, 10));
      if (from === LAST_MONTH_FROM) return Promise.resolve(exec(1_000_000, 8));
      // A depot that did not exist a year ago: no base to compare with.
      if (from === LAST_YEAR_FROM) return Promise.resolve(exec(0, 0));
    }
    if (p.includes('/reports/status-summary')) {
      return Promise.resolve({
        from: null,
        to: null,
        window: { cancelRate: 0.2, orders: 10, walkIn: 3, app: 7, completed: 6 },
        live: { inProgress: 5, unrouted: 3, byStatus: { CONFIRMED: 2, ON_DELIVERY: 3 } },
      });
    }
    if (p.includes('/reports/revenue-by-category')) {
      return Promise.resolve({
        grouping: 'product',
        items: [
          {
            productId: 'p1',
            productName: 'Galon 19L',
            orderCount: 6,
            revenue: 750_000,
            share: 0.75,
          },
          {
            productId: 'p2',
            productName: 'Botol 600ml',
            orderCount: 4,
            revenue: 250_000,
            share: 0.25,
          },
        ],
      });
    }
    if (p.includes('/payments/revenue-by-method')) {
      return Promise.resolve([
        { method: 'QRIS', amount: 600_000, count: 5 },
        { method: 'CASH', amount: 400_000, count: 4 },
      ]);
    }
    if (p.includes('/inventory/low-stock')) {
      return Promise.resolve([
        {
          id: 'i1',
          depotId: 'd1',
          label: 'Tutup galon',
          quantity: 5,
          reserved: 0,
          available: 5,
          minimumStock: 20,
          hidden: false,
        },
        {
          id: 'i2',
          depotId: 'd2',
          label: 'Produk lama',
          quantity: 0,
          reserved: 0,
          available: 0,
          minimumStock: 10,
          hidden: true,
        },
      ]);
    }
    if (p.includes('/reports/depot-daily')) {
      return Promise.resolve({
        depotId: 'd1',
        date: '2026-10-15',
        cashInDrawerIdr: 750_000,
        codCollectedIdr: 320_000,
        perCashier: [{ cashierId: 'k1', label: 'Dewi', orders: 6, revenueIdr: 450_000 }],
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          orders: hour === 9 ? 4 : 0,
          revenueIdr: hour === 9 ? 400_000 : 0,
        })),
      });
    }
    if (p.includes('/customers/crm/dashboard')) {
      return Promise.resolve({
        counts: { baru: 4, aktif: 30, inactive: 6, total: 40 },
        repeatRatePct: 62.4,
        followUps: [
          {
            customerId: 'c9',
            name: 'Rahasia',
            phone: '0811',
            lastOrderAt: null,
            daysSinceLastOrder: 30,
            orderCount: 1,
          },
        ],
      });
    }
    if (p.includes('/loyalty/depot-summary')) {
      return Promise.resolve({
        depotId: 'd1',
        totalMembers: 25,
        pointsOutstanding: 4200,
        redeemedThisMonth: 300,
        tiers: { REGULAR: 15, SILVER: 7, GOLD: 3, PLATINUM: 0 },
      });
    }
    if (p.includes('/referrals/depot-summary')) {
      return Promise.resolve({
        depotId: 'd1',
        invited: 12,
        qualified: 5,
        conversionPct: 41.6,
        pointsAwarded: 500,
        topReferrers: [],
      });
    }
    if (p.includes('/forecast/churn')) {
      return Promise.resolve({
        customers: [
          { customerId: 'a', customerName: 'A', riskBand: 'HIGH' },
          { customerId: 'b', customerName: 'B', riskBand: 'HIGH' },
          { customerId: 'c', customerName: 'C', riskBand: 'LOW' },
        ],
      });
    }
    if (p.includes('/vouchers/burn-summary'))
      return Promise.resolve({ totalUsed: 1_250_000, byVoucher: {} });
    if (p.includes('/subscriptions/admin/summary')) {
      return Promise.resolve({
        activeSubscriptions: 18,
        activeSubscribers: 15,
        estMonthlyDeliveries: 72,
        plans: [],
      });
    }
    if (p.includes('/reports/depot-ratings')) {
      return Promise.resolve({
        depotId: 'd1',
        average: 4.5,
        count: 8,
        distribution: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 5 },
        recent: [
          {
            customerName: 'Budi Santoso',
            stars: 5,
            comment: 'Cepat dan ramah',
            createdAt: '2026-10-14T01:00:00.000Z',
          },
        ],
      });
    }
    if (p.includes('/payments/unsettled-by-method')) {
      return Promise.resolve([
        { method: 'TRANSFER', amount: 900_000, count: 3 },
        { method: 'QRIS', amount: 100_000, count: 2 },
      ]);
    }
    if (p.includes('/payments/unsettled-aging')) {
      return Promise.resolve({
        asOf: '2026-10-15T05:00:00.000Z',
        buckets: ['0-1', '2-3', '4-7', '8+'],
        rows: [
          { method: 'TRANSFER', amounts: [500_000, 0, 0, 400_000], counts: [2, 0, 0, 1] },
          { method: 'QRIS', amounts: [100_000, 0, 0, 0], counts: [2, 0, 0, 0] },
        ],
      });
    }
    if (p.includes('/payments/refunds/queue'))
      return Promise.resolve({ items: [], total: 3, page: 1, limit: 1 });
    if (p.includes('/dashboard/network-pnl')) {
      return Promise.resolve({
        month: '2026-10',
        depots: [
          {
            depotId: 'd1',
            code: 'D1',
            name: 'Depot Satu',
            active: true,
            revenueIdr: 800_000,
            cogsIdr: 300_000,
            payrollIdr: null,
            courierCommissionIdr: 20_000,
            expenseClaimIdr: 5_000,
            refundIdr: 99_000,
            netProfitIdr: 123_456,
          },
        ],
        totals: {
          revenueIdr: 800_000,
          cogsIdr: 300_000,
          payrollIdr: null,
          courierCommissionIdr: 20_000,
          expenseClaimIdr: 5_000,
          refundIdr: 99_000,
          netProfitIdr: 123_456,
        },
      });
    }
    if (p.includes('/dashboard/monthly-pnl')) {
      return Promise.resolve({
        revenueIdr: 800_000,
        cogsIdr: null,
        opexIdr: 50_000,
        grossProfitIdr: null,
        netOperatingProfitIdr: null,
        marginPct: null,
      });
    }
    if (p.includes('/gallon-outstanding')) {
      return Promise.resolve([
        {
          depotId: 'd1',
          issued: 100,
          returned: 60,
          outstanding: 40,
          depositHeld: 4_000_000,
          depositRefunded: 2_400_000,
          netDeposit: 1_600_000,
        },
        {
          depotId: 'd2',
          issued: 50,
          returned: 10,
          outstanding: 90,
          depositHeld: 2_000_000,
          depositRefunded: 400_000,
          netDeposit: 1_600_000,
        },
      ]);
    }
    if (p.includes('/gallon-issues/summary'))
      return Promise.resolve({ issues: 12, gallons: 70, depositHeld: 3_500_000 });
    if (p.includes('/returns/summary'))
      return Promise.resolve({ returns: 9, gallons: 55, damaged: 2, depositRefunded: 2_750_000 });
    if (p.includes('/hr-reports/dashboard')) {
      return Promise.resolve({
        depotId: null,
        periodMonth: '2026-10',
        workDate: '2026-10-15',
        headcount: { total: 14, byStatus: [], byEmploymentStatus: [] },
        attendanceToday: [
          { key: 'PRESENT', count: 9 },
          { key: 'LATE', count: 2 },
          { key: 'ABSENT', count: 1 },
        ],
        payroll: {
          totals: {
            gross: 99_000_000,
            totalBonus: 0,
            totalDeduction: 0,
            net: 88_000_000,
            count: 14,
          },
          byStatus: [
            { key: 'DRAFT', count: 4 },
            { key: 'PAID', count: 10 },
          ],
        },
        documentsExpiring: [
          {
            employeeId: 'e1',
            employeeCode: 'E1',
            fullName: 'Rina Dokumen',
            type: 'KTP',
            expiresAt: '2026-10-20',
          },
        ],
        employmentsEnding: [
          {
            employeeId: 'e2',
            employeeCode: 'E2',
            fullName: 'Tono Kontrak',
            employmentStatus: 'CONTRACT',
            contractEndDate: '2026-10-30',
          },
        ],
      });
    }
    if (p.includes('/cashier-shifts')) {
      return Promise.resolve({
        open: [
          {
            id: 's1',
            depotId: 'd1',
            cashierId: 'k1',
            cashierName: 'Dewi',
            status: 'OPEN',
            openingFloat: 100_000,
            openedAt: '2026-10-15T01:00:00.000Z',
            closedAt: null,
            countedCash: null,
            expectedCash: null,
            variance: null,
            note: null,
          },
        ],
        closed: [
          {
            id: 's2',
            depotId: 'd1',
            cashierId: 'k2',
            cashierName: 'Eko',
            status: 'CLOSED',
            openingFloat: 100_000,
            openedAt: '2026-10-14T01:00:00.000Z',
            closedAt: '2026-10-14T10:00:00.000Z',
            countedCash: 480_000,
            expectedCash: 500_000,
            variance: -20_000,
            note: null,
          },
          {
            id: 's3',
            depotId: 'd1',
            cashierId: 'k3',
            cashierName: 'Fani',
            status: 'CLOSED',
            openingFloat: 100_000,
            openedAt: '2026-10-13T01:00:00.000Z',
            closedAt: '2026-10-13T10:00:00.000Z',
            countedCash: 300_000,
            expectedCash: 300_000,
            variance: 0,
            note: null,
          },
        ],
      });
    }
    if (p.includes('/deliveries/api/v1/shifts')) {
      return Promise.resolve([
        { id: 'h1', driverId: 'drv-aaaaaa', depotId: 'd1', status: 'ONLINE' },
        { id: 'h2', driverId: 'drv-bbbbbb', depotId: 'd1', status: 'ONLINE' },
        { id: 'h3', driverId: 'drv-cccccc', depotId: 'd1', status: 'BREAK' },
        { id: 'h4', driverId: 'drv-dddddd', depotId: 'd1', status: 'ENDED' },
      ]);
    }
    if (p.includes('/reports/depot-team')) {
      return Promise.resolve({
        from: '',
        to: '',
        couriers: [
          { driverId: 'drv-aaaaaa', delivered: 30, onTimeRate: 0.9, failed: 2, rating: 4.8 },
          { driverId: 'drv-bbbbbb', delivered: 0, onTimeRate: 0, failed: 0, rating: null },
        ],
        operators: [],
      });
    }
    if (p.includes('/deliveries/api/v1/commission')) {
      return Promise.resolve({
        depotId: 'd1',
        from: '',
        to: '',
        couriers: [
          {
            courierId: 'drv-aaaaaa',
            delivered: 30,
            paidDeliveries: 30,
            grossIdr: 300_000,
            shortfallIdr: 15_000,
            netIdr: 285_000,
          },
        ],
        totalIdr: null,
        source: 'unavailable',
      });
    }
    if (p.includes('/auth/api/v1/auth/drivers')) {
      return Promise.resolve([{ id: 'drv-aaaaaa', fullName: 'Agus Kurir' }]);
    }
    if (p.includes('/reports/meter/')) {
      return Promise.resolve([
        {
          day: '2026-10-13',
          meterLiters: 1000,
          soldLiters: 900,
          varianceLiters: 100,
          varianceGallons: 5,
          roYieldPct: 60,
        },
        {
          day: '2026-10-14',
          meterLiters: 1200,
          soldLiters: 1250,
          varianceLiters: -50,
          varianceGallons: -2.5,
          roYieldPct: 70,
        },
        {
          day: '2026-10-15',
          meterLiters: null,
          soldLiters: 400,
          varianceLiters: null,
          varianceGallons: null,
          roYieldPct: null,
        },
      ]);
    }
    if (p.includes('/reports/rating-by-depot')) {
      return Promise.resolve({
        from: null,
        to: null,
        items: [
          { depotId: 'd1', rating: 4.5, reviewCount: 10 },
          { depotId: 'd2', rating: 3.5, reviewCount: 10 },
        ],
      });
    }
    if (p.includes('/reports/sales') && p.includes('granularity=monthly')) {
      return Promise.resolve({
        granularity: 'monthly',
        from: null,
        to: null,
        buckets: [
          { period: '2026-08', orderCount: 9, revenue: 900_000 },
          { period: '2026-09', orderCount: 7, revenue: 600_000 },
        ],
      });
    }
    if (p.includes('/reports/sales')) {
      return Promise.resolve({
        granularity: 'daily',
        from: null,
        to: null,
        buckets: [
          { period: '2026-10-01', orderCount: 4, revenue: 400_000 },
          { period: '2026-10-02', orderCount: 6, revenue: 700_000 },
        ],
      });
    }
    if (p.includes('/dashboard/network')) {
      return Promise.resolve({
        from: null,
        to: null,
        depots: [
          {
            depotId: 'd1',
            code: 'D1',
            name: 'Depot Satu',
            active: true,
            revenue: 800_000,
            orderCount: 6,
            lowStockCount: 2,
            slaRate: 0.95,
            avgMinutes: 38,
          },
          {
            depotId: 'd2',
            code: 'D2',
            name: 'Depot Dua',
            active: true,
            revenue: 300_000,
            orderCount: 4,
            lowStockCount: 1,
            slaRate: 0.7,
            avgMinutes: 61,
          },
          {
            depotId: 'd3',
            code: 'D3',
            name: 'Depot Tiga',
            active: true,
            revenue: 100_000,
            orderCount: 1,
            lowStockCount: 0,
            slaRate: null,
            avgMinutes: null,
          },
        ],
        sources: { depot: 'ok', order: 'ok', delivery: 'ok', inventory: 'ok' },
      });
    }
    return Promise.resolve(null);
  });
  getCached.mockResolvedValue([
    { id: 'd1', name: 'Depot Satu' },
    { id: 'd2', name: 'Depot Dua' },
  ]);
}

const asRole = (role: string) => {
  auth.customer = { id: 'u-1', role };
};
const requested = (needle: string) => get.mock.calls.some((c) => String(c[0]).includes(needle));
const renderPage = () => render(<InsightDashboard />, { wrapper: LocaleProvider });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  get.mockReset();
  getCached.mockReset();
  auth.customer = null;
  window.history.replaceState(null, '', '/hq/dashboard');
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the dashboard for head office', () => {
  it('shows each headline number from the right source, with the windows it compares against', async () => {
    asRole('HEAD_OFFICE');
    renderPage();

    // Revenue: the month's buckets, summed.
    expect(await screen.findByText(/1\.100\.000/)).toBeTruthy();
    // vs last month: 1.100.000 against 1.000.000 is +10%.
    // Once on the revenue card and once in the one-line reading above it.
    expect((await screen.findAllByText(/naik 10,0%/)).length).toBeGreaterThanOrEqual(1);
    // vs last year there is no base, which is NOT "unchanged".
    expect((await screen.findAllByText(/Belum ada data pembanding/)).length).toBeGreaterThan(0);
    // The cancellation rate, the weighted rating and the on-time delivery.
    expect(await screen.findByText('20%')).toBeTruthy();
    expect(await screen.findByText('4,00')).toBeTruthy();
    expect(await screen.findByText('90%')).toBeTruthy();
  });

  it('writes the one-line reading from the numbers and not from a template that always says "up"', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    expect(
      await screen.findByText(
        'Omzet naik 10,0% dan jumlah pesanan naik 25,0% dibanding periode lalu.',
      ),
    ).toBeTruthy();
  });

  it('puts every chart value in the document, not only in the picture', async () => {
    asRole('HEAD_OFFICE');
    const { container } = renderPage();
    await screen.findByText(/1\.100\.000/);
    await waitFor(() => expect(container.querySelector('table.sr-only')).not.toBeNull());
    const text = container.querySelector('table.sr-only')?.textContent ?? '';
    expect(text).toContain('2026-10-01');
    expect(text).toContain('2026-10-02');
  });

  it('flags what needs doing now, and says nothing is wrong only when nothing is', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    expect(await screen.findByText('Pesanan belum dapat kurir')).toBeTruthy();
    expect(await screen.findByText('Item stok menipis')).toBeTruthy();
    expect(screen.queryByText('Tidak ada yang perlu ditindak sekarang.')).toBeNull();
  });

  it('lists the top depots by revenue with names, highest first', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    const first = await inList('Depot Satu');
    const second = await inList('Depot Dua');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks the server for a window that starts at 00:00 WIB and carries both bounds', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    await screen.findByText(/1\.100\.000/);
    const q = new URL(
      String(get.mock.calls.find((c) => String(c[0]).includes('/reports/status-summary'))?.[0]),
      'http://x',
    ).searchParams;
    expect(q.get('from')).toBe(THIS_MONTH_FROM);
    expect(q.get('to')).toBe('2026-10-31T17:00:00.000Z');
  });
});

describe('a role that holds only some of the capabilities', () => {
  it('shows the headline numbers to finance without ever calling the order reports it cannot read', async () => {
    asRole('FINANCE');
    renderPage();
    expect(await screen.findByText(/1\.100\.000/)).toBeTruthy();
    expect(requested('/reports/status-summary')).toBe(false);
    expect(requested('/reports/rating-by-depot')).toBe(false);
    expect(requested('/reports/sales')).toBe(false);
  });

  it('opens nothing for a role with no dashboard section, and says so', () => {
    asRole('CUSTOMER');
    renderPage();
    expect(screen.getByText('Akun ini belum punya bagian dasbor yang bisa dibuka.')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows a skeleton, not the denied state, until the session has loaded', () => {
    auth.customer = null;
    const { container } = renderPage();
    expect(screen.queryByText('Akun ini belum punya bagian dasbor yang bisa dibuka.')).toBeNull();
    expect(container.firstElementChild).not.toBeNull();
  });
});

describe('when a widget cannot be shown', () => {
  it('hides a widget the server refuses instead of reporting a permission as an outage', async () => {
    asRole('HEAD_OFFICE');
    serve({
      '/reports/rating-by-depot': () => {
        throw new ApiError(403, 'forbidden');
      },
    });
    renderPage();
    await screen.findByText(/1\.100\.000/);
    await screen.findByText('20%');
    expect(screen.queryByText('Rating pelanggan')).toBeNull();
    expect(screen.queryByText(/gagal dimuat/i)).toBeNull();
  });

  it('keeps a failed number honest: a dash, never a zero', async () => {
    asRole('HEAD_OFFICE');
    serve({
      '/dashboard/executive': () => {
        throw new ApiError(500, 'boom');
      },
    });
    renderPage();
    // Revenue, orders, average and on-time delivery all have nothing to show.
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4));
    expect(screen.queryByText('Rp 0')).toBeNull();
  });
});

describe('the period controls', () => {
  it('refuses an over-long custom range without asking the server', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    await screen.findByText(/1.100.000/);

    fireEvent.click(screen.getByRole('button', { name: 'Rentang' }));
    // Today..today is a fine window, and is asked for. Wait for THAT, then watch what follows.
    await waitFor(() => expect(requested('/dashboard/executive?from=2026-10-14T17')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    get.mockClear();

    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '2024-01-01' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '2026-01-01' } });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(requested('/dashboard/executive')).toBe(false);
    expect(requested('/reports/')).toBe(false);
  });

  it('asks for the new window when the period changes, and drops the old answer', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    await screen.findByText(/1\.100\.000/);
    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    await waitFor(() => expect(requested('/dashboard/executive')).toBe(true));
    const from = fromOf(
      String(get.mock.calls.find((c) => String(c[0]).includes('/dashboard/executive'))?.[0]),
    );
    // Today starts at 00:00 WIB = 17:00 UTC the evening before.
    expect(from).toBe('2026-10-14T17:00:00.000Z');
  });

  it('only offers the depot picker when there is a choice to make', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    expect(await screen.findByLabelText('Depot')).toBeTruthy();
    cleanup();
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    await screen.findByText(/1\.100\.000/);
    expect(screen.queryByLabelText('Depot')).toBeNull();
  });
});

describe('a single depot', () => {
  it('asks the target of that depot for the month in view, and shows the achievement', async () => {
    asRole('MANAGER');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    serve({
      '/depot-targets': () => ({
        id: 't',
        depotId: 'd1',
        month: '2026-10',
        revenueTargetIdr: 2_200_000,
      }),
    });
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    // 1.100.000 of 2.200.000 is half of the target.
    expect(await screen.findByText('50%')).toBeTruthy();
    const call = String(get.mock.calls.find((c) => String(c[0]).includes('/depot-targets'))?.[0]);
    expect(call).toContain('depotId=d1');
    expect(call).toContain('month=2026-10');
  });

  it('says the target is not set instead of drawing an empty gauge', async () => {
    asRole('MANAGER');
    serve({ '/depot-targets': () => null });
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    expect(await screen.findByText('Target belum diisi untuk depot dan bulan ini.')).toBeTruthy();
  });

  it('does not ask for a target until one depot is in view, and says why', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    await screen.findByText(/1\.100\.000/);
    expect(requested('/depot-targets')).toBe(false);
    expect(screen.getByText('Pilih satu depot untuk melihat targetnya.')).toBeTruthy();
  });
});

describe('review fixes', () => {
  it('survives switching a long window from months to weeks (no Invalid Date from a monthly series)', async () => {
    asRole('HEAD_OFFICE');
    const { container } = renderPage();
    await screen.findByText(/1.100.000/);
    fireEvent.click(screen.getByRole('button', { name: 'Rentang' }));
    await waitFor(() => expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2));
    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '2026-08-01' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '2026-09-29' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Bulan' }));
    await waitFor(() =>
      expect(container.querySelector('table.sr-only')?.textContent).toContain('2026-08'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Minggu' }));
    // 1 October 2026 is a Thursday: its week is labelled by Monday the 28th.
    await waitFor(() =>
      expect(container.querySelector('table.sr-only')?.textContent).toContain('2026-09-28'),
    );
    expect(container.textContent).not.toMatch(/Invalid|NaN/);
  });

  it('says the comparison is cut when the period is still running, and not otherwise', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    expect(await screen.findByText(/belum selesai, jadi pembandingnya dipotong/)).toBeTruthy();
    // The windows asked for are 15 days (through the 15th), not the whole of September.
    const prevCall = String(
      get.mock.calls.find((c) =>
        String(c[0]).includes('/dashboard/executive?from=2026-08-31T17'),
      )?.[0],
    );
    expect(new URL(prevCall, 'http://x').searchParams.get('to')).toBe('2026-09-15T17:00:00.000Z');
  });

  it('does not compare a day that has not ended: no windows are asked for, and it says there is no base', async () => {
    asRole('HEAD_OFFICE');
    renderPage();
    await screen.findByText(/1.100.000/);
    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    await waitFor(() => expect(requested('/dashboard/executive?from=2026-10-14T17')).toBe(true));
    expect(requested('from=2026-10-13T17')).toBe(false);
    expect(screen.queryByText(/belum selesai, jadi pembandingnya/)).toBeNull();
  });

  it('does not call it all clear when a source failed, only when every source answered and found nothing', async () => {
    asRole('HEAD_OFFICE');
    serve({
      '/dashboard/network': () => {
        throw new ApiError(500, 'down');
      },
      '/reports/status-summary': () => ({
        window: { cancelRate: 0 },
        live: { inProgress: 0, unrouted: 0, byStatus: {} },
      }),
    });
    renderPage();
    await screen.findByText(/1.100.000/);
    await waitFor(() => expect(screen.getByText('Pesanan belum dapat kurir')).toBeTruthy());
    expect(screen.queryByText('Tidak ada yang perlu ditindak sekarang.')).toBeNull();
  });

  it('says all clear when every source answered with nothing to do', async () => {
    asRole('HEAD_OFFICE');
    serve({
      '/dashboard/network': () => ({
        depots: [
          { depotId: 'd1', name: 'Depot Satu', revenue: 1, orderCount: 1, lowStockCount: 0 },
        ],
        sources: {},
      }),
      '/reports/status-summary': () => ({
        window: { cancelRate: 0 },
        live: { inProgress: 0, unrouted: 0, byStatus: {} },
      }),
    });
    renderPage();
    expect(await screen.findByText('Tidak ada yang perlu ditindak sekarang.')).toBeTruthy();
  });
});

const openTab = (tab: string) => window.history.replaceState(null, '', `/hq/dashboard?tab=${tab}`);
// The names also sit in the depot picker's options, which are there first: wait for the LIST.
const inList = (name: string) =>
  waitFor(() => {
    const el = screen.queryAllByText(name).find((e) => e.tagName !== 'OPTION');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });

describe('the sales tab', () => {
  it('splits revenue by product and by payment method, in words and numbers', async () => {
    asRole('HEAD_OFFICE');
    openTab('sales');
    renderPage();
    expect(await screen.findByText('Galon 19L')).toBeTruthy();
    expect(screen.getByText('Botol 600ml')).toBeTruthy();
    // 750.000 of 1.000.000 is 75%, and the note says it is per product, not per category.
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText(/Per produk, bukan per kategori/)).toBeTruthy();
    // Payment methods are named for a person, not by their enum.
    expect(await screen.findByText('Tunai')).toBeTruthy();
    expect(screen.getByText('QRIS')).toBeTruthy();
    expect(screen.getByText(/tidak mengikuti pilihan depot/)).toBeTruthy();
  });

  it('shows how many orders came through the app and how many at the counter', async () => {
    asRole('HEAD_OFFICE');
    openTab('sales');
    renderPage();
    expect(await screen.findByText('Pesanan lewat aplikasi')).toBeTruthy();
    expect(screen.getByText('7 · 70%')).toBeTruthy();
    expect(screen.getByText('3 · 30%')).toBeTruthy();
  });

  it('lists the top customers by name', async () => {
    asRole('HEAD_OFFICE');
    openTab('sales');
    serve({
      '/dashboard/executive': () => ({
        ...exec(1, 1),
        topCustomers: {
          items: [
            { customerId: 'c1', customerName: 'Bu Sari', orderCount: 9, revenue: 500_000 },
            { customerId: 'c2', customerName: null, orderCount: 2, revenue: 100_000 },
          ],
        },
      }),
    });
    renderPage();
    expect(await screen.findByText('Bu Sari')).toBeTruthy();
    expect(screen.getByText('Tanpa nama')).toBeTruthy();
  });

  it('shows customer names only to a role that may read customers, and a rank to the rest', async () => {
    const withNames = () =>
      serve({
        '/dashboard/executive': () => ({
          ...exec(1, 1),
          topCustomers: {
            items: [{ customerId: 'c1', customerName: 'Bu Sari', orderCount: 9, revenue: 500_000 }],
          },
        }),
      });
    asRole('FINANCE');
    openTab('sales');
    withNames();
    renderPage();
    expect(await screen.findByText('Pelanggan 1')).toBeTruthy();
    expect(screen.queryByText('Bu Sari')).toBeNull();
    cleanup();
    asRole('HEAD_OFFICE');
    withNames();
    renderPage();
    expect(await screen.findByText('Bu Sari')).toBeTruthy();
  });

  it('gives finance the payment methods and nothing it cannot read', async () => {
    asRole('FINANCE');
    openTab('sales');
    renderPage();
    expect(await screen.findByText('Tunai')).toBeTruthy();
    expect(requested('/reports/')).toBe(false);
  });

  it('narrows the product split to the chosen depot but leaves the network-wide payments alone', async () => {
    asRole('HEAD_OFFICE');
    openTab('sales');
    renderPage();
    await screen.findByText('Galon 19L');
    get.mockClear();
    fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: 'd1' } });
    await waitFor(() => expect(requested('/reports/revenue-by-category')).toBe(true));
    const product = String(
      get.mock.calls.find((c) => String(c[0]).includes('/revenue-by-category'))?.[0],
    );
    expect(new URL(product, 'http://x').searchParams.get('depotIds')).toBe('d1');
    expect(requested('/payments/revenue-by-method')).toBe(false);
  });
});

describe('the operations tab', () => {
  it('shows what is moving right now, with the part that still needs a courier flagged', async () => {
    asRole('HEAD_OFFICE');
    openTab('operations');
    renderPage();
    const card = (label: string) => screen.getByText(label).parentElement?.parentElement;
    expect(await screen.findByText('Dikonfirmasi')).toBeTruthy();
    // 5 in flight, 3 of them with no courier yet — and that count is the alarm colour.
    expect(card('Pesanan berjalan')?.textContent).toContain('5');
    expect(card('Pesanan belum dapat kurir')?.textContent).toContain('3');
    expect(card('Pesanan belum dapat kurir')?.querySelector('[class*="--danger"]')).not.toBeNull();
    expect(screen.getByText('Dalam pengiriman')).toBeTruthy();
  });

  it('ranks depots by on-time delivery, worst first, and puts one with no deliveries last as unmeasured', async () => {
    asRole('HEAD_OFFICE');
    openTab('operations');
    renderPage();
    const worst = await inList('Depot Dua');
    const best = await inList('Depot Satu');
    const none = await inList('Depot Tiga');
    expect(worst.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(best.compareDocumentPosition(none) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('belum ada pengiriman')).toBeTruthy();
  });

  it('lists low stock without the lines of deactivated products', async () => {
    asRole('HEAD_OFFICE');
    openTab('operations');
    renderPage();
    expect(await screen.findByText('Tutup galon')).toBeTruthy();
    expect(screen.getByText('sisa 5 / min 20')).toBeTruthy();
    expect(screen.queryByText('Produk lama')).toBeNull();
  });

  it("asks for today's orders by hour only once one depot is in view", async () => {
    asRole('HEAD_OFFICE');
    openTab('operations');
    renderPage();
    expect(
      await screen.findByText('Pilih satu depot untuk melihat pesanan per jam hari ini.'),
    ).toBeTruthy();
    expect(requested('/reports/depot-daily')).toBe(false);
    fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: 'd1' } });
    expect(await screen.findByText('Pesanan masuk per jam hari ini')).toBeTruthy();
    const call = String(
      get.mock.calls.find((c) => String(c[0]).includes('/reports/depot-daily'))?.[0],
    );
    expect(call).toContain('depotId=d1');
    // Always today, whatever window the date bar holds.
    expect(call).toContain('date=2026-10-15');
  });

  it('lets a depot head see stock and the day by hour, and nothing it cannot read', async () => {
    asRole('KEPALA_DEPOT');
    openTab('operations');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    expect(await screen.findByText('Tutup galon')).toBeTruthy();
    expect(await screen.findByText('Pesanan masuk per jam hari ini')).toBeTruthy();
    expect(requested('/reports/status-summary')).toBe(false);
    expect(requested('/dashboard/')).toBe(false);
    // Its stock is asked for its own depot by name.
    const stock = String(
      get.mock.calls.find((c) => String(c[0]).includes('/inventory/low-stock'))?.[0],
    );
    expect(stock).toContain('depotId=d1');
  });
});

describe('the customers tab', () => {
  it('asks for a depot before the figures that belong to one, and shows the network ones at once', async () => {
    asRole('HEAD_OFFICE');
    openTab('customers');
    renderPage();
    expect(await screen.findByText(/Pilih satu depot untuk melihat data pelanggan/)).toBeTruthy();
    expect(requested('/customers/crm/dashboard')).toBe(false);
    // Voucher spend and subscriptions are the network's, so they do not wait for a depot.
    expect(await screen.findByText(/1\.250\.000/)).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
  });

  it('shows one depot’s customers, loyalty, referrals and reviews once it is chosen', async () => {
    asRole('HEAD_OFFICE');
    openTab('customers');
    renderPage();
    fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: 'd1' } });
    expect(await screen.findByText('40')).toBeTruthy();
    expect(screen.getByText('62%')).toBeTruthy();
    expect(await screen.findByText('4200')).toBeTruthy();
    // Tiers are named for a person, not by their enum.
    expect(await screen.findByText('Reguler')).toBeTruthy();
    expect(screen.queryByText('REGULAR')).toBeNull();
    expect(await screen.findByText('42%')).toBeTruthy();
    // A review shows what was said and the initials of who said it, not the name.
    expect(await screen.findByText('Cepat dan ramah')).toBeTruthy();
    expect(screen.getByText('B. S.')).toBeTruthy();
    expect(screen.queryByText(/Budi Santoso/)).toBeNull();
    // The follow-up list holds names and phone numbers: it is not on this screen.
    expect(screen.queryByText('Rahasia')).toBeNull();
    expect(screen.queryByText('0811')).toBeNull();
  });

  it('counts customers at risk by band and says it is a list, not lost customers', async () => {
    asRole('HEAD_OFFICE');
    openTab('customers');
    renderPage();
    expect(await screen.findByText('Risiko tinggi')).toBeTruthy();
    expect(screen.getByText(/Dari 3 pelanggan paling berisiko yang dinilai/)).toBeTruthy();
  });

  it('gives marketing the network widgets and never asks for CRM or reviews it cannot read', async () => {
    asRole('MARKETING');
    openTab('customers');
    renderPage();
    expect(await screen.findByText(/1\.250\.000/)).toBeTruthy();
    expect(requested('/customers/crm/dashboard')).toBe(false);
    expect(requested('/reports/depot-ratings')).toBe(false);
    expect(requested('/subscriptions/admin/summary')).toBe(false);
  });
});

describe('the finance tab', () => {
  it('shows what has waited, in which bucket, with the numbers in the cells', async () => {
    asRole('HEAD_OFFICE');
    openTab('finance');
    renderPage();
    expect(await screen.findByText('Umur uang yang belum diselesaikan')).toBeTruthy();
    // Transfer: 500.000 fresh, 400.000 in the 8+ day bucket, 900.000 in all.
    expect(await screen.findByText(/500\.000/)).toBeTruthy();
    expect(screen.getAllByText(/900\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText('8+ hari')).toBeTruthy();
    // The queue of big refunds waiting for head office.
    expect(await screen.findByText('3')).toBeTruthy();
  });

  it('shows the cost columns of the network P&L with a dash for what could not be read, and leaves out the unreliable ones', async () => {
    asRole('HEAD_OFFICE');
    openTab('finance');
    renderPage();
    expect(await screen.findByText('Laba rugi jaringan 2026-10')).toBeTruthy();
    expect(await screen.findByText('Harga pokok')).toBeTruthy();
    // Payroll was not readable: a dash, never Rp 0.
    expect((await screen.findAllByText('—')).length).toBeGreaterThan(0);
    // The refund and net-profit columns are not shown, nor their figures.
    expect(screen.queryByText('Refund')).toBeNull();
    expect(screen.queryByText(/123\.456/)).toBeNull();
    expect(screen.queryByText(/99\.000/)).toBeNull();
    expect(screen.getByText(/Kolom refund dan laba bersih tidak ditampilkan/)).toBeTruthy();
  });

  it('gives finance the unsettled money but no P&L, which needs a capability it does not hold', async () => {
    asRole('FINANCE');
    openTab('finance');
    renderPage();
    expect(await screen.findByText('Umur uang yang belum diselesaikan')).toBeTruthy();
    expect(requested('/dashboard/network-pnl')).toBe(false);
    expect(requested('/dashboard/monthly-pnl')).toBe(false);
  });

  it('says plainly that costs are incomplete instead of showing a profit', async () => {
    asRole('HEAD_OFFICE');
    openTab('finance');
    renderPage();
    fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: 'd1' } });
    expect(await screen.findByText('Biaya belum lengkap')).toBeTruthy();
    const call = String(
      get.mock.calls.find((c) => String(c[0]).includes('/dashboard/monthly-pnl'))?.[0],
    );
    expect(call).toContain('depotId=d1');
    expect(call).toContain('month=2026-10');
  });

  it('does not call a profit incomplete just because there was no revenue to take a margin of', async () => {
    asRole('HEAD_OFFICE');
    openTab('finance');
    serve({
      '/dashboard/monthly-pnl': () => ({
        revenueIdr: 0,
        cogsIdr: 0,
        opexIdr: 400_000,
        grossProfitIdr: 0,
        netOperatingProfitIdr: -400_000,
        marginPct: null,
      }),
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: 'd1' } });
    // A real loss, stated as one, and no claim that the costs were missing.
    expect(await screen.findByText(/400.000/)).toBeTruthy();
    expect(screen.queryByText('Biaya belum lengkap')).toBeNull();
  });

  it('says the P&L month when the window is not a month', async () => {
    asRole('HEAD_OFFICE');
    openTab('finance');
    renderPage();
    await screen.findByText('Umur uang yang belum diselesaikan');
    expect(screen.queryByText(/Laba rugi dibaca per bulan/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minggu ini' }));
    expect(
      await screen.findByText(/Laba rugi dibaca per bulan, jadi yang tampil adalah bulan 2026-10/),
    ).toBeTruthy();
  });
});

const pickDepot = async (id = 'd1') =>
  fireEvent.change(await screen.findByLabelText('Depot'), { target: { value: id } });

describe('the gallons tab', () => {
  it('ranks depots by empties still out, and totals every column for the network', async () => {
    asRole('HEAD_OFFICE');
    openTab('gallons');
    renderPage();
    const worst = await inList('Depot Dua');
    const other = await inList('Depot Satu');
    expect(worst.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 40 + 90 empties out, 3.200.000 net deposit between them.
    expect(await screen.findByText('130')).toBeTruthy();
    expect(screen.getAllByText(/3\.200\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Semua dihitung sejak awal/)).toBeTruthy();
  });

  it('shows one depot’s gallon and deposit figures only once it is chosen, labelled as since the start', async () => {
    asRole('HEAD_OFFICE');
    openTab('gallons');
    renderPage();
    expect(await screen.findByText(/Pilih satu depot untuk melihat galon/)).toBeTruthy();
    expect(requested('/gallon-issues/summary')).toBe(false);
    await pickDepot();
    expect(await screen.findByText('70')).toBeTruthy();
    expect(screen.getByText('55')).toBeTruthy();
    expect((await screen.findAllByText('sejak awal')).length).toBeGreaterThan(0);
  });

  it('gives finance the network table and never asks for one depot’s summaries it cannot read', async () => {
    asRole('FINANCE');
    openTab('gallons');
    renderPage();
    expect(await inList('Depot Dua')).toBeTruthy();
    expect(requested('/gallon-issues/summary')).toBe(false);
    expect(requested('/returns/summary')).toBe(false);
  });
});

describe('the people tab', () => {
  it('shows who is at work today and what needs HR attention, without the payroll amounts', async () => {
    asRole('HEAD_OFFICE');
    openTab('people');
    renderPage();
    expect(await screen.findByText('Karyawan')).toBeTruthy();
    expect(await screen.findByText('9')).toBeTruthy();
    expect(screen.getByText('Rina Dokumen')).toBeTruthy();
    expect(screen.getByText('Tono Kontrak')).toBeTruthy();
    // Payroll: how many are in each status. The money is not on this screen.
    expect(screen.getByText('Draf')).toBeTruthy();
    expect(screen.getByText('Dibayar')).toBeTruthy();
    expect(screen.queryByText(/88\.000\.000/)).toBeNull();
    expect(screen.queryByText(/99\.000\.000/)).toBeNull();
  });

  it('reads the payroll month from the window and asks for it by name', async () => {
    asRole('HEAD_OFFICE');
    openTab('people');
    renderPage();
    await screen.findByText('Karyawan');
    const call = String(
      get.mock.calls.find((c) => String(c[0]).includes('/hr-reports/dashboard'))?.[0],
    );
    expect(call).toContain('periodMonth=2026-10');
  });
});

describe('the cash tab', () => {
  it('lists the shifts with their variance and counts only the closed ones that are off', async () => {
    asRole('MANAGER');
    openTab('cash');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    expect(await screen.findByText('Eko')).toBeTruthy();
    // One closed shift is short by 20.000; the other balanced; the open one is not counted yet.
    expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText('sedang buka')).toBeTruthy();
    const card = screen.getByText('Shift dengan selisih').parentElement?.parentElement;
    expect(card?.textContent).toContain('1');
  });

  it('asks for a depot first, and then reads the cash of THIS day', async () => {
    asRole('HEAD_OFFICE');
    openTab('cash');
    renderPage();
    // Head office holds the daily report but not the cashier shifts.
    expect(await screen.findByText(/Pilih satu depot untuk melihat kas/)).toBeTruthy();
    expect(requested('/cashier-shifts')).toBe(false);
    await pickDepot();
    await waitFor(() => expect(requested('/reports/depot-daily')).toBe(true));
    expect(requested('/cashier-shifts')).toBe(false);
  });
});

describe('the couriers tab', () => {
  it('counts the couriers on shift by status and leaves out the ones whose shift ended', async () => {
    asRole('HEAD_OFFICE');
    openTab('couriers');
    renderPage();
    const card = async (label: string) =>
      (await screen.findByText(label)).parentElement?.parentElement;
    expect((await card('Kurir siaga'))?.textContent).toContain('2');
    expect((await card('Kurir istirahat'))?.textContent).toContain('1');
    expect((await card('Kurir offline'))?.textContent).toContain('0');
  });

  it('names a courier from the depot’s driver list and falls back to a short id for one it cannot find', async () => {
    asRole('MANAGER');
    openTab('couriers');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    expect((await screen.findAllByText('Agus Kurir')).length).toBeGreaterThan(0);
    expect(screen.getByText('Kurir drv-bb')).toBeTruthy();
  });

  it('shows a dash for the on-time rate of a courier with no deliveries, never 0%', async () => {
    asRole('MANAGER');
    openTab('couriers');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    await screen.findByText('Kurir drv-bb');
    const row = screen.getByText('Kurir drv-bb').closest('tr')!;
    expect(row.textContent).not.toContain('0%');
    expect(row.textContent).toContain('—');
  });

  it('says the commission total is unavailable instead of inventing one', async () => {
    asRole('MANAGER');
    openTab('couriers');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    expect(await screen.findByText(/belum bisa dibaca dari layanan pembayaran/)).toBeTruthy();
    expect(screen.getByText(/selisih COD/)).toBeTruthy();
  });

  it('always sends a start for the shifts on duty: the server has no default window', async () => {
    asRole('MANAGER');
    openTab('couriers');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    await screen.findByText('Kurir siaga');
    const call = String(
      get.mock.calls.find((c) => String(c[0]).includes('/deliveries/api/v1/shifts'))?.[0],
    );
    expect(new URL(call, 'http://x').searchParams.get('from')).toBe('2026-10-14T17:00:00.000Z');
  });
});

describe('the meter tab', () => {
  it('shows the gap as an indication, counts only the days the meter was read, and flags the unread day', async () => {
    asRole('MANAGER');
    openTab('meter');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    // 100 L over one day and 50 L under on another: 50 L net, over the two days read.
    expect(await screen.findByText('50 L')).toBeTruthy();
    expect(screen.getByText('2 dari 3 hari terbaca')).toBeTruthy();
    const unread = screen.getByText('Hari tanpa bacaan meter').parentElement?.parentElement;
    expect(unread?.textContent).toContain('1');
    // Yield averages the days it exists for (60 and 70), not the day with no reading.
    expect(screen.getByText('65%')).toBeTruthy();
  });

  it('sends both bounds, ends no later than tomorrow, and never asks for more than 92 days', async () => {
    asRole('MANAGER');
    openTab('meter');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    await screen.findByText('Hari tanpa bacaan meter');
    const q = new URL(
      String(get.mock.calls.find((c) => String(c[0]).includes('/reports/meter/'))?.[0]),
      'http://x',
    ).searchParams;
    expect(q.get('from')).toBe('2026-09-30T17:00:00.000Z');
    // The month ends on 31 October but the meter has nothing after today.
    expect(q.get('to')).toBe('2026-10-15T17:00:00.000Z');
    expect(screen.queryByText(/lebih panjang dari yang dibaca server/)).toBeNull();
  });

  it('tells a reader that a window longer than the server reads was cut, and asks for the last 92 days', async () => {
    asRole('MANAGER');
    openTab('meter');
    getCached.mockResolvedValue([{ id: 'd1', name: 'Depot Satu' }]);
    renderPage();
    await screen.findByText('Hari tanpa bacaan meter');
    fireEvent.click(screen.getByRole('button', { name: 'Rentang' }));
    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '2026-01-01' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '2026-10-15' } });
    expect(await screen.findByText(/lebih panjang dari yang dibaca server/)).toBeTruthy();
    const calls = get.mock.calls.filter((c) => String(c[0]).includes('/reports/meter/'));
    const q = new URL(String(calls[calls.length - 1]?.[0]), 'http://x').searchParams;
    const days =
      (Date.parse(q.get('to') as string) - Date.parse(q.get('from') as string)) / 86_400_000;
    expect(days).toBeLessThanOrEqual(92);
  });

  it('does not ask a depot with no depot chosen, and says why', async () => {
    asRole('HEAD_OFFICE');
    openTab('meter');
    renderPage();
    expect(await screen.findByText(/Pilih satu depot untuk melihat meter air/)).toBeTruthy();
    expect(requested('/reports/meter/')).toBe(false);
  });
});
