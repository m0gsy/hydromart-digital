// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Flow plan 5a-3 (owner decision 2026-11-17): the monthly review shows laba bersih by the one
 * formula — the depot P&L's figure, fetched from it rather than computed a second time — and
 * renames its own old figure to what it is, arus kas bersih. The month is picked at render,
 * and the month-close panel follows the pick.
 */
const { get, post, who } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), who: { role: 'MANAGER' } }));

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Bu Ani' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Cikini', code: 'JKT-01' }],
    selectedId: 'd1',
    selected: { id: 'd1', name: 'Depot Cikini', code: 'JKT-01' },
    scopedId: 'd1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/monthly-review',
  useSearchParams: () => new URLSearchParams(),
}));

import MonthlyReviewPage from '@/app/dashboard/monthly-review/page';

const REVIEW = {
  depotId: 'd1',
  month: '2026-11',
  orders: 12,
  revenueIdr: 1_000_000,
  refundedIdr: 50_000,
  activeCustomers: 9,
  // (1.000.000 − 50.000) − 100.000 − 150.000 − 70.000
  netCashFlowIdr: 630_000,
  netProfitIdr: 630_000,
  profitBreakdown: { revenueIdr: 1_000_000, cogsIdr: 100_000, payrollIdr: 150_000, opexIdr: 70_000 },
  slaPct: 95,
  gallons: 40,
  prevGallons: 30,
  gallonsDelta: 10,
  growthPct: 33,
  avgGallonsPerDay: 2,
  governance: null,
};

const PNL = {
  revenueIdr: 1_000_000,
  cogsIdr: 400_000,
  payrollIdr: 200_000,
  courierCommissionIdr: 30_000,
  expenseClaimIdr: 20_000,
  refundIdr: 50_000,
  netProfitIdr: 300_000,
  netMarginPct: 30,
  sources: { order: 'ok', depot: 'ok', payroll: 'ok', payout: 'ok', refunds: 'ok' },
};

const serve = (over: { review?: unknown; pnl?: unknown; pnlFails?: boolean } = {}) =>
  get.mockImplementation((url: string) => {
    if (url.includes('/dashboard/monthly-pnl')) {
      return over.pnlFails ? Promise.reject(new Error('403')) : Promise.resolve(over.pnl ?? PNL);
    }
    if (url.includes('/reports/depot-monthly')) return Promise.resolve(over.review ?? REVIEW);
    if (url.includes('/monthly-close')) return Promise.resolve({ close: null, missingDays: [] });
    return Promise.resolve(null);
  });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  who.role = 'MANAGER';
});

describe('the monthly review (flow 5a-3)', () => {
  it('shows laba bersih from the depot P&L and the old figure as arus kas bersih', async () => {
    serve();
    render(<MonthlyReviewPage />);

    expect(await screen.findByText('Rp 300.000')).toBeTruthy();
    expect(screen.getByText('hrFix.monthlyReview.profitFormula')).toBeTruthy();
    expect(screen.getByText('Rp 630.000')).toBeTruthy();
    expect(screen.getAllByText('hrFix.monthlyReview.netCashFlow')).toHaveLength(2);
    expect(screen.getByText('hrFix.monthlyReview.cashFlowFormula')).toBeTruthy();
  });

  it('asks every source about the month picked, and seals that month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-12-02T03:00:00.000Z'));
    serve();
    render(<MonthlyReviewPage />);
    await screen.findByText('Rp 300.000');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-11' } });

    await waitFor(() => {
      const urls = get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('depot-monthly') && u.includes('month=2026-11'))).toBe(true);
      expect(urls.some((u) => u.includes('monthly-pnl') && u.includes('month=2026-11'))).toBe(true);
      expect(urls.some((u) => u.includes('monthly-close?businessMonth=2026-11'))).toBe(true);
    });
    fireEvent.click(await screen.findByRole('button', { name: /closeMonth/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/monthly-close'),
        { businessMonth: '2026-11' },
        true,
      ),
    );
    vi.useRealTimers();
  });

  it("says the month's payroll has not been run when that is why there is no profit", async () => {
    serve({
      pnl: {
        ...PNL,
        payrollIdr: null,
        netProfitIdr: null,
        sources: { ...PNL.sources, payroll: 'pending' },
      },
    });
    render(<MonthlyReviewPage />);

    expect(await screen.findByText(/hrFix\.monthlyReview\.payrollPending/)).toBeTruthy();
  });

  it('says the P&L could not be read rather than showing the cash figure as profit', async () => {
    serve({ pnlFails: true });
    render(<MonthlyReviewPage />);

    expect(await screen.findByText('hrFix.monthlyReview.profitUnread')).toBeTruthy();
    // The cash figure still shows, under its own name only.
    expect(screen.getByText('Rp 630.000')).toBeTruthy();
  });

  it('does not ask a head of depot for the P&L they may not open, nor show its figure', async () => {
    who.role = 'KEPALA_DEPOT';
    serve();
    render(<MonthlyReviewPage />);

    expect(await screen.findByText('Rp 630.000')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('monthly-pnl'))).toBe(false);
    expect(screen.queryByText('hrFix.monthlyReview.netProfit')).toBeNull();
  });

  it("never shows one month's profit under another month's name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-12-02T03:00:00.000Z'));
    serve();
    render(<MonthlyReviewPage />);
    expect(await screen.findByText('Rp 300.000')).toBeTruthy();

    // The P&L for the newly picked month fails: the old figure must go, not linger.
    serve({ pnlFails: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-11' } });

    expect(await screen.findByText('hrFix.monthlyReview.profitUnread')).toBeTruthy();
    expect(screen.queryByText('Rp 300.000')).toBeNull();
    vi.useRealTimers();
  });

  it('reads the old name of the cash figure from an order-service that predates 5a-3', async () => {
    const { netCashFlowIdr, ...old } = REVIEW;
    void netCashFlowIdr;
    serve({ review: old });
    render(<MonthlyReviewPage />);

    expect(await screen.findByText('Rp 630.000')).toBeTruthy();
  });
});
