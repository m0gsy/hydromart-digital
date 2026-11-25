// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** HD-16 PR-B (D22, D25): the per-legal-entity P&L names the depots left out for moving mid-month. */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));

import HqLegalEntityPnlPage from '@/app/hq/pnl/legal-entities/page';

const totals = (over: Record<string, unknown> = {}) => ({
  revenueIdr: 2_000_000, cogsIdr: 800_000, payrollIdr: 400_000, courierCommissionIdr: 20_000, expenseClaimIdr: 10_000,
  refundIdr: 10_000, fixedCostIdr: 120_000, fixedCostStatus: 'entered', netProfitIdr: 640_000, ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  payVisible: true, month: '2026-11', disclaimer: 'penafian', sources: { legalEntities: 'ok' },
  entities: [
    { legalEntityId: 'e1', name: 'PT Indowater', depots: [{ depotId: 'd1', code: 'A', name: 'Depot A' }], totals: totals() },
    { legalEntityId: 'e2', name: 'PT Mitra', depots: [{ depotId: 'd2', code: 'B', name: 'Depot B' }], totals: totals({ fixedCostIdr: null, fixedCostStatus: 'not_entered' }) },
  ],
  excluded: [{ depotId: 'd3', code: 'M', name: 'Depot Pindah', reason: 'x' }],
  ...over,
});

beforeEach(() => get.mockReset());

describe('the legal-entity P&L screen', () => {
  it('shows each entity with its lines, the not-entered note, and the depots left out by name', async () => {
    get.mockResolvedValue(report());
    render(<HqLegalEntityPnlPage />);
    expect(await screen.findByText('PT Indowater')).toBeTruthy();
    expect(screen.getByText('PT Mitra')).toBeTruthy();
    expect(screen.getAllByText('hq.pnl.colFixed').length).toBe(2);
    expect(screen.getByText('hq.pnl.fixedNote')).toBeTruthy();
    expect(screen.getByText('hq.pnl.entities.excludedTitle')).toBeTruthy();
    expect(screen.getByText('Depot Pindah')).toBeTruthy();
    expect(screen.getByText('penafian')).toBeTruthy();
    expect(String(get.mock.calls[0]![0])).toContain('legal-entity-pnl?month=');
  });

  it('hides pay-related lines for a reader without payrollRead', async () => {
    get.mockResolvedValue(report({ payVisible: false }));
    render(<HqLegalEntityPnlPage />);
    await screen.findByText('PT Indowater');
    for (const k of ['colPayroll', 'colFixed', 'colNet']) expect(screen.queryByText(`hq.pnl.${k}`)).toBeNull();
    expect(screen.queryByText('hq.pnl.fixedNote')).toBeNull();
  });

  it('says so when the entities could not be read, and when there is nothing to show', async () => {
    get.mockResolvedValueOnce(report({ sources: { legalEntities: 'unavailable' }, entities: [], excluded: [] }));
    const first = render(<HqLegalEntityPnlPage />);
    expect(await screen.findByText('hq.pnl.entities.unavailable')).toBeTruthy();
    first.unmount();
    get.mockResolvedValueOnce(report({ entities: [], excluded: [] }));
    render(<HqLegalEntityPnlPage />);
    expect(await screen.findByText('hq.pnl.entities.empty')).toBeTruthy();
    expect(screen.queryByText('hq.pnl.entities.excludedTitle')).toBeNull();
  });

  it('shows the fixed-cost unavailable note on an entity', async () => {
    get.mockResolvedValue(report({ entities: [{ legalEntityId: null, name: 'Belum ada', depots: [], totals: totals({ fixedCostIdr: null, fixedCostStatus: 'unavailable', netProfitIdr: null }) }], excluded: [] }));
    render(<HqLegalEntityPnlPage />);
    expect(await screen.findByText('hq.pnl.fixedUnavailable')).toBeTruthy();
  });
});
