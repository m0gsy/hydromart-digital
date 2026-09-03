// @vitest-environment jsdom
/*
 * Three things the HR console had built and could not be reached.
 *
 * CA-1-21  every report takes a depotId; the screen passed `undefined` for all of them
 * CA-1-33  the rail is `hidden sm:flex` and was the whole navigation — below 640px, none
 * CA-1-34  `/hr/loans/import` could paste 500 kasbon rows and no screen listed them
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, getBlob, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  // The page builds its own `download` around `api.getBlob`, so THAT is the seam: the URL
  // it asks for is exactly what the report was scoped to.
  getBlob: vi.fn(),
  role: { current: 'HR' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  // A NAMED export, not a member of `api` — the reports page imports it directly.
  getBlob,
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/csv', () => ({ downloadBlob: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'd-1', code: 'D1', name: 'Depot Satu' },
      { id: 'd-2', code: 'D2', name: 'Depot Dua' },
    ],
    scopedId: 'd-1',
    setSelected: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/reports',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import ReportsPage from '@/app/hr/reports/page';
import LoansPage from '@/app/hr/loans/page';
import { HrBottomNav } from '@/components/hr/hr-bottom-nav';

const page = (rows: unknown[], total = rows.length) => ({ rows, total, page: 1, pageSize: 25 });

beforeEach(() => {
  role.current = 'HR';
  getBlob.mockReset().mockResolvedValue(new Blob(['x']));
  const answer = (url: string) =>
    /departments|shifts|depots/.test(String(url)) ? Promise.resolve([]) : Promise.resolve(page([]));
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
});
afterEach(() => vi.clearAllMocks());

describe('HR reports can be asked for one depot (CA-1-21)', () => {
  it('sends no depot until one is chosen, and then sends it', async () => {
    const user = userEvent.setup();
    render(<ReportsPage />, { wrapper: LocaleProvider });

    // The employee report needs no date range, so it is the one that downloads on one tap.
    const csvButtons = await screen.findAllByRole('button', { name: /csv/i });
    await user.click(csvButtons[0]!);
    await waitFor(() => expect(getBlob).toHaveBeenCalled());
    // Blank means the whole network — what every report did before this existed.
    expect(String(getBlob.mock.calls[0]![0])).not.toContain('depotId');

    getBlob.mockClear();
    await user.selectOptions(screen.getByRole('combobox', { name: /depot/i }), 'd-2');
    await user.click(screen.getAllByRole('button', { name: /csv/i })[0]!);

    await waitFor(() => expect(getBlob).toHaveBeenCalled());
    expect(String(getBlob.mock.calls[0]![0])).toContain('depotId=d-2');
  });
});

describe('the HR console has navigation on a phone (CA-1-33)', () => {
  it('offers tabs, the full list behind them, and a way to sign out', async () => {
    render(<HrBottomNav />, { wrapper: LocaleProvider });

    // The rail is desktop-only; below 640px this bar is the whole of the navigation.
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /lainnya/i }));

    // Every screen the reader may open, not a hand-picked four.
    expect(await screen.findByRole('dialog')).toBeTruthy();
    // Present in the drawer AND as a tab on the bar, which is the point of the bar.
    expect(screen.getAllByRole('link', { name: /karyawan/i }).length).toBeGreaterThan(0);
    // Sign-out lives in the rail, so on a phone this console could not end a session.
    expect(screen.getByRole('button', { name: /keluar/i })).toBeTruthy();
  });

  it('hides an admin-only screen from a reader who may not open it', async () => {
    // The bar reads the rail's own model, so a door hidden in one place cannot be offered
    // in the other. SUPERVISOR is not an HR admin.
    role.current = 'SUPERVISOR';
    render(<HrBottomNav />, { wrapper: LocaleProvider });

    await userEvent.click(screen.getByRole('button', { name: /lainnya/i }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('link', { name: /jejak audit|audit/i })).toBeNull();
  });
});

describe('the kasbon ledger has a list, not only an import (CA-1-34)', () => {
  const loan = (over: Record<string, unknown> = {}) => ({
    id: 'ln-1',
    employeeId: 'e-1',
    employeeName: 'Budi Santoso',
    employeeCode: 'K001',
    principal: '1500000',
    installmentAmount: '250000',
    startPeriod: '2026-08',
    note: null,
    active: true,
    remaining: 1_250_000,
    settled: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdBy: null,
    ...over,
  });

  it('names whose loan it is and what is still owed', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/loans/all')
        ? Promise.resolve({ rows: [loan()], total: 1 })
        : Promise.resolve([]),
    );

    render(<LoansPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/Budi Santoso/)).toBeTruthy();
    expect(screen.getByText(/1.250.000/)).toBeTruthy();
    expect(screen.getByText(/Berjalan/)).toBeTruthy();
  });

  it('tells a settled loan from one that was stopped by hand', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/loans/all')
        ? Promise.resolve({
            rows: [
              loan({ id: 'ln-a', settled: true, remaining: 0 }),
              loan({ id: 'ln-b', active: false, settled: false }),
            ],
            total: 2,
          })
        : Promise.resolve([]),
    );

    render(<LoansPage />, { wrapper: LocaleProvider });

    // Paid off and stopped are different facts, and a list that showed only "tidak aktif"
    // would hide which of the two happened.
    expect(await screen.findByText(/Lunas/)).toBeTruthy();
    expect(screen.getByText(/Dihentikan/)).toBeTruthy();
  });

  it('asks only for running loans while the filter is on', async () => {
    render(<LoansPage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(get).toHaveBeenCalled());
    const asked = get.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/loans/all'));
    expect(asked).toContain('activeOnly=true');
  });
});
