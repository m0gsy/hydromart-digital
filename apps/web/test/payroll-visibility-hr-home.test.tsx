// @vitest-environment jsdom
/**
 * Owner decision 2026-11-19, on the HR home. Without `payrollRead` the server zeroes the
 * payroll block, and a "Rp 0" payroll on screen would read as a real total. So the figures and
 * the door to the payroll runs are left out for SUPERVISOR, ASSISTANT_SUPERVISOR and
 * KEPALA_DEPOT, and kept for the roles that read pay.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, who } = vi.hoisted(() => ({ get: vi.fn(), who: { role: 'HR' } }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: who.role }, ready: true, signOut: vi.fn() }),
}));

import HrDashboardPage from '@/app/hr/page';

const DASHBOARD = {
  depotId: null,
  periodMonth: '2026-11',
  workDate: '2026-11-20',
  headcount: { total: 3, byStatus: [], byEmploymentStatus: [] },
  attendanceToday: [],
  payroll: {
    totals: { gross: 9_000_000, totalBonus: 0, totalDeduction: 0, net: 9_000_000, count: 3 },
    byStatus: [],
  },
  employmentsEnding: [],
  documentsExpiring: [],
};

beforeEach(() => {
  get.mockReset().mockResolvedValue(DASHBOARD);
});

describe('the HR home and pay figures', () => {
  it.each(['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT'])(
    '%s sees the roster, not the payroll',
    async (role) => {
      who.role = role;
      render(<HrDashboardPage />);
      await screen.findByText('hrFix.home.totalEmployees');
      expect(screen.queryByText('hrFix.home.payrollNet')).toBeNull();
      expect(screen.queryByText('hrFix.home.runPayrollLink')).toBeNull();
    },
  );

  it.each(['HR', 'MANAGER', 'HEAD_OFFICE'])('%s sees the payroll figures', async (role) => {
    who.role = role;
    render(<HrDashboardPage />);
    expect(await screen.findByText('hrFix.home.payrollNet')).toBeTruthy();
    expect(screen.getByText('hrFix.home.runPayrollLink')).toBeTruthy();
  });
});
