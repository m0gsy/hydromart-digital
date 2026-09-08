// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HR console printing database values at people.
 *
 *  - CA-1-59: `/hr/adjustments` printed `b.type` and `d.type` raw, so the screen where HR
 *    reviews what was added to and taken off a wage read "CASH_ADVANCE" and "ATTENDANCE".
 *  - CA-1-64: employment history printed `changeType`, which hr-service writes as the raw
 *    field name — "monthlyRate", "depotId" — on the record a payslip dispute is settled from.
 *  - CA-1-63: the employee detail never showed role, depot or exit date, all three of which
 *    are on the response.
 *  - CA-1-74: the check-in result printed its status raw and painted it green whatever it
 *    said — including PENDING, which counts as nothing until HR decides.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams('id=e1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'e1' }));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    askReason: vi.fn().mockResolvedValue('alasan'),
  }),
}));
// The page loads on demand: pick an employee, press Muat. The picker is its own screen's
// concern, so it is stubbed down to something the test can set.
vi.mock('@/components/hr/employee-select', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('e1')}>
      pilih-karyawan
    </button>
  ),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'depot-1', name: 'Depot Utama' }],
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import AdjustmentsPage from '@/app/hr/adjustments/page';
import EmployeeDetailPage from '@/app/hr/employees/detail/page';

const EMPLOYEE = {
  id: 'e1',
  employeeCode: 'EMP-001',
  fullName: 'Budi Santoso',
  phone: '0811',
  email: null,
  departmentId: null,
  position: 'Kurir',
  role: 'STAFF_DEPOT',
  depotId: 'depot-1',
  status: 'ACTIVE',
  employmentStatus: 'PERMANENT',
  joinDate: '2025-01-06',
  exitDate: '2026-08-31',
  salaryType: 'MONTHLY',
  dailyRate: null,
  monthlyRate: 4000000,
  bankName: null,
  bankAccount: null,
};

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-59 bonus and deduction types are words', () => {
  it('names a CASH_ADVANCE deduction and an ATTENDANCE bonus', async () => {
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/bonuses'))
        return Promise.resolve([
          { id: 'b1', employeeId: 'e1', type: 'ATTENDANCE', amount: 100000, note: null, createdAt: '2026-09-01T00:00:00.000Z' },
        ]);
      if (u.includes('/deductions'))
        return Promise.resolve([
          { id: 'd1', employeeId: 'e1', type: 'CASH_ADVANCE', amount: 50000, note: null, createdAt: '2026-09-01T00:00:00.000Z' },
        ]);
      return Promise.resolve([]);
    });
    render(<AdjustmentsPage />);
    await userEvent.click(screen.getByText('pilih-karyawan'));
    await userEvent.click(screen.getByText('hrFix.adjustments.load'));
    await waitFor(() =>
      expect(screen.getByText(/hrFix\.map\.bonusType\.ATTENDANCE/)).toBeTruthy(),
    );
    expect(screen.getByText(/hrFix\.map\.deductionType\.CASH_ADVANCE/)).toBeTruthy();
    // The database values that used to be on screen.
    expect(screen.queryByText(/^CASH_ADVANCE/)).toBeNull();
  });
});

describe('CA-1-63 / CA-1-64 the employee detail', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/history'))
        return Promise.resolve([
          {
            id: 'h1',
            employeeId: 'e1',
            changeType: 'monthlyRate',
            fromValue: { value: '3500000' },
            toValue: { value: '4000000' },
            effectiveDate: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'h2',
            employeeId: 'e1',
            changeType: 'somethingNewNobodyMapped',
            fromValue: null,
            toValue: null,
            effectiveDate: '2026-08-02T00:00:00.000Z',
          },
        ]);
      if (u.includes('/employees/e1')) return Promise.resolve(EMPLOYEE);
      return Promise.resolve([]);
    });
  });

  it('shows the role, the depot and the exit date the record already carried', async () => {
    render(<EmployeeDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.employeeDetail.role')).toBeTruthy());
    expect(screen.getByText('hrFix.employeeDetail.depot')).toBeTruthy();
    expect(screen.getByText('Depot Utama')).toBeTruthy();
    expect(screen.getByText('hrFix.employeeDetail.exitDate')).toBeTruthy();
  });

  it('names a history row by its field, not by its database column', async () => {
    render(<EmployeeDetailPage />);
    await waitFor(() =>
      expect(screen.getByText('hrFix.map.historyChange.monthlyRate')).toBeTruthy(),
    );
  });

  it('falls back to the raw name for a field nobody has mapped yet', async () => {
    // hr-service writes whatever is in its TRACKED list; a new entry should show its own
    // name rather than blanking the row. The history is evidence, not decoration.
    render(<EmployeeDetailPage />);
    await waitFor(() => expect(screen.getByText('somethingNewNobodyMapped')).toBeTruthy());
  });
});
