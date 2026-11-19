// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Flow plan 5b: the depot and head-office comparisons are one table over ONE stated business
 * month (head office used the last 30 days), and their net profit is the P&L's netProfit for
 * that month — never order-service's cash figure.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get, getCached: get }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'd1', name: 'Depot Satu', code: 'BKS-01' },
      { id: 'd2', name: 'Depot Dua', code: 'BKS-02' },
    ],
    scopedId: 'd1',
    selected: null,
    selectedId: null,
    ready: true,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/compare',
  useSearchParams: () => new URLSearchParams(),
}));

import { CompareTable } from '@/components/compare-table';
import DepotComparePage from '@/app/dashboard/compare/page';
import HqComparePage from '@/app/hq/compare/page';

const PNL = {
  depots: [
    { depotId: 'd1', netProfitIdr: 700_000 },
    { depotId: 'd2', netProfitIdr: null },
  ],
};

beforeEach(() => get.mockReset());

describe('the shared compare table', () => {
  it('names a best only when at least two depots have a reading, and dashes a missing one', () => {
    render(
      <CompareTable
        columns={[
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ]}
        rows={[
          { key: 'x', label: 'X', higherIsBetter: true, value: (id) => (id === 'a' ? 5 : 3), format: String },
          { key: 'y', label: 'Y', higherIsBetter: true, value: (id) => (id === 'a' ? 9 : null), format: String },
        ]}
        metricLabel="M"
        bestLabel="BEST"
      />,
    );
    expect(screen.getAllByText('BEST')).toHaveLength(1);
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('the depot comparison', () => {
  it('compares one picked month and takes net profit from the P&L, not the order report', async () => {
    get.mockImplementation((raw: string) => {
      const url = String(raw ?? '');
      if (url.includes('network-pnl')) return Promise.resolve(PNL);
      // order-service's compare still sends its own (cash) figure: it must not be shown as profit.
      return Promise.resolve({
        depots: [
          { depotId: 'd1', orders: 4, revenueIdr: 100_000, slaPct: 90, wastageGallons: 1, netProfitIdr: 999_999 },
          { depotId: 'd2', orders: 2, revenueIdr: 50_000, slaPct: 80, wastageGallons: 0, netProfitIdr: 888_888 },
        ],
      });
    });
    render(<DepotComparePage />);

    expect(await screen.findByText('Rp 700.000')).toBeTruthy();
    expect(screen.queryByText('Rp 999.999')).toBeNull();
    const urls = () => get.mock.calls.map((c) => String(c[0]));
    expect(urls().some((u) => u.includes('network-pnl?month='))).toBe(true);

    const picker = screen.getByLabelText('opsFix.compare.monthLabel') as HTMLSelectElement;
    const older = picker.options[1]!.value;
    fireEvent.change(picker, { target: { value: older } });
    await waitFor(() => expect(urls().some((u) => u.includes(`month=${older}`))).toBe(true));
  });
});

describe('the head-office comparison', () => {
  it('asks the roll-up for the picked month, not the last 30 days', async () => {
    get.mockImplementation((raw: string) => {
      const url = String(raw ?? '');
      if (url.includes('network-pnl')) return Promise.resolve(PNL);
      if (url.includes('gallon')) return Promise.resolve([]);
      if (url.includes('/depots')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({ depots: [] });
    });
    render(<HqComparePage />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    const rollup = get.mock.calls.map((c) => String(c[0])).find((u) => u.includes('from='))!;
    const from = new URL(`http://x${rollup}`).searchParams.get('from')!;
    // The first instant of a WIB month is 17:00 UTC on the last day of the month before.
    expect(from).toMatch(/T17:00:00\.000Z$/);
  });
});
