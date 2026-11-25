// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HD-16 (D22): the depot fixed-cost sheet. The month cell must survive Excel turning "2026-11"
 * into a date, the import page is gated by depotCostAdmin, and the HQ view shows what was entered.
 */
const { get, role } = vi.hoisted(() => ({ get: vi.fn(), role: { current: 'FINANCE' } }));

vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: role.current }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k), locale: 'id' }),
}));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/csv-import', async (orig) => ({
  ...(await orig<typeof import('@/components/csv-import')>()),
  CsvImport: (p: { endpoint: string; templateName: string }) => (
    <div data-testid="wizard">{`${p.endpoint}|${p.templateName}`}</div>
  ),
}));

import ImportDepotCostsPage from '@/app/hq/depot-costs/import/page';
import HqDepotCostsPage from '@/app/hq/depot-costs/page';
import { prepareRows } from '@/components/csv-import';
import { DEPOT_COST_IMPORT_COLUMNS, monthCell } from '@/lib/depot-cost-import-columns';

describe('monthCell', () => {
  it.each([
    ['2026-11', '2026-11'],
    [' 2026-01 ', '2026-01'],
    ['2026-11-01', '2026-11'],
  ])('reads %s as %s', (raw, out) => expect(monthCell(raw)).toBe(out));

  it.each(['2026-13', '11/2026', 'Nov-26', '46327', ''])('refuses "%s"', (raw) =>
    expect(() => monthCell(raw)).toThrow('notAMonth'),
  );
});

describe('the fixed-cost import columns', () => {
  it('turns a sheet row into the API row and rejects a bad amount on its own row', () => {
    const rows = prepareRows(
      [
        { depotCode: 'JKT-01', month: '2026-11', category: 'sewa', amountIdr: '3.500.000', note: 'x' },
        { depotCode: 'JKT-01', month: '2026-11', category: 'listrik', amountIdr: 'banyak' },
      ],
      DEPOT_COST_IMPORT_COLUMNS,
    );
    expect(rows[0]!.payload).toEqual({ depotCode: 'JKT-01', month: '2026-11', category: 'sewa', amountIdr: 3_500_000, note: 'x' });
    expect(rows[1]!.error).toContain('notAnInteger');
  });
});

describe('the import page', () => {
  it('opens the wizard for finance and refuses a depot manager', () => {
    role.current = 'FINANCE';
    const { unmount } = render(<ImportDepotCostsPage />);
    expect(screen.getByTestId('wizard').textContent).toBe('/depots/api/v1/depot-fixed-costs/import|biaya-tetap-depot');
    unmount();
    role.current = 'MANAGER';
    render(<ImportDepotCostsPage />);
    expect(screen.queryByTestId('wizard')).toBeNull();
    expect(screen.getByText('hrFix.imports.gateTitle')).toBeTruthy();
  });
});

describe('the HQ view', () => {
  beforeEach(() => get.mockReset());

  it('lists the month with totals, and asks again when the month changes', async () => {
    get.mockResolvedValue({
      month: '2026-11',
      totalIdr: 4_000_000,
      byDepot: [{ depotId: 'd1', depotCode: 'JKT-01', depotName: 'Depot Cikini', totalIdr: 4_000_000 }],
      rows: [
        { id: 'c1', depotId: 'd1', depotCode: 'JKT-01', depotName: 'Depot Cikini', month: '2026-11', category: 'sewa', amountIdr: 3_500_000, note: 'kontrak' },
        { id: 'c2', depotId: 'd1', depotCode: 'JKT-01', depotName: 'Depot Cikini', month: '2026-11', category: 'listrik', amountIdr: 500_000, note: null },
      ],
    });
    render(<HqDepotCostsPage />);
    expect(await screen.findByText('sewa')).toBeTruthy();
    expect(screen.getByText('kontrak')).toBeTruthy();
    expect(screen.getByText('hq.depotCosts.total')).toBeTruthy();
    expect(screen.getByRole('link', { name: /hq.depotCosts.importButton/ }).getAttribute('href')).toBe('/hq/depot-costs/import');

    const calls = get.mock.calls.length;
    const select = screen.getByLabelText('hq.depotCosts.monthLabel') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[1]!.value } });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
    expect(String(get.mock.calls.at(-1)![0])).toContain(`month=${select.options[1]!.value}`);
  });

  it('says so when nothing was entered, and shows an error with a retry', async () => {
    get.mockResolvedValueOnce({ month: '2026-11', totalIdr: 0, byDepot: [], rows: [] });
    const first = render(<HqDepotCostsPage />);
    expect(await screen.findByText('hq.depotCosts.empty')).toBeTruthy();
    first.unmount();
    get.mockRejectedValueOnce(new Error('boom'));
    render(<HqDepotCostsPage />);
    expect(await screen.findByText('common.retry')).toBeTruthy();
  });
});
