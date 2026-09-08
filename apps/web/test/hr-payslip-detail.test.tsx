// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Four HR screens that had the number and did not print it, or printed it without saying
 * what it was.
 *
 *  - CA-1-69: `approvedAt` and `paidAt` are on the payroll record and were rendered
 *    nowhere. The badge says PAID; it does not say when.
 *  - CA-1-68: `lateMinutes` is on every attendance row and the HR-facing screen has shown
 *    it since it was built. The employee's own copy did not — so the one person the number
 *    is about, and whose pay a late-arrival deduction comes out of, could not see it.
 *  - CA-1-60: a bonus rule's threshold printed as a bare number, so "SALES_TOTAL ≥ 5000000"
 *    sat in a list of money rules looking like five million of nothing.
 *  - CA-1-56: three money cards side by side at 360pt leave about 100pt each, and a rupiah
 *    figure does not fit in 100pt.
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
  usePathname: () => '/hr/payroll/detail',
  useSearchParams: () => new URLSearchParams('id=pr-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'pr-1' }));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));

import PayrollDetailPage from '@/app/hr/payroll/detail/page';
import MyAttendancePage from '@/app/hr/me/attendance/page';
import RulesPage from '@/app/hr/rules/page';

const PAYROLL = {
  id: 'pr-1',
  employeeId: 'e1',
  employeeName: 'Budi',
  periodMonth: '2026-08',
  status: 'PAID',
  gross: 4250000,
  net: 4000000,
  totalBonus: 250000,
  totalDeduction: 500000,
  presentDays: 22,
  createdAt: '2026-09-01T00:00:00.000Z',
  approvedAt: '2026-09-02T03:00:00.000Z',
  paidAt: '2026-09-03T04:00:00.000Z',
  items: [],
};

beforeEach(() => {
  get.mockReset().mockResolvedValue(PAYROLL);
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-69 when a payroll was approved and paid', () => {
  it('prints both dates the record already carried', async () => {
    render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.payrollDetail.approvedAt')).toBeTruthy());
    expect(screen.getByText('hrFix.payrollDetail.paidAt')).toBeTruthy();
  });

  it('says nothing about dates a DRAFT does not have', async () => {
    get.mockResolvedValue({ ...PAYROLL, status: 'DRAFT', approvedAt: null, paidAt: null });
    render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.payrollDetail.netPay')).toBeTruthy());
    expect(screen.queryByText('hrFix.payrollDetail.approvedAt')).toBeNull();
    expect(screen.queryByText('hrFix.payrollDetail.paidAt')).toBeNull();
  });
});

describe('CA-1-56 the payslip money cards fit a phone', () => {
  it('stacks two-up below sm: rather than forcing three columns at every width', async () => {
    const { container } = render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.payrollDetail.netPay')).toBeTruthy());
    const grid = Array.from(container.querySelectorAll('div')).find(
      (el) => el.className.includes('grid-cols-2') && el.className.includes('sm:grid-cols-3'),
    );
    expect(grid).toBeTruthy();
    // The class that made a rupiah figure wrap mid-number on a 360pt screen.
    expect(container.innerHTML).not.toContain('grid grid-cols-3 gap-3 text-sm');
  });
});

describe('CA-1-68 an employee can see their own late minutes', () => {
  it('shows the figure the HR-facing screen has always shown', async () => {
    get.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          employeeId: 'e1',
          workDate: '2026-09-01',
          status: 'LATE',
          checkInAt: '2026-09-01T01:12:00.000Z',
          checkOutAt: '2026-09-01T10:00:00.000Z',
          lateMinutes: 12,
        },
      ],
      total: 1,
    });
    render(<MyAttendancePage />);
    await waitFor(() => expect(screen.getByText('+12m')).toBeTruthy());
  });

  it('prints nothing for a day that was not late', async () => {
    get.mockResolvedValue({
      rows: [
        {
          id: 'a2',
          employeeId: 'e1',
          workDate: '2026-09-02',
          status: 'PRESENT',
          checkInAt: '2026-09-02T00:55:00.000Z',
          checkOutAt: '2026-09-02T10:00:00.000Z',
          lateMinutes: 0,
        },
      ],
      total: 1,
    });
    render(<MyAttendancePage />);
    await waitFor(() =>
      expect(screen.getByText('hrFix.map.attendance.PRESENT')).toBeTruthy(),
    );
    expect(screen.queryByText(/\+\d+m/)).toBeNull();
  });
});

describe('CA-1-60 a bonus threshold says what it counts', () => {
  const rule = (metric: string, threshold: number) => ({
    id: `r-${metric}`,
    depotId: null,
    bonusType: 'ATTENDANCE',
    name: metric,
    metric,
    op: 'GTE',
    threshold,
    rewardKind: 'FIXED',
    rewardValue: 100000,
    active: true,
  });

  it('renders a rupiah target as rupiah and a rate as a percentage', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('bonus-rules')
        ? Promise.resolve([rule('SALES_TOTAL', 5_000_000), rule('ATTENDANCE_RATE', 95)])
        : Promise.resolve({ items: [] }),
    );
    render(<RulesPage />);
    await waitFor(() => expect(screen.getByText(/Rp\s?5\.000\.000/)).toBeTruthy());
    expect(screen.getByText(/95%/)).toBeTruthy();
    // The bare number that made five million rupiah look like five million of nothing.
    expect(screen.queryByText(/(^|\s)5000000(\s|$)/)).toBeNull();
  });

  it('leaves a plain count alone — days are days', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('bonus-rules')
        ? Promise.resolve([rule('PRESENT_DAYS', 22)])
        : Promise.resolve({ items: [] }),
    );
    render(<RulesPage />);
    await waitFor(() => expect(screen.getByText(/\b22\b/)).toBeTruthy());
  });
});
