// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Flow plan 5a-2: the depot P&L shows laba bersih by the one formula the network P&L uses
 * (revenue − HPP − gaji − komisi kurir − klaim biaya − refund). Cash out is no longer a line,
 * and the deprecated "net operating profit" the API still sends for installed apps is never
 * shown here.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
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
  usePathname: () => '/dashboard/monthly-pnl',
  useSearchParams: () => new URLSearchParams(),
}));

import MonthlyPnlPage from '@/app/dashboard/monthly-pnl/page';

const REPORT = {
  depotId: 'd1',
  month: '2026-07',
  from: '2026-06-30T17:00:00.000Z',
  to: '2026-07-31T17:00:00.000Z',
  reportType: 'OPERATIONAL_MANAGEMENT',
  disclaimer: 'x',
  revenueIdr: 1_000_000,
  cogsIdr: 400_000,
  coveredCogsIdr: 400_000,
  grossProfitIdr: 600_000,
  payrollIdr: 200_000,
  courierCommissionIdr: 30_000,
  expenseClaimIdr: 20_000,
  refundIdr: 50_000,
  netProfitIdr: 300_000,
  netMarginPct: 30,
  costCoverage: {
    amountIdr: 400_000,
    coveredAmountIdr: 400_000,
    totalUnits: 10,
    coveredUnits: 10,
    uncoveredUnits: 0,
    status: 'complete',
    valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST',
    uncoveredItems: [],
  },
  // Deprecated, for the installed app only: must not reach this screen.
  opexIdr: 150_000,
  netOperatingProfitIdr: 450_000,
  marginPct: 45,
  opexCoverage: null,
  sources: { order: 'ok', depot: 'ok', payroll: 'ok', payout: 'ok', refunds: 'ok' },
};

beforeEach(() => get.mockReset());

describe('the depot P&L (flow 5a-2)', () => {
  it('shows laba bersih and every term of the one formula', async () => {
    get.mockResolvedValue(REPORT);
    render(<MonthlyPnlPage />);

    // The headline card and the bottom line of the statement.
    expect(await screen.findAllByText('Rp 300.000')).toHaveLength(2);
    expect(screen.getAllByText('mgrFix.pnl.netProfit')).toHaveLength(2);
    expect(screen.getByText('30%')).toBeTruthy();
    for (const term of ['payroll', 'courierCommission', 'expenseClaims', 'refunds']) {
      expect(screen.getByText(`mgrFix.pnl.${term}`)).toBeTruthy();
    }
    expect(screen.queryByText('mgrFix.pnl.opex')).toBeNull();
    expect(screen.queryByText('Rp 450.000')).toBeNull();
    expect(screen.queryByText('mgrFix.pnl.partial')).toBeNull();
  });

  it('says the report is partial when a cost source could not be read', async () => {
    get.mockResolvedValue({
      ...REPORT,
      payrollIdr: null,
      netProfitIdr: null,
      netMarginPct: null,
      sources: { ...REPORT.sources, payroll: 'unavailable' },
    });
    render(<MonthlyPnlPage />);

    expect(await screen.findByText('mgrFix.pnl.partial')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('survives an answer from the previous dashboard image, which has none of the new fields', async () => {
    // Deploy skew or a rollback of dashboard-service alone: the old shape.
    const { payrollIdr, courierCommissionIdr, expenseClaimIdr, refundIdr, netProfitIdr, netMarginPct, ...old } =
      REPORT;
    void [payrollIdr, courierCommissionIdr, expenseClaimIdr, refundIdr, netProfitIdr, netMarginPct];
    get.mockResolvedValue({ ...old, sources: { order: 'ok', depot: 'ok' } });
    render(<MonthlyPnlPage />);

    expect(await screen.findByText('mgrFix.pnl.partial')).toBeTruthy();
    expect(screen.getAllByText('mgrFix.pnl.status.unavailable')).toHaveLength(3);
    expect(screen.queryByText('Rp 450.000')).toBeNull();
  });

  it('does not call the report partial because cash-out lines are unverified', async () => {
    // depot = 'partial' only because of an unverified PO-category cash-out line, which is no
    // longer a term of laba bersih; HPP itself is complete.
    get.mockResolvedValue({ ...REPORT, sources: { ...REPORT.sources, depot: 'partial' } });
    render(<MonthlyPnlPage />);

    expect(await screen.findAllByText('Rp 300.000')).toHaveLength(2);
    expect(screen.queryByText('mgrFix.pnl.partial')).toBeNull();
  });
});
