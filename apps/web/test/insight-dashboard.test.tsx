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
        window: { cancelRate: 0.2, orders: 10 },
        live: { inProgress: 5, unrouted: 3, byStatus: {} },
      });
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
          },
          {
            depotId: 'd2',
            code: 'D2',
            name: 'Depot Dua',
            active: true,
            revenue: 300_000,
            orderCount: 4,
            lowStockCount: 1,
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
    // The names also sit in the depot picker's options; the ranking is the list.
    const inList = async (name: string) =>
      (await screen.findAllByText(name)).find((el) => el.tagName !== 'OPTION') as HTMLElement;
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
    asRole('KEPALA_DEPOT');
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
