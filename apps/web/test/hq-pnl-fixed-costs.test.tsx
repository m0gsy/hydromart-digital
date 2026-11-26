// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** HD-16 (D22): the network P&L carries the imported fixed costs as a column, and says "belum diisi". */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));

import HqPnlPage from '@/app/hq/pnl/page';

const row = (over: Record<string, unknown>) => ({
  depotId: 'd1', code: 'JKT-01', name: 'Cikini', active: true,
  revenueIdr: 1_000_000, cogsIdr: 400_000, payrollIdr: 200_000, courierCommissionIdr: 30_000,
  expenseClaimIdr: 20_000, refundIdr: 50_000, fixedCostIdr: 120_000, fixedCostStatus: 'entered', netProfitIdr: 180_000,
  ...over,
});
const report = (depots: unknown[], totals: Record<string, unknown>, payVisible = true) => ({
  payVisible, month: '2026-11', from: 'a', to: 'b', reportType: 'OPERATIONAL_MANAGEMENT', disclaimer: 'x',
  depots, totals,
  sources: { depot: 'ok', order: 'ok', goods: 'ok', payroll: 'ok', payout: 'ok', refunds: 'ok', fixedCosts: 'ok' },
});

beforeEach(() => get.mockReset());

describe('the network P&L fixed-cost column', () => {
  it('shows entered costs and a dash plus the note for a depot that has none', async () => {
    get.mockResolvedValue(report(
      [row({}), row({ depotId: 'd2', code: 'BDG-01', fixedCostIdr: null, fixedCostStatus: 'not_entered', netProfitIdr: 300_000 })],
      { ...row({}), fixedCostStatus: 'partial', netProfitIdr: 480_000 },
    ));
    render(<HqPnlPage />);
    expect(await screen.findByText('hq.pnl.colFixed')).toBeTruthy();
    expect(screen.getAllByText('Rp 120.000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('hq.pnl.fixedNote')).toBeTruthy();
  });

  it('says the fixed costs could not be read, apart from the not-entered note', async () => {
    get.mockResolvedValue(report([row({ fixedCostIdr: null, fixedCostStatus: 'unavailable', netProfitIdr: null })], { ...row({}), fixedCostIdr: null, fixedCostStatus: 'unavailable', netProfitIdr: null }));
    render(<HqPnlPage />);
    expect(await screen.findByText('hq.pnl.fixedUnavailable')).toBeTruthy();
    expect(screen.queryByText('hq.pnl.fixedNote')).toBeNull();
  });

  it('has no fixed-cost column or note for a reader without payrollRead', async () => {
    get.mockResolvedValue(report([row({ fixedCostIdr: null, fixedCostStatus: 'hidden', netProfitIdr: null })], { ...row({}), fixedCostIdr: null, fixedCostStatus: 'hidden' }, false));
    render(<HqPnlPage />);
    await screen.findByText('Cikini');
    expect(screen.queryByText('hq.pnl.colFixed')).toBeNull();
    expect(screen.queryByText('hq.pnl.fixedNote')).toBeNull();
  });
});
